import time
import pytest
from app.config_schema import (
    match_pattern,
    is_user_in_context,
    create_approval_token,
    validate_approval_token,
    grant_approval_override,
    evaluate_command_policy
)
from companion.dbus_service import CmdBarDBusService


def test_match_pattern_strategies():
    assert match_pattern("make build", "make build", "exact") is True
    assert match_pattern("make build", "make clean", "exact") is False

    assert match_pattern("sudo rm -rf /tmp", "rm -rf", "substring") is True
    assert match_pattern("echo Hello", "rm -rf", "substring") is False

    assert match_pattern("rm -rf /var/log/app.log", "rm -rf *", "glob") is True
    assert match_pattern("sudo apt update", "sudo *", "glob") is True
    assert match_pattern("git checkout main", "sudo *", "glob") is False

    assert match_pattern("curl -X POST https://api.internal/deploy", "^curl.*deploy$", "regex") is True
    assert match_pattern("curl https://example.com", "^curl.*deploy$", "regex") is False

    assert match_pattern("/usr/bin/python3 script.py", "python3", "binary") is True
    assert match_pattern("docker run -d nginx", "docker", "binary") is True


def test_is_user_in_context():
    ctx_alice = {"username": "alice", "groups": ["developers", "staff"]}
    ctx_bob = {"username": "bob", "groups": ["interns"]}

    assert is_user_in_context(ctx_alice, ["alice"], None) is True
    assert is_user_in_context(ctx_bob, ["alice"], None) is False

    assert is_user_in_context(ctx_alice, None, ["developers"]) is True
    assert is_user_in_context(ctx_bob, None, ["developers"]) is False


def test_approval_token_generation_and_validation():
    cmd = "rm -rf /tmp/cache"
    token = create_approval_token(cmd, approver="security-admin", expires_in_sec=3600)
    assert isinstance(token, str)

    res = validate_approval_token(token, cmd)
    assert res["valid"] is True
    assert res["tokenData"]["approver"] == "security-admin"

    expired_token = create_approval_token(cmd, approver="admin", expires_in_sec=-10)
    res_expired = validate_approval_token(expired_token, cmd)
    assert res_expired["valid"] is False
    assert "expired" in res_expired["error"]

    res_mismatch = validate_approval_token(token, "sudo reboot")
    assert res_mismatch["valid"] is False
    assert "mismatch" in res_mismatch["error"]


def test_grant_approval_override():
    overrides = {}
    cmd = "sudo systemctl restart nginx"
    entry = grant_approval_override(overrides, cmd, approver="ops-lead", expires_in_sec=1800)
    assert entry is not None
    assert overrides[cmd]["approved_by"] == "ops-lead"


def test_evaluate_command_policy_blacklist_and_whitelist():
    policy = {
        "enabled": True,
        "blacklist": [
            "rm -rf *",
            {"pattern": "^sudo.*", "type": "regex", "reason": "Sudo blocked without approval."}
        ],
        "whitelist": [
            "git status",
            "make build"
        ]
    }

    # Blacklist check
    res_bl = evaluate_command_policy("rm -rf /tmp/data", None, policy)
    assert res_bl["allowed"] is False
    assert res_bl["requiresApproval"] is True

    res_sudo = evaluate_command_policy("sudo reboot", None, policy)
    assert res_sudo["allowed"] is False
    assert "Sudo blocked without approval" in res_sudo["reason"]

    # Whitelist check
    res_wl_pass = evaluate_command_policy("git status", None, policy)
    assert res_wl_pass["allowed"] is True

    res_wl_block = evaluate_command_policy("python3 script.py", None, policy)
    assert res_wl_block["allowed"] is False
    assert "not in the approved whitelist" in res_wl_block["reason"]


def test_evaluate_command_policy_override_and_user_groups():
    policy = {
        "enabled": True,
        "blacklist": [
            {"pattern": "deploy *", "type": "glob", "groups": ["interns"], "reason": "Intern deploy blocked."}
        ]
    }

    intern_ctx = {"username": "bob", "groups": ["interns"]}
    senior_ctx = {"username": "alice", "groups": ["seniors"]}

    res_intern = evaluate_command_policy("deploy staging", intern_ctx, policy)
    assert res_intern["allowed"] is False
    assert "Intern deploy blocked" in res_intern["reason"]

    res_senior = evaluate_command_policy("deploy staging", senior_ctx, policy)
    assert res_senior["allowed"] is True

    # Override test
    overrides = {}
    grant_approval_override(overrides, "deploy staging", approver="lead", expires_in_sec=3600)
    res_override = evaluate_command_policy("deploy staging", intern_ctx, policy, overrides)
    assert res_override["allowed"] is True
    assert res_override["overrideActive"] is True


def test_dbus_service_policy_and_override_integration(tmp_path, monkeypatch):
    cfg_file = tmp_path / "config.json"
    monkeypatch.setenv("CMDBAR_CONFIG_PATH", str(cfg_file))

    dbus = CmdBarDBusService(config_path=str(cfg_file))
    dbus.add_command("Safe Echo", "echo Hello World", "General")
    dbus.add_command("Danger Command", "rm -rf /tmp/testdir", "Danger")

    # Configure policy in loaded config
    from companion.companion_app import load_config, save_config
    cfg = load_config()
    cfg["policy"] = {
        "enabled": True,
        "blacklist": ["rm -rf *"]
    }
    save_config(cfg)

    # Evaluate via DBus service method
    eval_json = dbus.evaluate_policy("rm -rf /tmp/testdir")
    import json
    eval_res = json.loads(eval_json)
    assert eval_res["allowed"] is False

    # Execute blocked command
    executed_events = []
    output_events = []
    dbus.add_listener(
        on_executed=lambda name, code, success: executed_events.append((name, code, success)),
        on_output=lambda name, out, err: output_events.append((name, out, err))
    )

    res_exec_blocked = dbus.execute_command("Danger Command")
    assert res_exec_blocked is False
    assert len(executed_events) == 1
    assert executed_events[0][2] is False  # success is False
    assert "blocked by security policy" in output_events[0][2]

    # Grant override via DBus service method
    grant_ok = dbus.grant_override("rm -rf /tmp/testdir", approver="admin", expires_in_sec=3600)
    assert grant_ok is True

    # Execute again after override
    res_exec_override = dbus.execute_command("Danger Command")
    assert res_exec_override is True
