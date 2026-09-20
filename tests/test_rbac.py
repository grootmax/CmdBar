import time
import pytest
from companion.rbac import RBACManager

@pytest.fixture
def rbac_manager():
    config = {
        "enabled": True,
        "default_role": "user",
        "roles": {
            "admin": {"name": "Admin", "permissions": ["*"]},
            "user": {"name": "User", "permissions": ["command:view", "command:execute"]},
            "operator": {"name": "Operator", "permissions": ["command:view", "command:execute", "approval:request"]},
            "approver": {"name": "Approver", "permissions": ["command:view", "command:approve"]},
            "auditor": {"name": "Auditor", "permissions": ["command:view", "audit:read"]},
        },
        "user_roles": {
            "alice": ["admin"],
            "bob": ["user"],
            "charlie": ["operator"],
            "david": ["approver"],
        },
        "user_permissions": {
            "bob": ["command:execute:staging"],
        },
    }
    return RBACManager(config)

def test_user_roles_and_permissions(rbac_manager):
    assert rbac_manager.get_user_roles("alice") == ["admin"]
    assert rbac_manager.get_user_roles("bob") == ["user"]
    assert rbac_manager.get_user_roles("unknown") == ["user"]

    rbac_manager.assign_user_role("eve", "operator")
    assert "operator" in rbac_manager.get_user_roles("eve")

    rbac_manager.remove_user_role("eve", "operator")
    assert "operator" not in rbac_manager.get_user_roles("eve")

def test_permission_matching():
    assert RBACManager.match_permission(["*"], "command:execute") is True
    assert RBACManager.match_permission(["command:*"], "command:execute") is True
    assert RBACManager.match_permission(["command:execute:*"], "command:execute:prod") is True
    assert RBACManager.match_permission(["command:execute:prod"], "command:execute:dev") is False

def test_command_visibility(rbac_manager):
    cmd_public = {"name": "Ping", "command": "ping 127.0.0.1", "visibility": "public"}
    cmd_hidden = {"name": "Secret", "command": "secret", "visibility": "hidden"}
    cmd_admin = {"name": "Admin Console", "command": "admin", "visibility": "admin_only"}
    cmd_role = {"name": "Deploy Prod", "command": "deploy", "allowed_roles": ["admin", "operator"]}
    cmd_perm = {"name": "Deploy Staging", "command": "staging", "required_permissions": ["command:execute:staging"]}

    assert rbac_manager.can_view_command("bob", cmd_public) is True
    assert rbac_manager.can_view_command("alice", cmd_hidden) is False
    assert rbac_manager.can_view_command("bob", cmd_admin) is False
    assert rbac_manager.can_view_command("alice", cmd_admin) is True

    assert rbac_manager.can_view_command("charlie", cmd_role) is True
    assert rbac_manager.can_view_command("bob", cmd_role) is False

    assert rbac_manager.can_view_command("bob", cmd_perm) is True
    assert rbac_manager.can_view_command("charlie", cmd_perm) is False

def test_filter_visible_commands(rbac_manager):
    categories = [
        {
            "name": "Tools",
            "commands": [
                {"name": "Ping", "command": "ping 127.0.0.1", "visibility": "public"},
                {"name": "Secret", "command": "secret", "visibility": "hidden"}
            ]
        },
        {
            "name": "Admin",
            "commands": [
                {"name": "Admin Console", "command": "admin", "visibility": "admin_only"}
            ]
        }
    ]

    filtered_bob = rbac_manager.filter_visible_commands(categories, "bob")
    assert len(filtered_bob) == 1
    assert filtered_bob[0]["commands"][0]["name"] == "Ping"

    filtered_alice = rbac_manager.filter_visible_commands(categories, "alice")
    assert len(filtered_alice) == 2

def test_approval_chain(rbac_manager):
    cmd_prod = {
        "name": "Production Exec",
        "command": "run prod",
        "requires_approval": True,
        "approval_chain": ["approver"]
    }

    res = rbac_manager.can_execute_command("bob", cmd_prod)
    assert res["allowed"] is False
    assert res["status"] == "requires_approval"
    req_id = res["approval_request_id"]

    # Approver approves
    req = rbac_manager.approve_request(req_id, "david")
    assert req["status"] == "approved"

    exec_res = rbac_manager.can_execute_command("bob", cmd_prod, {"approval_request_id": req_id})
    assert exec_res["allowed"] is True
    assert exec_res["status"] == "granted"

def test_approval_rejection(rbac_manager):
    cmd_prod = {
        "name": "Production Exec",
        "command": "run prod",
        "requires_approval": True,
        "approval_chain": ["approver"]
    }

    res = rbac_manager.can_execute_command("bob", cmd_prod)
    req_id = res["approval_request_id"]

    rbac_manager.reject_request(req_id, "david", "Unapproved time")
    req = rbac_manager.get_approval_request(req_id)
    assert req["status"] == "rejected"

    exec_res = rbac_manager.can_execute_command("bob", cmd_prod, {"approval_request_id": req_id})
    assert exec_res["allowed"] is False
    assert exec_res["status"] == "rejected"

def test_delegation(rbac_manager):
    del_obj = rbac_manager.create_delegation(
        delegator="alice",
        delegatee="bob",
        roles=["admin"]
    )
    assert del_obj["status"] == "active"
    assert "admin" in rbac_manager.get_effective_roles("bob")

    rbac_manager.revoke_delegation(del_obj["id"], "alice")
    assert "admin" not in rbac_manager.get_effective_roles("bob")

def test_audit_trail(rbac_manager):
    rbac_manager.assign_user_role("bob", "operator", actor="alice")
    logs = rbac_manager.query_audit_logs({"actor": "alice"})
    assert len(logs) > 0

    json_export = rbac_manager.export_audit_logs("json")
    assert "ROLE_ASSIGNED" in json_export

    csv_export = rbac_manager.export_audit_logs("csv")
    assert "ROLE_ASSIGNED" in csv_export
    assert "id,timestamp,actor,action,resource,outcome,details" in csv_export

def test_performance_benchmark(rbac_manager):
    start = time.time()
    for _ in range(10000):
        rbac_manager.has_permission("bob", "command:execute")
    duration = time.time() - start
    assert duration < 0.5
