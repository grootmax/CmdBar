import os
import json
import time
import pytest
from app.workspace_manager import (
    WorkspaceManager,
    ROLE_ADMIN,
    ROLE_MEMBER,
    ROLE_VIEWER,
    BILLING_PLANS
)


@pytest.fixture
def manager(tmp_path):
    config_file = str(tmp_path / "config.json")
    return WorkspaceManager(config_file)


def test_create_and_get_workspace(manager):
    ws = manager.create_workspace("DevOps Team", "alice_123", organization="Acme Corp", plan="free")
    assert ws["id"].startswith("ws_")
    assert ws["name"] == "DevOps Team"
    assert ws["organization"] == "Acme Corp"
    assert ws["owner_id"] == "alice_123"
    assert ws["plan"] == "free"
    assert len(ws["members"]) == 1
    assert ws["members"][0]["user_id"] == "alice_123"
    assert ws["members"][0]["role"] == ROLE_ADMIN

    retrieved = manager.get_workspace(ws["id"])
    assert retrieved["name"] == "DevOps Team"


def test_list_and_delete_workspace(manager):
    ws1 = manager.create_workspace("Backend", "alice", plan="free")
    ws2 = manager.create_workspace("Frontend", "bob", plan="pro")

    all_ws = manager.list_workspaces()
    assert len(all_ws) == 2

    alice_ws = manager.list_workspaces(user_id="alice")
    assert len(alice_ws) == 1
    assert alice_ws[0]["id"] == ws1["id"]

    # Non-admin cannot delete
    with pytest.raises(PermissionError):
        manager.delete_workspace(ws1["id"], requesting_user_id="charlie")

    # Owner can delete
    assert manager.delete_workspace(ws1["id"], requesting_user_id="alice") is True
    assert len(manager.list_workspaces()) == 1


def test_rbac_and_member_management(manager):
    ws = manager.create_workspace("Security", "admin_user", plan="pro")
    ws_id = ws["id"]

    # Add member
    manager.add_member(ws_id, "dev_user", role=ROLE_MEMBER, requesting_user_id="admin_user")
    manager.add_member(ws_id, "auditor", role=ROLE_VIEWER, requesting_user_id="admin_user")

    # Permissions checks
    assert manager.check_permission(ws_id, "admin_user", "manage_members") is True
    assert manager.check_permission(ws_id, "dev_user", "manage_members") is False
    assert manager.check_permission(ws_id, "dev_user", "manage_commands") is True
    assert manager.check_permission(ws_id, "auditor", "manage_commands") is False
    assert manager.check_permission(ws_id, "auditor", "view_analytics") is True

    # Update role
    manager.update_member_role(ws_id, "auditor", ROLE_MEMBER, requesting_user_id="admin_user")
    assert manager.check_permission(ws_id, "auditor", "manage_commands") is True

    # Non-admin cannot add member
    with pytest.raises(PermissionError):
        manager.add_member(ws_id, "hacker", role=ROLE_ADMIN, requesting_user_id="dev_user")

    # Owner cannot be removed
    with pytest.raises(ValueError):
        manager.remove_member(ws_id, "admin_user", requesting_user_id="admin_user")

    # Remove member
    assert manager.remove_member(ws_id, "dev_user", requesting_user_id="admin_user") is True


def test_shared_commands_and_category_merging(manager):
    ws = manager.create_workspace("SRE", "sre_admin", plan="free")
    ws_id = ws["id"]

    cmd1 = {
        "name": "Check Cluster Health",
        "command": "kubectl get nodes",
        "placeholder": ""
    }
    manager.add_shared_command(ws_id, "Kubernetes", cmd1, requesting_user_id="sre_admin")

    user_config = {
        "active_workspace_id": ws_id,
        "categories": [
            {
                "name": "Local Tools",
                "commands": [{"name": "Local Echo", "command": "echo hi"}]
            }
        ]
    }

    merged = manager.get_merged_categories(user_config)
    assert len(merged) == 2
    assert merged[0]["name"] == "Local Tools"
    assert merged[1]["name"] == "[SRE] Kubernetes"
    assert merged[1]["commands"][0]["name"] == "Check Cluster Health"
    assert merged[1]["commands"][0]["is_shared"] is True


def test_usage_analytics(manager):
    ws = manager.create_workspace("Analytics Test", "owner1", plan="free")
    ws_id = ws["id"]

    manager.record_command_execution(ws_id, "owner1", "Deploy Prod", category="CI/CD", status="success", duration_ms=120)
    manager.record_command_execution(ws_id, "owner1", "Deploy Prod", category="CI/CD", status="failed", duration_ms=45)
    manager.record_command_execution(ws_id, "user2", "Restart Server", category="Ops", status="success", duration_ms=80)

    report = manager.get_usage_analytics(ws_id, requesting_user_id="owner1")
    assert report["total_executions"] == 3
    assert report["success_count"] == 2
    assert report["failure_count"] == 1
    assert report["success_rate"] == 66.67
    assert report["top_commands"]["Deploy Prod"] == 2
    assert len(report["recent_logs"]) == 3


def test_billing_and_quota_limits(manager):
    ws = manager.create_workspace("Starter", "owner_a", plan="free")  # max 3 members
    ws_id = ws["id"]

    manager.add_member(ws_id, "m1", role=ROLE_MEMBER, requesting_user_id="owner_a")
    manager.add_member(ws_id, "m2", role=ROLE_MEMBER, requesting_user_id="owner_a")

    # Reaching member limit (3/3)
    with pytest.raises(ValueError) as exc:
        manager.add_member(ws_id, "m3", role=ROLE_MEMBER, requesting_user_id="owner_a")
    assert "Workspace member limit reached" in str(exc.value)

    # Upgrade to Pro
    status = manager.update_billing_plan(ws_id, "pro", requesting_user_id="owner_a")
    assert status["plan"] == "pro"
    assert status["max_members"] == 25

    # Now adding m3 succeeds
    manager.add_member(ws_id, "m3", role=ROLE_MEMBER, requesting_user_id="owner_a")
    assert len(manager.get_workspace(ws_id)["members"]) == 4


def test_private_registry(manager):
    ws = manager.create_workspace("Registry Test", "pkg_owner", plan="pro")
    ws_id = ws["id"]

    pkg_commands = [
        {"name": "Database Backup", "command": "pg_dump production_db > backup.sql"}
    ]

    pkg = manager.publish_to_registry(
        ws_id,
        "db-tools",
        "Database Utility Kit",
        "1.0.0",
        pkg_commands,
        requesting_user_id="pkg_owner",
        description="Core database backup scripts"
    )
    assert pkg["package_id"] == "db-tools"

    # Search registry
    results = manager.search_registry(ws_id, query="database")
    assert len(results) == 1
    assert results[0]["name"] == "Database Utility Kit"

    # Install into user config
    user_cfg = {"categories": []}
    updated_cfg = manager.install_from_registry(ws_id, "db-tools", user_cfg)
    assert len(updated_cfg["categories"]) == 1
    assert updated_cfg["categories"][0]["name"] == "Registry: Database Utility Kit"


def test_slack_integration(manager):
    ws = manager.create_workspace("Slack Test", "slack_admin", plan="enterprise")
    ws_id = ws["id"]

    slack_cfg = manager.configure_slack(
        ws_id,
        "https://hooks.slack.com/services/TEST/HOOK/123",
        channel="#cmdbar-alerts",
        enabled=True,
        requesting_user_id="slack_admin"
    )
    assert slack_cfg["enabled"] is True

    payload = manager.format_slack_payload(
        ws_id,
        "command_execution",
        "Command 'Deploy Staging' executed by alice",
        {"status": "success", "duration_ms": "150ms"}
    )
    assert payload["channel"] == "#cmdbar-alerts"
    assert "Slack Test" in payload["text"]
    assert len(payload["blocks"]) == 3


def test_performance_benchmark(manager):
    ws = manager.create_workspace("Perf Workspace", "perf_owner", plan="enterprise")
    ws_id = ws["id"]

    for i in range(50):
        manager.add_shared_command(
            ws_id,
            f"Category_{i % 5}",
            {"name": f"Cmd_{i}", "command": f"echo {i}"},
            requesting_user_id="perf_owner"
        )

    user_config = {"active_workspace_id": ws_id, "categories": []}

    start_time = time.perf_counter()
    for _ in range(200):
        manager.get_merged_categories(user_config)
    elapsed = time.perf_counter() - start_time

    # 200 merges should complete under 0.5s (<2.5ms per merge)
    assert elapsed < 0.5
