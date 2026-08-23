import re
import time
import ipaddress
from datetime import datetime, timezone

DEFAULT_DLP_PATTERNS = {
    "credit_card": {
        "name": "Credit Card Number",
        "regex": r"\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b",
        "redact_label": "[REDACTED:CREDIT_CARD]",
        "luhn_check": True,
    },
    "ssn": {
        "name": "Social Security Number",
        "regex": r"\b\d{3}-\d{2}-\d{4}\b",
        "redact_label": "[REDACTED:SSN]",
    },
    "aws_key": {
        "name": "AWS Access Key",
        "regex": r"\b(AKIA|ASIA)[0-9A-Z]{16}\b",
        "redact_label": "[REDACTED:AWS_KEY]",
    },
    "private_key": {
        "name": "Private Key Header",
        "regex": r"-----BEGIN (?:RSA|OPENSSH|EC|DSA|PGP)? PRIVATE KEY-----[\s\S]*?-----END (?:RSA|OPENSSH|EC|DSA|PGP)? PRIVATE KEY-----",
        "redact_label": "[REDACTED:PRIVATE_KEY]",
    },
    "api_token": {
        "name": "API Token / Password",
        "regex": r"\b(?:bearer|api[-_]?key|secret|password|passwd|auth[-_]?token)\b\s*[:=]\s*[\"']?([A-Za-z0-9_\-\.\~]{12,})[\"']?",
        "redact_label": "[REDACTED:API_TOKEN]",
    },
}

DEFAULT_SENSITIVE_COMMAND_PATTERNS = [
    "*deploy*",
    "*rm -rf*",
    "*sudo*",
    "*aws ecs*",
    "*db:drop*",
    "*db:migrate*",
    "*pkill*",
]


def validate_luhn(card_num: str) -> bool:
    clean = re.sub(r"\D", "", str(card_num))
    if len(clean) < 11 or len(clean) > 19:
        return False
    digits = [int(c) for c in clean]
    checksum = 0
    reverse_digits = digits[::-1]
    for i, digit in enumerate(reverse_digits):
        if i % 2 == 1:
            double = digit * 2
            checksum += double - 9 if double > 9 else double
        else:
            checksum += digit
    return checksum % 10 == 0


def is_ip_in_cidr(ip_str: str, cidr_str: str) -> bool:
    if not ip_str or not cidr_str:
        return False
    try:
        ip_obj = ipaddress.ip_address(ip_str.strip())
        net_obj = ipaddress.ip_network(cidr_str.strip(), strict=False)
        return ip_obj in net_obj
    except Exception:
        return False


class PolicyEngine:
    def __init__(self, policy_config: dict = None):
        self.mfa_session = {
            "verified": False,
            "timestamp": 0,
            "token": None,
        }
        self.configure(policy_config or {})

    def configure(self, policy_config: dict):
        mfa_cfg = policy_config.get("mfa", {})
        self.mfa_config = {
            "enabled": mfa_cfg.get("enabled", False),
            "sensitive_commands": mfa_cfg.get(
                "sensitive_commands", list(DEFAULT_SENSITIVE_COMMAND_PATTERNS)
            ),
            "mfa_secret": mfa_cfg.get("mfa_secret", "123456"),
            "session_duration_sec": mfa_cfg.get("session_duration_sec", 300),
        }

        dlp_cfg = policy_config.get("dlp", {})
        self.dlp_config = {
            "enabled": dlp_cfg.get("enabled", True),
            "action": dlp_cfg.get("action", "redact"),  # "redact", "block", or "warn"
            "custom_patterns": dlp_cfg.get("custom_patterns", {}),
        }

        geo_cfg = policy_config.get("geo", {})
        self.geo_config = {
            "enabled": geo_cfg.get("enabled", False),
            "allowed_countries": geo_cfg.get("allowed_countries", []),
            "blocked_countries": geo_cfg.get("blocked_countries", []),
            "allowed_ip_ranges": geo_cfg.get("allowed_ip_ranges", []),
            "blocked_ip_ranges": geo_cfg.get("blocked_ip_ranges", []),
        }

        time_cfg = policy_config.get("time", {})
        self.time_config = {
            "enabled": time_cfg.get("enabled", False),
            "allowed_days": time_cfg.get(
                "allowed_days", ["Mon", "Tue", "Wed", "Thu", "Fri"]
            ),
            "allowed_hours": time_cfg.get(
                "allowed_hours", {"start": "00:00", "end": "23:59"}
            ),
            "timezone": time_cfg.get("timezone", "UTC"),
        }

    def is_mfa_session_valid(self, now_timestamp: float = None) -> bool:
        if not self.mfa_session["verified"]:
            return False
        now = now_timestamp if now_timestamp is not None else time.time()
        elapsed = now - self.mfa_session["timestamp"]
        return 0 <= elapsed <= self.mfa_config["session_duration_sec"]

    def verify_mfa_token(self, token: str, now_timestamp: float = None) -> bool:
        if not token:
            return False
        clean_token = str(token).strip()
        expected = str(self.mfa_config["mfa_secret"]).strip()
        if clean_token == expected:
            now = now_timestamp if now_timestamp is not None else time.time()
            self.mfa_session = {
                "verified": True,
                "timestamp": now,
                "token": clean_token,
            }
            return True
        return False

    def clear_mfa_session(self):
        self.mfa_session = {
            "verified": False,
            "timestamp": 0,
            "token": None,
        }

    def is_sensitive_operation(self, command_obj) -> bool:
        if not command_obj:
            return False

        cmd_str = ""
        is_explicit = False

        if isinstance(command_obj, str):
            cmd_str = command_obj
        elif isinstance(command_obj, dict):
            cmd_str = command_obj.get("command") or command_obj.get("name") or ""
            if command_obj.get("sensitive") or command_obj.get("require_mfa"):
                is_explicit = True

        if is_explicit:
            return True

        lower_cmd = cmd_str.lower().strip()
        for pattern in self.mfa_config["sensitive_commands"]:
            p = pattern.lower()
            if p.startswith("*") and p.endswith("*"):
                if p[1:-1] in lower_cmd:
                    return True
            elif p.startswith("*"):
                if lower_cmd.endswith(p[1:]):
                    return True
            elif p.endswith("*"):
                if lower_cmd.startswith(p[:-1]):
                    return True
            elif lower_cmd == p:
                return True

        return False

    def scan_dlp(self, text: str) -> dict:
        if not text or not isinstance(text, str):
            return {"matches": [], "redacted_text": text or ""}

        matches = []
        redacted_text = text

        patterns = {**DEFAULT_DLP_PATTERNS, **self.dlp_config["custom_patterns"]}

        for rule_key, rule in patterns.items():
            regex_str = rule["regex"]
            compiled = re.compile(regex_str, re.IGNORECASE)
            for m in compiled.finditer(text):
                val = m.group(0)
                if rule.get("luhn_check"):
                    if not validate_luhn(val):
                        continue

                matches.append(
                    {
                        "rule": rule_key,
                        "name": rule.get("name", rule_key),
                        "value": val,
                    }
                )

                redacted_text = redacted_text.replace(
                    val, rule.get("redact_label", "[DLP REDACTED]")
                )

        return {"matches": matches, "redacted_text": redacted_text}

    def evaluate_geo(self, geo_context: dict = None) -> dict:
        if not self.geo_config["enabled"]:
            return {"allowed": True, "reason": None}

        geo_context = geo_context or {}
        country = (
            (geo_context.get("countryCode") or geo_context.get("country") or "")
            .upper()
            .strip()
        )
        ip = (geo_context.get("ip") or "").strip()

        # 1. Country code check
        if country:
            blocked = [c.upper() for c in self.geo_config["blocked_countries"]]
            if blocked and country in blocked:
                return {
                    "allowed": False,
                    "reason": f"Geographic Restriction: Country '{country}' is blocked.",
                }

            allowed = [c.upper() for c in self.geo_config["allowed_countries"]]
            if allowed and country not in allowed:
                return {
                    "allowed": False,
                    "reason": f"Geographic Restriction: Country '{country}' is not in allowed list.",
                }

        # 2. IP Range check
        if ip:
            for cidr in self.geo_config["blocked_ip_ranges"]:
                if is_ip_in_cidr(ip, cidr):
                    return {
                        "allowed": False,
                        "reason": f"Geographic Restriction: IP address '{ip}' matches blocked range '{cidr}'.",
                    }

            if self.geo_config["allowed_ip_ranges"]:
                matched = any(
                    is_ip_in_cidr(ip, cidr)
                    for cidr in self.geo_config["allowed_ip_ranges"]
                )
                if not matched:
                    return {
                        "allowed": False,
                        "reason": f"Geographic Restriction: IP address '{ip}' is not in allowed IP ranges.",
                    }

        return {"allowed": True, "reason": None}

    def evaluate_time(self, time_context=None) -> dict:
        if not self.time_config["enabled"]:
            return {"allowed": True, "reason": None}

        if time_context is None:
            dt = datetime.now(timezone.utc)
        elif isinstance(time_context, (int, float)):
            dt = datetime.fromtimestamp(time_context, tz=timezone.utc)
        elif isinstance(time_context, datetime):
            dt = time_context if time_context.tzinfo else time_context.replace(tzinfo=timezone.utc)
        else:
            try:
                dt = datetime.fromisoformat(str(time_context))
                if not dt.tzinfo:
                    dt = dt.replace(tzinfo=timezone.utc)
            except Exception:
                dt = datetime.now(timezone.utc)

        day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        current_day = day_names[dt.weekday()]

        allowed_days = self.time_config.get("allowed_days", [])
        if allowed_days:
            allowed_days_upper = [str(d).upper()[:3] for d in allowed_days]
            if current_day.upper() not in allowed_days_upper:
                return {
                    "allowed": False,
                    "reason": f"Time Restriction: Access not allowed on {current_day}. Allowed days: {', '.join(allowed_days)}.",
                }

        allowed_hours = self.time_config.get("allowed_hours")
        if allowed_hours:
            start_str = allowed_hours.get("start", "00:00")
            end_str = allowed_hours.get("end", "23:59")

            try:
                start_h, start_m = [int(v) for v in start_str.split(":")]
                end_h, end_m = [int(v) for v in end_str.split(":")]
            except Exception:
                start_h, start_m = 0, 0
                end_h, end_m = 23, 59

            current_minutes = dt.hour * 60 + dt.minute
            start_minutes = start_h * 60 + start_m
            end_minutes = end_h * 60 + end_m

            if current_minutes < start_minutes or current_minutes > end_minutes:
                time_str = f"{dt.hour:02d}:{dt.minute:02d}"
                return {
                    "allowed": False,
                    "reason": f"Time Restriction: Access not allowed at {time_str} UTC. Allowed hours: {start_str} - {end_str}.",
                }

        return {"allowed": True, "reason": None}

    def evaluate(self, eval_context: dict = None) -> dict:
        eval_context = eval_context or {}
        reasons = []
        allowed = True

        now = eval_context.get("timestamp")
        if now is None:
            now = time.time()
        elif isinstance(now, datetime):
            now = now.timestamp()

        # 1. Geographic check
        geo_res = self.evaluate_geo(eval_context.get("geo", {}))
        if not geo_res["allowed"]:
            allowed = False
            reasons.append(geo_res["reason"])

        # 2. Time check
        time_res = self.evaluate_time(eval_context.get("timestamp"))
        if not time_res["allowed"]:
            allowed = False
            reasons.append(time_res["reason"])

        # 3. MFA Check for Sensitive Operations
        command_obj = eval_context.get("command")
        is_sensitive = self.is_sensitive_operation(command_obj)
        mfa_required = False
        mfa_verified = False

        if self.mfa_config["enabled"] and is_sensitive:
            mfa_required = True
            token = eval_context.get("mfaToken") or eval_context.get("mfa_token")
            if token:
                self.verify_mfa_token(token, now)
            mfa_verified = self.is_mfa_session_valid(now)

            if not mfa_verified:
                allowed = False
                reasons.append(
                    "MFA Authentication Required: Sensitive operation requires verified MFA token."
                )

        # 4. DLP Scan on Inputs
        redacted_command = (
            command_obj
            if isinstance(command_obj, str)
            else (command_obj.get("command") or command_obj.get("name") or "")
            if isinstance(command_obj, dict)
            else ""
        )
        redacted_parameters = dict(eval_context.get("parameters") or {})
        dlp_matches = []

        if self.dlp_config["enabled"]:
            cmd_scan = self.scan_dlp(redacted_command)
            dlp_matches.extend(cmd_scan["matches"])
            redacted_command = cmd_scan["redacted_text"]

            for k, v in redacted_parameters.items():
                if isinstance(v, str):
                    param_scan = self.scan_dlp(v)
                    dlp_matches.extend(param_scan["matches"])
                    redacted_parameters[k] = param_scan["redacted_text"]

            if dlp_matches:
                if self.dlp_config["action"] == "block":
                    allowed = False
                    rule_names = ", ".join(m["name"] for m in dlp_matches)
                    reasons.append(
                        f"DLP Violation: Blocked due to sensitive data detection ({rule_names})."
                    )
                elif self.dlp_config["action"] == "warn":
                    rule_names = ", ".join(m["name"] for m in dlp_matches)
                    reasons.append(
                        f"DLP Warning: Sensitive data detected ({rule_names})."
                    )

        def redact_output(output_str: str) -> str:
            if not self.dlp_config["enabled"] or not output_str:
                return output_str
            scan = self.scan_dlp(output_str)
            return scan["redacted_text"]

        return {
            "allowed": allowed,
            "mfa_required": mfa_required,
            "mfa_verified": mfa_verified,
            "reasons": reasons,
            "dlp_matches": dlp_matches,
            "redacted_command": redacted_command,
            "redacted_parameters": redacted_parameters,
            "redact_output": redact_output,
        }
