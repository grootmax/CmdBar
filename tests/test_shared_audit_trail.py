"""
Unit tests for Python SharedAuditTrail module.
"""

import os
import json
import tempfile
import pytest
from companion.shared_audit_trail import SharedAuditTrail, mask_pii, compute_hmac


def test_mask_pii():
    text = "User email test@example.com with password secret123 and IP 10.0.0.1"
    masked = mask_pii(text)
    assert "test@example.com" not in masked
    assert "secret123" not in masked
    assert "10.0.0.1" not in masked
    assert "[REDACTED_EMAIL]" in masked
    assert "[REDACTED_PASSWORD]" in masked
    assert "[REDACTED_IP]" in masked


def test_audit_event_logging_and_signature_integrity():
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tf:
        temp_path = tf.name

    try:
        audit = SharedAuditTrail(team_id="team-pytest", log_path=temp_path, hmac_key="test-key")
        entry1 = audit.log_event(action="test.action1", resource="res1")
        entry2 = audit.log_event(action="test.action2", resource="res2")

        assert entry1["id"] is not None
        assert entry2["previousSignature"] == entry1["signature"]

        integrity = audit.verify_integrity()
        assert integrity["valid"] is True
        assert integrity["totalVerified"] == 2
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def test_tamper_detection():
    audit = SharedAuditTrail(team_id="team-pytest", hmac_key="test-key")
    audit.log_event(action="test.action1")
    audit.log_event(action="test.action2")

    # Tamper with first entry
    audit.logs[0]["action"] = "tampered.action"

    integrity = audit.verify_integrity()
    assert integrity["valid"] is False
    assert len(integrity["errors"]) > 0


def test_gdpr_purge_and_retention():
    audit = SharedAuditTrail(team_id="team-pytest")
    audit.log_event(action="user.action", user_id="user-to-delete")
    audit.log_event(action="other.action", user_id="user-keep")

    purge_res = audit.purge_user_data("user-to-delete")
    assert purge_res["success"] is True
    assert purge_res["purgedCount"] == 1

    assert audit.logs[0]["userId"].startswith("ANONYMIZED_")

    integrity = audit.verify_integrity()
    assert integrity["valid"] is True


def test_compliance_report_and_siem_export():
    audit = SharedAuditTrail(team_id="team-compliance")
    audit.log_event(action="config.update", status="SUCCESS")

    report = audit.generate_compliance_report("SOC2")
    assert report["framework"] == "SOC2"
    assert report["summary"]["complianceScorePct"] > 0

    json_report = audit.export_compliance_report(report, "JSON")
    csv_report = audit.export_compliance_report(report, "CSV")
    html_report = audit.export_compliance_report(report, "HTML")
    md_report = audit.export_compliance_report(report, "MARKDOWN")

    assert "SOC2" in json_report
    assert "ControlID,Title,Status,Details" in csv_report
    assert "<html>" in html_report
    assert "# SOC2 Compliance Audit Report" in md_report

    cef = audit.export_to_siem(format_type="CEF")
    leef = audit.export_to_siem(format_type="LEEF")
    syslog = audit.export_to_siem(format_type="SYSLOG")
    splunk = audit.export_to_siem(format_type="SPLUNK")

    assert "CEF:0|CmdBar|SharedAuditTrail|1.0|config.update" in cef
    assert "LEEF:2.0|CmdBar|SharedAuditTrail|1.0|config.update" in leef
    assert "CmdBarSharedAudit" in syslog
    assert '"source": "cmdbar:audit"' in splunk


def test_anomaly_detection_and_alerts():
    audit = SharedAuditTrail(team_id="team-alerts")

    alerts = []
    audit.register_alert_handler(lambda a: alerts.append(a))

    for _ in range(6):
        audit.log_event(action="privilege.escalation", user_id="attacker", status="DENIED", severity="CRITICAL")

    anomalies = audit.detect_anomalies()
    assert len(anomalies) > 0
    assert len(alerts) > 0
