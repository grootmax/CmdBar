import pytest
from app.workspace_manager import (
    WorkspaceManager,
    WORKSPACE_ROLES,
    PLAN_TIERS,
    PLAN_LIMITS
)

def test_workspace_creation():
    wm = WorkspaceManager()
    ws = wm.create_workspace(name="Dev Team", org_id="org_1", owner_id="user_admin")
    assert ws["id"].startswith("ws_")
    assert ws["name"] == "Dev Team"
    assert ws["plan_tier"] == PLAN_TIERS["FREE"]
    assert len(ws["members"]) == 1
    assert ws["members"][0]["user_id"] == "user_admin"
    assert ws["members"][0]["role"] == WORKSPACE_ROLES["ADMIN"]

def test_workspace_limits():
    wm = WorkspaceManager()
    wm.create_workspace(name="WS 1", org_id="org_1", owner_id="user_admin", plan_tier="free")
    with pytest.raises(ValueError, match="limit reached"):
        wm.create_workspace(name="WS 2", org_id="org_1", owner_id="user_admin", plan_tier="free")

def test_member_lifecycle():
    wm = WorkspaceManager()
    ws = wm.create_workspace(name="Ops", org_id="org_1", owner_id="user_admin", plan_tier="pro")

    # Add member
    m = wm.add_member(ws["id"], user_id="user_dev", role="member", actor_id="user_admin")
    assert m["user_id"] == "user_dev"
    assert m["role"] == WORKSPACE_ROLES["MEMBER"]
    assert wm.has_permission(ws["id"], "user_dev", WORKSPACE_ROLES["MEMBER"]) is True
    assert wm.has_permission(ws["id"], "user_dev", WORKSPACE_ROLES["ADMIN"]) is False

    # Update role
    updated = wm.update_member_role(ws["id"], target_user_id="user_dev", new_role="admin", actor_id="user_admin")
    assert updated["role"] == WORKSPACE_ROLES["ADMIN"]

    # Remove member
    removed = wm.remove_member(ws["id"], target_user_id="user_dev", actor_id="user_admin")
    assert removed is True
    assert wm.has_permission(ws["id"], "user_dev", WORKSPACE_ROLES["MEMBER"]) is False

def test_shared_commands_and_policy_validation():
    wm = WorkspaceManager()
    ws = wm.create_workspace(name="Cloud", org_id="org_1", owner_id="user_admin", plan_tier="pro")

    cmd = {"name": "Status", "command": "systemctl status nginx", "mode": "shell-quoted"}
    wm.add_shared_command(ws["id"], category_name="Services", command_data=cmd, actor_id="user_admin")

    assert len(ws["shared_categories"]) == 1
    assert ws["shared_categories"][0]["commands"][0]["name"] == "Status"

    # Dangerous command should fail policy check
    bad_cmd = {"name": "Destructive", "command": "rm -rf /", "mode": "shell-quoted"}
    with pytest.raises(ValueError, match="prohibited pattern"):
        wm.add_shared_command(ws["id"], category_name="Services", command_data=bad_cmd, actor_id="user_admin")

    # Merge into base config
    base = {"categories": [{"name": "Default", "commands": []}]}
    merged = wm.get_merged_config(ws["id"], base)
    assert len(merged["categories"]) == 2

    # Remove shared command
    wm.remove_shared_command(ws["id"], category_name="Services", command_name="Status", actor_id="user_admin")
    assert len(ws["shared_categories"]) == 0

def test_usage_analytics():
    wm = WorkspaceManager()
    ws = wm.create_workspace(name="Analytics", org_id="org_1", owner_id="user_admin")

    wm.record_command_execution(workspace_id=ws["id"], command_id="c1", command_name="Run Test", user_id="u1", duration_ms=100.0, success=True)
    wm.record_command_execution(workspace_id=ws["id"], command_id="c1", command_name="Run Test", user_id="u1", duration_ms=200.0, success=False, error_message="Failed")

    summary = wm.get_analytics_summary(ws["id"])
    assert summary["total_executions"] == 2
    assert summary["successful"] == 1
    assert summary["failed"] == 1
    assert summary["success_rate"] == 50.0
    assert summary["avg_duration_ms"] == 150.0

    csv_text = wm.export_analytics_csv(ws["id"])
    assert "Run Test" in csv_text
    assert "Failed" in csv_text

    json_text = wm.export_analytics_json(ws["id"])
    assert "Run Test" in json_text

def test_billing_plan_updates():
    wm = WorkspaceManager()
    ws = wm.create_workspace(name="Billing", org_id="org_1", owner_id="user_admin", plan_tier="free")

    assert wm.check_plan_limits(ws["id"], "private_registry")["allowed"] is False

    wm.update_billing_plan(ws["id"], new_plan_tier="enterprise", actor_id="user_admin")
    assert ws["plan_tier"] == PLAN_TIERS["ENTERPRISE"]
    assert wm.check_plan_limits(ws["id"], "private_registry")["allowed"] is True

def test_private_registry():
    wm = WorkspaceManager()
    ws = wm.create_workspace(name="Registry", org_id="org_1", owner_id="user_admin", plan_tier="enterprise")

    pkg = wm.publish_package(
        workspace_id=ws["id"],
        name="Security Tools",
        commands=[{"name": "Scan", "command": "nmap -sV localhost", "mode": "shell-quoted"}],
        actor_id="user_admin"
    )

    pkgs = wm.list_packages(ws["id"])
    assert len(pkgs) == 1

    search_res = wm.search_packages(ws["id"], "security")
    assert len(search_res) == 1

    wm.install_package(ws["id"], pkg["id"], actor_id="user_admin")
    assert any("Security Tools" in c["name"] for c in ws["shared_categories"])

    wm.uninstall_package(ws["id"], pkg["id"], actor_id="user_admin")
    assert not any("Security Tools" in c["name"] for c in ws["shared_categories"])

def test_slack_integration():
    wm = WorkspaceManager()
    ws = wm.create_workspace(name="Slack", org_id="org_1", owner_id="user_admin", plan_tier="pro")

    notif = wm.send_slack_notification(ws["id"], "member_joined", {"user": "new_user"})
    assert notif["text"].startswith("[CmdBar Alert: Slack]")

    resp_list = wm.handle_slack_slash_command(ws["id"], {"text": "list"})
    assert "Categories" in resp_list["text"]

    resp_stats = wm.handle_slack_slash_command(ws["id"], {"text": "stats"})
    assert "Executions" in resp_stats["text"]

    resp_exec = wm.handle_slack_slash_command(ws["id"], {"text": "exec ping"})
    assert "ping" in resp_exec["text"]
