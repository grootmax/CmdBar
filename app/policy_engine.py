"""
Policy Enforcement Engine for CmdBar Python backend and companion utilities.
Enforces security policies, MFA for sensitive operations, Data Loss Prevention (DLP),
Geographic restrictions (Geo-fencing), and Time-based access controls.
"""

import re
import time
import base64
import hmac
import hashlib
import struct
import datetime
import ipaddress

DEFAULT_POLICY_CONFIG = {
    "enabled": True,
    "mfa": {
        "enabled": True,
        "sensitive_keywords": [
            "deploy",
            "delete",
            "destroy",
            "drop",
            "sudo",
            "prod",
            "admin",
            "kms",
            "iam",
            "secrets",
        ],
        "session_ttl_seconds": 300,
        "secret": "JBSWY3DPEHPK3PXP",  # Default base32 test key (Secret: "Hello!")
    },
    "dlp": {
        "enabled": True,
        "action": "block",  # "block" | "redact" | "warn"
        "patterns": [
            {
                "name": "AWS Access Key",
                "regex": r"AKIA[0-9A-Z]{16}",
                "category": "credentials",
            },
            {
                "name": "Private Key",
                "regex": r"-----\s*BEGIN[ A-Z1-9_-]*PRIVATE KEY\s*-----",
                "category": "crypto",
            },
            {
                "name": "SSN",
                "regex": r"\b\d{3}-\d{2}-\d{4}\b",
                "category": "pii",
            },
            {
                "name": "Credit Card",
                "regex": r"\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b",
                "category": "financial",
            },
            {
                "name": "Generic Secret",
                "regex": r"(?i)(api[_-]?key|secret|password|bearer\s+[a-zA-Z0-9._-]+)\s*[:=]\s*['\"]?([a-zA-Z0-9._~+/-]{8,})['\"]?",
                "category": "credentials",
            },
        ],
    },
    "geo": {
        "enabled": False,
        "allowed_countries": ["US", "CA", "GB", "DE"],
        "blocked_countries": [],
        "allowed_ip_ranges": [],
        "blocked_ip_ranges": [],
    },
    "time": {
        "enabled": False,
        "allowed_days": ["Mon", "Tue", "Wed", "Thu", "Fri"],
        "start_time": "08:00",
        "end_time": "18:00",
        "timezone": "UTC",
    },
}


def generate_totp(secret, timestamp=None, digits=6, step=30):
    """
    Generates an RFC 6238 TOTP token given a base32/string secret key.
    """
    if not secret:
        return ""
    if timestamp is None:
        timestamp = int(time.time())

    counter = int(timestamp) // step

    secret_clean = str(secret).upper().replace(" ", "").rstrip("=")
    missing_padding = len(secret_clean) % 8
    if missing_padding:
        secret_clean += "=" * (8 - missing_padding)

    try:
        key = base64.b32decode(secret_clean, casefold=True)
    except Exception:
        key = str(secret).encode("utf-8")

    msg = struct.pack(">Q", counter)
    h = hmac.new(key, msg, hashlib.sha1).digest()
    offset = h[-1] & 0x0F
    code = (struct.unpack(">I", h[offset : offset + 4])[0] & 0x7FFFFFFF) % (10**digits)
    return str(code).zfill(digits)


def verify_totp(token, secret, window=1, timestamp=None, digits=6, step=30):
    """
    Verifies a TOTP token against a secret key within a time window.
    """
    if token is None or not secret:
        return False
    token_str = str(token).strip()
    if not token_str:
        return False

    if timestamp is None:
        timestamp = int(time.time())

    for w in range(-window, window + 1):
        test_time = timestamp + (w * step)
        if generate_totp(secret, test_time, digits, step) == token_str:
            return True

    return False


def is_sensitive_command(cmd_obj_or_str, sensitive_keywords=None):
    """
    Determines if a command is sensitive based on flags, sensitivity level, or keywords.
    """
    if not cmd_obj_or_str:
        return False

    keywords = (
        sensitive_keywords
        if isinstance(sensitive_keywords, list)
        else DEFAULT_POLICY_CONFIG["mfa"]["sensitive_keywords"]
    )

    if isinstance(cmd_obj_or_str, dict):
        if (
            cmd_obj_or_str.get("sensitive") is True
            or cmd_obj_or_str.get("mfa_required") is True
        ):
            return True
        if cmd_obj_or_str.get("sensitivity_level") in ("high", "critical"):
            return True
        full_str = f"{cmd_obj_or_str.get('name', '')} {cmd_obj_or_str.get('command', '') or cmd_obj_or_str.get('template', '')}"
    else:
        full_str = str(cmd_obj_or_str)

    lower_str = full_str.lower()
    for kw in keywords:
        if kw and str(kw).strip():
            pattern = r"\b" + re.escape(str(kw).strip()) + r"\b"
            if re.search(pattern, lower_str):
                return True

    return False


def ip_in_range(ip_str, cidr_str):
    """
    Checks if an IP address is within a CIDR range or matches an exact IP.
    """
    if not ip_str or not cidr_str:
        return False
    try:
        ip = ipaddress.ip_address(str(ip_str).strip())
        net = ipaddress.ip_network(str(cidr_str).strip(), strict=False)
        return ip in net
    except Exception:
        return False


def check_geo(context, geo_policy=None):
    """
    Evaluates Geographic restrictions against context.
    Returns dict: {'allowed': bool, 'reason': str}
    """
    policy = geo_policy or DEFAULT_POLICY_CONFIG["geo"]
    if not policy or not policy.get("enabled", True):
        return {"allowed": True}

    ctx = context or {}
    ip = ctx.get("ip_address") or ctx.get("ip") or ""
    country = str(ctx.get("country_code") or ctx.get("country") or "").upper()

    allowed_countries = [str(c).upper() for c in policy.get("allowed_countries", [])]
    blocked_countries = [str(c).upper() for c in policy.get("blocked_countries", [])]
    allowed_ip_ranges = policy.get("allowed_ip_ranges", [])
    blocked_ip_ranges = policy.get("blocked_ip_ranges", [])

    if blocked_countries and country and country in blocked_countries:
        return {
            "allowed": False,
            "reason": f"Country '{country}' is explicitly blocked by geographic policy.",
        }

    if allowed_countries and country and country not in allowed_countries:
        return {
            "allowed": False,
            "reason": f"Country '{country}' is not in allowed geographic regions list.",
        }

    if ip and blocked_ip_ranges:
        for r in blocked_ip_ranges:
            if ip_in_range(ip, r):
                return {
                    "allowed": False,
                    "reason": f"IP address '{ip}' is blocked by IP range policy ({r}).",
                }

    if ip and allowed_ip_ranges:
        in_allowed = any(ip_in_range(ip, r) for r in allowed_ip_ranges)
        if not in_allowed:
            return {
                "allowed": False,
                "reason": f"IP address '{ip}' is not in allowed IP ranges list.",
            }

    return {"allowed": True}


def check_time(context, time_policy=None):
    """
    Evaluates Time-based access controls against context.
    Returns dict: {'allowed': bool, 'reason': str}
    """
    policy = time_policy or DEFAULT_POLICY_CONFIG["time"]
    if not policy or not policy.get("enabled", True):
        return {"allowed": True}

    ctx = context or {}
    ts = ctx.get("timestamp")
    if isinstance(ts, (int, float)):
        now_dt = datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc)
    elif isinstance(ts, datetime.datetime):
        now_dt = ts
    else:
        now_dt = datetime.datetime.now(datetime.timezone.utc)

    days_map = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    current_day_name = days_map[now_dt.weekday()]
    current_day_idx = now_dt.weekday()  # Mon=0, Sun=6

    allowed_days = policy.get("allowed_days", [])
    if allowed_days:
        is_allowed = False
        for d in allowed_days:
            if isinstance(d, int) and d == current_day_idx:
                is_allowed = True
                break
            if isinstance(d, str) and d.lower()[:3] == current_day_name.lower():
                is_allowed = True
                break
        if not is_allowed:
            return {
                "allowed": False,
                "reason": f"Access denied on {current_day_name} (allowed days: {allowed_days}).",
            }

    start_time_str = policy.get("start_time")
    end_time_str = policy.get("end_time")

    if start_time_str and end_time_str:

        def parse_minutes(t_str):
            parts = [int(p) for p in str(t_str).split(":")]
            return parts[0] * 60 + parts[1]

        start_min = parse_minutes(start_time_str)
        end_min = parse_minutes(end_time_str)
        current_min = now_dt.hour * 60 + now_dt.minute

        if start_min <= end_min:
            if current_min < start_min or current_min > end_min:
                return {
                    "allowed": False,
                    "reason": f"Access denied at current time ({now_dt.strftime('%H:%M')} UTC). Allowed window: {start_time_str} - {end_time_str}.",
                }
        else:
            # Overnight window
            if current_min < start_min and current_min > end_min:
                return {
                    "allowed": False,
                    "reason": f"Access denied at current time ({now_dt.strftime('%H:%M')} UTC). Allowed overnight window: {start_time_str} - {end_time_str}.",
                }

    return {"allowed": True}


def check_dlp(text, dlp_policy=None):
    """
    Scans text for DLP pattern violations.
    Returns list of dicts: [{'name': str, 'category': str, 'match': str}]
    """
    if not text or not isinstance(text, str):
        return []

    policy = dlp_policy or DEFAULT_POLICY_CONFIG["dlp"]
    if not policy or not policy.get("enabled", True):
        return []

    patterns = policy.get("patterns") or DEFAULT_POLICY_CONFIG["dlp"]["patterns"]
    violations = []

    for pat in patterns:
        if not pat or not pat.get("regex"):
            continue
        try:
            raw_regex = pat["regex"]
            flags = 0
            if raw_regex.startswith("(?i)"):
                flags = re.IGNORECASE
                raw_regex = raw_regex[4:]

            matches = re.finditer(raw_regex, text, flags=flags)
            for m in matches:
                violations.append(
                    {
                        "name": pat.get("name", "Sensitive Data"),
                        "category": pat.get("category", "dlp"),
                        "match": m.group(0),
                    }
                )
        except Exception:
            pass

    return violations


def redact_dlp(text, dlp_policy=None):
    """
    Redacts sensitive DLP pattern matches in text.
    """
    if not text or not isinstance(text, str):
        return ""

    policy = dlp_policy or DEFAULT_POLICY_CONFIG["dlp"]
    if not policy or not policy.get("enabled", True):
        return text

    patterns = policy.get("patterns") or DEFAULT_POLICY_CONFIG["dlp"]["patterns"]
    redacted = text

    for pat in patterns:
        if not pat or not pat.get("regex"):
            continue
        try:
            raw_regex = pat["regex"]
            flags = 0
            if raw_regex.startswith("(?i)"):
                flags = re.IGNORECASE
                raw_regex = raw_regex[4:]

            replacement = f"[REDACTED_{pat.get('category', 'DATA').upper()}]"
            redacted = re.sub(raw_regex, replacement, redacted, flags=flags)
        except Exception:
            pass

    return redacted


class PolicyEngine:
    """
    Stateful and configurable Policy Enforcement Engine class.
    """

    def __init__(self, policy_config=None):
        self.policy = policy_config or DEFAULT_POLICY_CONFIG

    def update_policy(self, new_policy):
        self.policy = new_policy

    def evaluate_policy(self, command_obj_or_str, params=None, context=None):
        return evaluate_policy(command_obj_or_str, params, context, self.policy)


def evaluate_policy(command_obj_or_str, params=None, context=None, policy_config=None):
    """
    Evaluates Security Policy for a command execution.
    Evaluation order: Time -> Geo -> DLP -> MFA.
    """
    policy = policy_config or DEFAULT_POLICY_CONFIG
    ctx = context or {}
    params_dict = dict(params) if isinstance(params, dict) else {}

    if isinstance(command_obj_or_str, dict):
        cmd_obj = command_obj_or_str
    else:
        cmd_obj = {
            "command": str(command_obj_or_str or ""),
            "name": str(command_obj_or_str or ""),
        }

    raw_cmd_str = cmd_obj.get("command") or cmd_obj.get("template") or ""
    param_str = " ".join(str(v) for v in params_dict.values())
    full_text_to_scan = f"{cmd_obj.get('name', '')} {raw_cmd_str} {param_str}".strip()

    reasons = []
    dlp_violations = []

    if not policy.get("enabled", True):
        return {
            "allowed": True,
            "action": "allow",
            "reasons": ["Policy enforcement is globally disabled."],
            "mfa_required": False,
            "mfa_verified": False,
            "dlp_violations": [],
            "sanitized_command": raw_cmd_str,
            "sanitized_params": params_dict,
            "evaluated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }

    # 1. Time Policy Check
    time_res = check_time(ctx, policy.get("time"))
    if not time_res["allowed"]:
        return {
            "allowed": False,
            "action": "block",
            "reasons": [
                time_res.get("reason", "Time-based policy restriction violation.")
            ],
            "mfa_required": False,
            "mfa_verified": False,
            "dlp_violations": [],
            "sanitized_command": raw_cmd_str,
            "sanitized_params": params_dict,
            "evaluated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }

    # 2. Geo Policy Check
    geo_res = check_geo(ctx, policy.get("geo"))
    if not geo_res["allowed"]:
        return {
            "allowed": False,
            "action": "block",
            "reasons": [
                geo_res.get("reason", "Geographic policy restriction violation.")
            ],
            "mfa_required": False,
            "mfa_verified": False,
            "dlp_violations": [],
            "sanitized_command": raw_cmd_str,
            "sanitized_params": params_dict,
            "evaluated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }

    # 3. DLP Policy Check
    sanitized_cmd = raw_cmd_str
    sanitized_params = dict(params_dict)

    dlp_policy = policy.get("dlp", {})
    if dlp_policy.get("enabled", True):
        found_violations = check_dlp(full_text_to_scan, dlp_policy)
        if found_violations:
            dlp_violations.extend(found_violations)
            action = dlp_policy.get("action", "block")

            if action == "block":
                v_names = ", ".join(set(v["name"] for v in found_violations))
                return {
                    "allowed": False,
                    "action": "block",
                    "reasons": [
                        f"Data Loss Prevention (DLP) violation: {v_names} detected."
                    ],
                    "mfa_required": False,
                    "mfa_verified": False,
                    "dlp_violations": found_violations,
                    "sanitized_command": raw_cmd_str,
                    "sanitized_params": params_dict,
                    "evaluated_at": datetime.datetime.now(
                        datetime.timezone.utc
                    ).isoformat(),
                }
            elif action == "redact":
                sanitized_cmd = redact_dlp(raw_cmd_str, dlp_policy)
                for k, v in sanitized_params.items():
                    sanitized_params[k] = redact_dlp(str(v), dlp_policy)
                reasons.append(
                    f"DLP policy automatically redacted sensitive content ({len(found_violations)} items)."
                )
            elif action == "warn":
                v_names = ", ".join(set(v["name"] for v in found_violations))
                reasons.append(f"DLP warning: sensitive content detected ({v_names}).")

    # 4. MFA Policy Check
    mfa_required = False
    mfa_verified = False

    mfa_policy = policy.get("mfa", {})
    if mfa_policy.get("enabled", True):
        mfa_required = is_sensitive_command(
            cmd_obj, mfa_policy.get("sensitive_keywords")
        )

        if mfa_required:
            token = ctx.get("mfa_token") or params_dict.get("mfa_token")
            session_token = ctx.get("session_token")
            secret = mfa_policy.get("secret") or DEFAULT_POLICY_CONFIG["mfa"]["secret"]

            if session_token and ctx.get("session_valid") is True:
                mfa_verified = True
                reasons.append("MFA verified via active session.")
            elif token and verify_totp(token, secret):
                mfa_verified = True
                reasons.append("MFA verified via TOTP code.")
            else:
                return {
                    "allowed": False,
                    "action": "mfa_required",
                    "reasons": [
                        "Operation is classified as sensitive and requires Multi-Factor Authentication (MFA)."
                    ],
                    "mfa_required": True,
                    "mfa_verified": False,
                    "dlp_violations": dlp_violations,
                    "sanitized_command": sanitized_cmd,
                    "sanitized_params": sanitized_params,
                    "evaluated_at": datetime.datetime.now(
                        datetime.timezone.utc
                    ).isoformat(),
                }

    if not reasons:
        reasons.append("Policy evaluation passed successfully.")

    return {
        "allowed": True,
        "action": (
            "redact"
            if (dlp_violations and dlp_policy.get("action") == "redact")
            else "allow"
        ),
        "reasons": reasons,
        "mfa_required": mfa_required,
        "mfa_verified": mfa_verified,
        "dlp_violations": dlp_violations,
        "sanitized_command": sanitized_cmd,
        "sanitized_params": sanitized_params,
        "evaluated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
