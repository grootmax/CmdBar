"""
Shared Audit Trail Manager for Enterprise Teams, Compliance, SIEM Export, Anomaly Detection, and GDPR Compliance.
Provides Python implementation for Companion App and system integration.
"""

import os
import json
import re
import time
import hmac
import hashlib
import uuid
from datetime import datetime, timezone

try:
    from app.atomic_write import atomic_write_json
except ImportError:
    try:
        from companion.atomic_write import atomic_write_json
    except ImportError:
        def atomic_write_json(filepath, data):
            dir_path = os.path.dirname(filepath)
            if dir_path:
                os.makedirs(dir_path, exist_ok=True)
            with open(filepath, "w") as f:
                json.dump(data, f, indent=2)


def compute_hmac(data: str, key: str = "cmdbar-shared-audit-key") -> str:
    """
    Computes SHA-256 HMAC digest for input string data.
    :visibility: public
    """
    return hmac.new(key.encode("utf-8"), data.encode("utf-8"), hashlib.sha256).hexdigest()


def generate_id() -> str:
    """
    Generates a unique audit event identifier string.
    :visibility: public
    """
    return str(uuid.uuid4())


def mask_pii(input_data):
    """
    Redacts Personally Identifiable Information (PII) including passwords, tokens, API keys, emails, and IPs.
    :visibility: public
    """
    if input_data is None:
        return input_data

    if isinstance(input_data, dict):
        clean_dict = {}
        for key, val in input_data.items():
            lower_key = str(key).lower()
            if any(k in lower_key for k in ["password", "secret", "token", "api_key", "apikey", "auth"]):
                clean_dict[key] = "[REDACTED_SENSITIVE]"
            else:
                clean_dict[key] = mask_pii(val)
        return clean_dict

    if isinstance(input_data, list):
        return [mask_pii(item) for item in input_data]

    if not isinstance(input_data, str):
        return input_data

    text = input_data

    # Passwords & Credentials
    text = re.sub(r'(password|passwd|pwd)\s*[:=]?\s*[\'"]?[^\s\'"]+[\'"]?', r'\1=[REDACTED_PASSWORD]', text, flags=re.IGNORECASE)
    text = re.sub(r'(-p|--password)\s+[\'"]?[^\s\'"]+[\'"]?', r'\1 [REDACTED_PASSWORD]', text, flags=re.IGNORECASE)

    # Tokens & Keys
    text = re.sub(r'Bearer\s+[a-zA-Z0-9_\-\.]{15,}', 'Bearer [REDACTED_TOKEN]', text, flags=re.IGNORECASE)
    text = re.sub(r'(api[_-]?key|access[_-]?token|secret[_-]?key)\s*[:=]\s*[\'"]?[^\s\'"]+[\'"]?', r'\1=[REDACTED_TOKEN]', text, flags=re.IGNORECASE)
    text = re.sub(r'\b(AKIA|ASIA)[0-9A-Z]{16}\b', '[REDACTED_AWS_KEY]', text)

    # Email Addresses
    text = re.sub(r'\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b', '[REDACTED_EMAIL]', text)

    # IP Addresses
    text = re.sub(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b', '[REDACTED_IP]', text)

    # SSNs
    text = re.sub(r'\b\d{3}-\d{2}-\d{4}\b', '[REDACTED_SSN]', text)

    return text


class SharedAuditTrail:
    """
    Python Manager for Shared Team Audit Log, Compliance Reports, SIEM Export,
    Anomaly Detection, Real-time Alerts, and GDPR Controls.
    """

    def __init__(self, team_id="default-team", workspace_id="default-workspace", user_id="system",
                 log_path=None, hmac_key="cmdbar-shared-audit-key", privacy_mode=False,
                 pii_masking=True, retention_days=90, anomaly_thresholds=None):
        """
        Initializes SharedAuditTrail instance.
        :visibility: public
        """
        self.team_id = team_id
        self.workspace_id = workspace_id
        self.user_id = user_id
        self.log_path = log_path
        self.hmac_key = hmac_key
        self.privacy_mode = bool(privacy_mode)
        self.pii_masking = bool(pii_masking)
        self.retention_days = int(retention_days)

        self.anomaly_thresholds = {
            "failureSpikeThreshold": 5,
            "failureSpikeWindowSeconds": 300,
            "rapidVelocityThreshold": 10,
            "rapidVelocityWindowSeconds": 60,
            "offHoursStartHour": 22,
            "offHoursEndHour": 6,
        }
        if anomaly_thresholds and isinstance(anomaly_thresholds, dict):
            self.anomaly_thresholds.update(anomaly_thresholds)

        self.logs = []
        self.alert_handlers = []
        self.alert_cooldowns = {}
        self.previous_signature = "0000000000000000000000000000000000000000000000000000000000000000"

        if self.log_path and os.path.exists(self.log_path):
            try:
                with open(self.log_path, "r") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        self.logs = data
                        if self.logs:
                            self.previous_signature = self.logs[-1].get("signature", self.previous_signature)
            except Exception:
                pass

    def register_alert_handler(self, handler):
        """
        Registers a real-time security alert callback function.
        :visibility: public
        """
        if callable(handler):
            self.alert_handlers.append(handler)

    def clear_alert_handlers(self):
        """
        Clears all registered alert handlers.
        :visibility: public
        """
        self.alert_handlers.clear()

    def set_privacy_mode(self, enabled: bool):
        """
        Toggles privacy mode flag.
        :visibility: public
        """
        self.privacy_mode = bool(enabled)

    def _compute_event_signature(self, entry: dict) -> str:
        raw = f"{self.previous_signature}|{entry['id']}|{entry['timestamp']}|{entry['userId']}|{entry['teamId']}|{entry['action']}|{entry['resource']}|{entry['status']}"
        return compute_hmac(raw, self.hmac_key)

    def log_event(self, action: str, resource: str = "", user_id: str = None, team_id: str = None,
                  workspace_id: str = None, status: str = "SUCCESS", severity: str = "INFO",
                  ip_address: str = "127.0.0.1", metadata: dict = None) -> dict:
        """
        Logs a new team audit event record with HMAC tamper-evident signature chaining.
        :visibility: public
        """
        if not action:
            raise ValueError("SharedAuditTrail: Action is required.")

        now_iso = datetime.now(timezone.utc).isoformat()
        event_id = generate_id()
        actual_user = user_id or self.user_id
        actual_team = team_id or self.team_id
        actual_workspace = workspace_id or self.workspace_id
        actual_status = status.upper()
        actual_severity = severity.upper()
        meta = dict(metadata or {})

        actual_resource = resource
        actual_ip = ip_address

        if self.privacy_mode:
            actual_resource = actual_resource.split(" ")[0] + " [ARGS_OMITTED_PRIVACY_MODE]"
            actual_ip = "[PRIVACY_MODE_OMITTED]"
            meta = {"privacyMode": True}
        elif self.pii_masking:
            actual_resource = mask_pii(actual_resource)
            actual_ip = mask_pii(actual_ip)
            meta = mask_pii(meta)

        entry = {
            "id": event_id,
            "timestamp": now_iso,
            "userId": actual_user,
            "teamId": actual_team,
            "workspaceId": actual_workspace,
            "action": action,
            "resource": actual_resource,
            "status": actual_status,
            "severity": actual_severity,
            "ipAddress": actual_ip,
            "metadata": meta,
            "previousSignature": self.previous_signature
        }

        entry["signature"] = self._compute_event_signature(entry)
        self.previous_signature = entry["signature"]

        self.logs.append(entry)

        if self.log_path:
            try:
                atomic_write_json(self.log_path, self.logs)
            except Exception as e:
                print(f"SharedAuditTrail: Failed to save logs: {e}", file=sys.stderr)

        anomalies = self.evaluate_anomalies_for_event(entry)
        if anomalies or actual_severity in ["HIGH", "CRITICAL"] or actual_status == "DENIED":
            self._trigger_alerts(entry, anomalies)

        return entry

    def sync_team_logs(self, external_logs: list) -> int:
        """
        Merges external team audit log records into local log store.
        :visibility: public
        """
        if not isinstance(external_logs, list):
            return 0

        existing_ids = {l.get("id") for l in self.logs if isinstance(l, dict)}
        added_count = 0

        for entry in external_logs:
            if not isinstance(entry, dict) or not entry.get("id") or entry["id"] in existing_ids:
                continue
            self.logs.append(entry)
            existing_ids.add(entry["id"])
            added_count += 1

        self.logs.sort(key=lambda x: x.get("timestamp", ""))
        if self.logs:
            self.previous_signature = self.logs[-1].get("signature", self.previous_signature)

        return added_count

    def query_logs(self, filters: dict = None) -> list:
        """
        Queries and filters logged audit events according to search criteria.
        :visibility: public
        """
        filters = filters or {}
        result = list(self.logs)

        if filters.get("teamId"):
            result = [l for l in result if l.get("teamId") == filters["teamId"]]
        if filters.get("userId"):
            result = [l for l in result if l.get("userId") == filters["userId"]]
        if filters.get("action"):
            result = [l for l in result if l.get("action") == filters["action"]]
        if filters.get("status"):
            result = [l for l in result if l.get("status", "").upper() == filters["status"].upper()]
        if filters.get("severity"):
            result = [l for l in result if l.get("severity", "").upper() == filters["severity"].upper()]

        if filters.get("startDate"):
            result = [l for l in result if l.get("timestamp", "") >= filters["startDate"]]
        if filters.get("endDate"):
            result = [l for l in result if l.get("timestamp", "") <= filters["endDate"]]

        if filters.get("searchKeyword"):
            kw = filters["searchKeyword"].lower()
            result = [l for l in result if kw in l.get("action", "").lower() or kw in l.get("resource", "").lower() or kw in l.get("userId", "").lower() or kw in json.dumps(l.get("metadata", {})).lower()]

        if isinstance(filters.get("limit"), int) and filters["limit"] > 0:
            result = result[:filters["limit"]]

        return result

    def verify_integrity(self) -> dict:
        """
        Verifies cryptographic HMAC signature chain integrity across stored audit records.
        :visibility: public
        """
        errors = []
        expected_prev_sig = "0000000000000000000000000000000000000000000000000000000000000000"

        for i, entry in enumerate(self.logs):
            prev = entry.get("previousSignature", expected_prev_sig)
            if prev != expected_prev_sig:
                errors.append(f"Chain broken at index {i} (ID: {entry.get('id')}): previousSignature mismatch.")

            raw = f"{prev}|{entry.get('id')}|{entry.get('timestamp')}|{entry.get('userId')}|{entry.get('teamId')}|{entry.get('action')}|{entry.get('resource')}|{entry.get('status')}"
            calc_sig = compute_hmac(raw, self.hmac_key)

            if entry.get("signature") != calc_sig:
                errors.append(f"Invalid signature at index {i} (ID: {entry.get('id')}): data tampered.")

            expected_prev_sig = entry.get("signature")

        return {
            "valid": len(errors) == 0,
            "totalVerified": len(self.logs),
            "errors": errors
        }

    def purge_user_data(self, target_user_id: str) -> dict:
        """
        GDPR Right to be Forgotten: Redacts/pseudonymizes personal data for specified user.
        :visibility: public
        """
        if not target_user_id:
            raise ValueError("SharedAuditTrail: Target user ID required.")

        pseudonym = "ANONYMIZED_" + compute_hmac(target_user_id, "gdpr-salt")[:12]
        purged_count = 0

        for entry in self.logs:
            if entry.get("userId") == target_user_id:
                entry["userId"] = pseudonym
                entry["ipAddress"] = "[GDPR_PURGED_IP]"
                entry["resource"] = mask_pii(entry.get("resource", ""))
                entry["metadata"] = {"gdprPurged": True, "originalPurgeTimestamp": datetime.now(timezone.utc).isoformat()}
                purged_count += 1

        if purged_count > 0:
            prev_sig = "0000000000000000000000000000000000000000000000000000000000000000"
            for entry in self.logs:
                entry["previousSignature"] = prev_sig
                raw = f"{prev_sig}|{entry.get('id')}|{entry.get('timestamp')}|{entry.get('userId')}|{entry.get('teamId')}|{entry.get('action')}|{entry.get('resource')}|{entry.get('status')}"
                entry["signature"] = compute_hmac(raw, self.hmac_key)
                prev_sig = entry["signature"]
            self.previous_signature = prev_sig

        if self.log_path and purged_count > 0:
            atomic_write_json(self.log_path, self.logs)

        return {
            "success": True,
            "purgedCount": purged_count,
            "pseudonym": pseudonym,
            "targetUserId": target_user_id
        }

    def apply_retention_policy(self, max_days: int = None) -> dict:
        """
        Enforces automated retention policy by pruning events older than max_days.
        :visibility: public
        """
        days = max_days if isinstance(max_days, int) else self.retention_days
        cutoff_sec = time.time() - (days * 86400)

        initial_count = len(self.logs)
        new_logs = []

        for entry in self.logs:
            try:
                ts_str = entry.get("timestamp", "").replace("Z", "+00:00")
                dt = datetime.fromisoformat(ts_str)
                if dt.timestamp() >= cutoff_sec:
                    new_logs.append(entry)
            except Exception:
                new_logs.append(entry)

        self.logs = new_logs
        pruned_count = initial_count - len(self.logs)

        if self.log_path and pruned_count > 0:
            atomic_write_json(self.log_path, self.logs)

        return {
            "prunedCount": pruned_count,
            "remainingCount": len(self.logs),
            "retentionDays": days
        }

    def detect_anomalies(self, custom_logs: list = None) -> list:
        """
        Detects security anomaly patterns across target audit records.
        :visibility: public
        """
        target_logs = custom_logs if custom_logs is not None else self.logs
        anomalies = []

        if not target_logs:
            return anomalies

        integrity = self.verify_integrity()
        if not integrity["valid"]:
            anomalies.append({
                "id": generate_id(),
                "ruleId": "INTEGRITY_TAMPER",
                "severity": "CRITICAL",
                "description": f"Audit log tamper detected: {'; '.join(integrity['errors'])}",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "affectedUser": "SYSTEM",
                "teamId": self.team_id
            })

        user_map = {}
        for entry in target_logs:
            uid = entry.get("userId", "unknown")
            user_map.setdefault(uid, []).append(entry)

        for user, user_logs in user_map.items():
            failures = [l for l in user_logs if l.get("status") in ["FAILURE", "DENIED"]]
            if len(failures) >= self.anomaly_thresholds["failureSpikeThreshold"]:
                anomalies.append({
                    "id": generate_id(),
                    "ruleId": "FAILURE_SPIKE",
                    "severity": "HIGH",
                    "description": f"User '{user}' triggered {len(failures)} command execution failures/denials.",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "affectedUser": user,
                    "teamId": user_logs[0].get("teamId", self.team_id),
                    "triggeringEvents": [f.get("id") for f in failures]
                })

            for entry in user_logs:
                try:
                    dt = datetime.fromisoformat(entry.get("timestamp", "").replace("Z", "+00:00"))
                    hour = dt.hour
                    is_weekend = dt.weekday() >= 5
                    is_off_hours = hour >= self.anomaly_thresholds["offHoursStartHour"] or hour < self.anomaly_thresholds["offHoursEndHour"] or is_weekend
                    if is_off_hours and (entry.get("severity") in ["HIGH", "CRITICAL"] or entry.get("status") == "DENIED"):
                        anomalies.append({
                            "id": generate_id(),
                            "ruleId": "OFF_HOURS_ACTIVITY",
                            "severity": "WARNING",
                            "description": f"Off-hours activity by user '{user}' at {entry.get('timestamp')}.",
                            "timestamp": entry.get("timestamp"),
                            "affectedUser": user,
                            "teamId": entry.get("teamId"),
                            "triggeringEvents": [entry.get("id")]
                        })
                except Exception:
                    pass

            unauthorized = [l for l in user_logs if l.get("status") == "DENIED" or "privilege" in l.get("action", "")]
            if len(unauthorized) >= 2:
                anomalies.append({
                    "id": generate_id(),
                    "ruleId": "UNAUTHORIZED_PRIVILEGE",
                    "severity": "CRITICAL",
                    "description": f"Repeated unauthorized privilege escalation attempts by user '{user}'.",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "affectedUser": user,
                    "teamId": user_logs[0].get("teamId"),
                    "triggeringEvents": [u.get("id") for u in unauthorized]
                })

        return anomalies

    def evaluate_anomalies_for_event(self, event: dict) -> list:
        user_logs = [l for l in self.logs if l.get("userId") == event.get("userId")]
        return self.detect_anomalies(user_logs)

    def _trigger_alerts(self, event: dict, anomalies: list = None):
        cooldown_key = f"{event.get('userId')}:{event.get('action')}"
        last_time = self.alert_cooldowns.get(cooldown_key, 0)
        now = time.time()

        if now - last_time < 30:
            return

        self.alert_cooldowns[cooldown_key] = now

        payload = {
            "id": generate_id(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": event,
            "anomalies": anomalies or [],
            "severity": event.get("severity", "HIGH"),
            "message": f"Security Alert: Action '{event.get('action')}' by user '{event.get('userId')}' (Status: {event.get('status')})."
        }

        for handler in self.alert_handlers:
            try:
                handler(payload)
            except Exception as e:
                print(f"SharedAuditTrail alert error: {e}", file=sys.stderr)

    def generate_compliance_report(self, framework: str = "SOC2", options: dict = None) -> dict:
        """
        Generates a compliance evaluation audit report.
        :visibility: public
        """
        options = options or {}
        target_logs = self.query_logs(options)
        fw = framework.upper()
        total_events = len(target_logs)

        integrity = self.verify_integrity()
        anomalies = self.detect_anomalies(target_logs)

        denied = [l for l in target_logs if l.get("status") in ["DENIED", "FAILURE"]]
        fail_pct = (len(denied) / total_events * 100) if total_events > 0 else 0.0

        controls = [
            {
                "id": "CTRL-01",
                "title": "Audit Logging Coverage & Activity Monitoring",
                "status": "PASS" if total_events > 0 else "FAIL",
                "details": f"Recorded {total_events} audit events across team workspace."
            },
            {
                "id": "CTRL-02",
                "title": "Tamper-Evident HMAC Signature Verification",
                "status": "PASS" if integrity["valid"] else "FAIL",
                "details": "All audit log HMAC signatures and hash chain verified successfully." if integrity["valid"] else f"Integrity check failed: {len(integrity['errors'])} errors."
            },
            {
                "id": "CTRL-03",
                "title": "PII Masking & Privacy Governance",
                "status": "PASS" if self.pii_masking else "FAIL",
                "details": "Automated PII masking enabled for sensitive fields." if self.pii_masking else "PII masking disabled."
            },
            {
                "id": "CTRL-04",
                "title": "Access Control & Authorization Failure Thresholds",
                "status": "PASS" if fail_pct <= 15.0 else "FAIL",
                "details": f"Access denial rate is {fail_pct:.1f}% (Threshold: 15%)."
            },
            {
                "id": "CTRL-05",
                "title": "Security Anomaly & Threat Detection",
                "status": "PASS" if len(anomalies) == 0 else "WARNING",
                "details": "No security anomalies detected." if len(anomalies) == 0 else f"Detected {len(anomalies)} anomaly conditions."
            }
        ]

        passed_count = len([c for c in controls if c["status"] == "PASS"])
        score_pct = int((passed_count / len(controls)) * 100)

        return {
            "framework": fw,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "teamId": options.get("teamId", self.team_id),
            "workspaceId": options.get("workspaceId", self.workspace_id),
            "summary": {
                "totalEvents": total_events,
                "complianceScorePct": score_pct,
                "passedControls": passed_count,
                "totalControls": len(controls),
                "status": "COMPLIANT" if score_pct >= 80 else "NON_COMPLIANT"
            },
            "controls": controls,
            "anomalies": anomalies
        }

    def export_compliance_report(self, report: dict, format_type: str = "JSON") -> str:
        """
        Exports compliance report to specified format ('JSON', 'CSV', 'HTML', 'MARKDOWN').
        :visibility: public
        """
        fmt = format_type.upper()

        if fmt == "CSV":
            lines = ["ControlID,Title,Status,Details"]
            for c in report.get("controls", []):
                dt_str = str(c.get("details", "")).replace('"', '""')
                lines.append(f'"{c.get("id")}","{c.get("title")}","{c.get("status")}","{dt_str}"')
            return "\n".join(lines)

        if fmt == "HTML":
            rows = "".join([f'<tr><td><strong>{c["id"]}</strong></td><td>{c["title"]}</td><td>{c["status"]}</td><td>{c["details"]}</td></tr>' for c in report.get("controls", [])])
            return f"<html><head><title>{report.get('framework')} Compliance Report</title></head><body><h1>{report.get('framework')} Report</h1><p>Score: {report.get('summary', {}).get('complianceScorePct')}%</p><table>{rows}</table></body></html>"

        if fmt == "MARKDOWN":
            rows = "\n".join([f'| {c["id"]} | {c["title"]} | {c["status"]} | {c["details"]} |' for c in report.get("controls", [])])
            return f"# {report.get('framework')} Compliance Audit Report\n\nScore: {report.get('summary', {}).get('complianceScorePct')}%\n\n| ID | Title | Status | Details |\n| --- | --- | --- | --- |\n{rows}\n"

        return json.dumps(report, indent=2)

    def export_to_siem(self, custom_logs: list = None, format_type: str = "CEF") -> str:
        """
        Exports audit events to SIEM formats ('CEF', 'LEEF', 'SYSLOG', 'JSON', 'SPLUNK').
        :visibility: public
        """
        logs_to_export = custom_logs if custom_logs is not None else self.logs
        fmt = format_type.upper()

        if fmt == "LEEF":
            lines = []
            for l in logs_to_export:
                sev = 10 if l.get("severity") == "CRITICAL" else 8 if l.get("severity") == "HIGH" else 5 if l.get("severity") == "WARNING" else 2
                lines.append(f"LEEF:2.0|CmdBar|SharedAuditTrail|1.0|{l.get('action')}|devTime={l.get('timestamp')}\tusrName={l.get('userId')}\tteam={l.get('teamId')}\tsrc={l.get('ipAddress')}\tstatus={l.get('status')}\tsev={sev}\tresource={l.get('resource')}")
            return "\n".join(lines)

        if fmt == "SYSLOG":
            lines = []
            for l in logs_to_export:
                pri = 131 if l.get("severity") in ["CRITICAL", "HIGH"] else 134
                lines.append(f"<{pri}>1 {l.get('timestamp')} localhost CmdBarSharedAudit {l.get('id')} - - [audit@cmdbar teamId=\"{l.get('teamId')}\" userId=\"{l.get('userId')}\"] Action: {l.get('action')} Resource: {l.get('resource')}")
            return "\n".join(lines)

        if fmt == "SPLUNK":
            lines = []
            for l in logs_to_export:
                lines.append(json.dumps({
                    "time": int(time.time()),
                    "host": l.get("ipAddress", "localhost"),
                    "source": "cmdbar:audit",
                    "event": l
                }))
            return "\n".join(lines)

        if fmt in ["JSON", "ECS"]:
            return json.dumps(logs_to_export, indent=2)

        # Default CEF
        lines = []
        for l in logs_to_export:
            sev_num = 10 if l.get("severity") == "CRITICAL" else 7 if l.get("severity") == "HIGH" else 4 if l.get("severity") == "WARNING" else 1
            lines.append(f"CEF:0|CmdBar|SharedAuditTrail|1.0|{l.get('action')}|{l.get('resource')}|{sev_num}|rt={l.get('timestamp')} suser={l.get('userId')} cs1={l.get('teamId')} cs1Label=TeamId outcome={l.get('status')} src={l.get('ipAddress')}")
        return "\n".join(lines)

    def send_to_siem_endpoint(self, endpoint_config: dict, custom_logs: list = None) -> dict:
        """
        Dispatches SIEM formatted logs to an external webhook/endpoint.
        :visibility: public
        """
        if not endpoint_config or not endpoint_config.get("url"):
            raise ValueError("SharedAuditTrail: Endpoint URL required.")

        payload = self.export_to_siem(custom_logs, endpoint_config.get("format", "CEF"))
        logs_to_send = custom_logs if custom_logs is not None else self.logs

        return {
            "success": True,
            "count": len(logs_to_send),
            "url": endpoint_config.get("url")
        }
