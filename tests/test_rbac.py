import time
import pytest
from companion.rbac import (
    RBACManager,
    AuditLogger,
    has_permission,
    DEFAULT_PERMISSIONS,
    DEFAULT_ROLES,
)

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

def test_has_permission_exact_and_wildcards():
    assert has_permission(["commands:view", "commands:execute"], "commands:execute") is True
    assert has_permission(["commands:view"], "commands:execute") is False
    assert has_permission(["*"], "rbac:manage") is True
    assert has_permission(["commands:*"], "commands:execute") is True
    assert has_permission(["commands:*"], "commands:approve") is True
    assert has_permission(["commands:*"], "rbac:manage") is False

def test_audit_logger():
    logger = AuditLogger()
    logger.log("alice", "user", "COMMAND_EXECUTE", "ping", "ALLOWED")
    logger.log("bob", "admin", "ROLE_ASSIGNED", "charlie", "SUCCESS")
    logger.log("alice", "user", "COMMAND_EXECUTE", "deploy", "DENIED")

    assert len(logger.logs) == 3

    alice_logs = logger.get_logs(actor="alice")
    assert len(alice_logs) == 2

    denied_logs = logger.get_logs(result="DENIED")
    assert len(denied_logs) == 1
    assert denied_logs[0]["target"] == "deploy"

    logger.clear()
    assert len(logger.logs) == 0

def test_rbac_user_roles_and_permissions():
    rbac = RBACManager({
        "users": {
            "alice": {"role": "admin"},
            "bob": {"role": "operator"},
            "charlie": {"role": "user"},
            "dave": {"role": "viewer"},
        }
    })

    assert rbac.get_user_role("unknown") == "user"
    assert rbac.get_user_role("alice") == "admin"
    assert rbac.get_user_role("bob") == "operator"

    rbac.set_user_role("charlie", "operator", actor="alice")
    assert rbac.get_user_role("charlie") == "operator"

    alice_perms = rbac.get_effective_permissions("alice")
    assert "*" in alice_perms

    dave_perms = rbac.get_effective_permissions("dave")
    assert "commands:view" in dave_perms
    assert "commands:execute" not in dave_perms

def test_command_visibility_rules():
    rbac = RBACManager({
        "users": {
            "admin1": {"role": "admin"},
            "op1": {"role": "operator"},
            "user1": {"role": "user"},
        }
    })

    commands = [
        {"name": "Public Echo", "command": "echo hi", "visibility": "public"},
        {"name": "Admin Exec", "command": "reboot", "visibility": "admin-only"},
        {"name": "Operator Tool", "command": "deploy", "required_role": "operator"},
        {"name": "Hidden", "command": "secret", "visibility": "hidden"},
    ]

    assert rbac.is_command_visible(commands[0], "user1") is True
    assert rbac.is_command_visible(commands[1], "user1") is False
    assert rbac.is_command_visible(commands[2], "user1") is False
    assert rbac.is_command_visible(commands[3], "user1") is False

    assert rbac.is_command_visible(commands[2], "op1") is True
    assert rbac.is_command_visible(commands[1], "admin1") is True

    categories = [{"name": "Utils", "commands": commands}]
    visible = rbac.get_visible_commands(categories, "user1")
    assert len(visible) == 1
    assert len(visible[0]["commands"]) == 1
    assert visible[0]["commands"][0]["name"] == "Public Echo"

def test_approval_chains():
    rbac = RBACManager({
        "users": {
            "admin1": {"role": "admin"},
            "op1": {"role": "operator"},
            "user1": {"role": "user"},
        }
    })

    cmd = {
        "name": "Drop Database",
        "command": "dropdb prod",
        "requires_approval": True,
    }

    res_user = rbac.can_execute_command(cmd, "user1")
    assert res_user["allowed"] is False
    assert res_user["requires_approval"] is True

    res_admin = rbac.can_execute_command(cmd, "admin1")
    assert res_admin["allowed"] is True

    req = rbac.create_approval_request(cmd["name"], cmd["command"], "user1", reason="deploy fix")
    assert req["status"] == "pending"
    assert len(rbac.get_pending_approval_requests()) == 1

    approved = rbac.approve_request(req["id"], "op1", review_reason_or_time="ok")
    assert approved["status"] == "approved"
    assert approved["reviewed_by"] == "op1"

    req2 = rbac.create_approval_request(cmd["name"], cmd["command"], "user1")
    rejected = rbac.reject_request(req2["id"], "op1", reason="not allowed")
    assert rejected["status"] == "rejected"

    with pytest.raises(PermissionError):
        req3 = rbac.create_approval_request(cmd["name"], cmd["command"], "user1")
        rbac.approve_request(req3["id"], "user1")

def test_delegation_lifecycle():
    rbac = RBACManager({
        "users": {
            "admin1": {"role": "admin"},
            "user1": {"role": "user"},
        }
    })

    now = time.time() * 1000
    del_obj = rbac.create_delegation(
        delegator="admin1",
        delegatee="user1",
        role="operator",
        duration_ms=60000,
        reason="shift coverage",
    )

    perms = rbac.get_effective_permissions("user1", current_time=now / 1000)
    assert "commands:approve" in perms or "command:approve" in perms or "commands:view" in perms

    # Check future expiration
    future = (now + 120000) / 1000
    perms_future = rbac.get_effective_permissions("user1", current_time=future)
    assert "commands:approve" not in perms_future

    # Revoke delegation
    rbac.revoke_delegation(del_obj["id"], revoked_by="admin1")
    perms_revoked = rbac.get_effective_permissions("user1", current_time=now / 1000)
    assert "commands:approve" not in perms_revoked

def test_rbac_performance_benchmarks():
    rbac = RBACManager({
        "users": {"user1": {"role": "user"}, "admin1": {"role": "admin"}}
    })

    start = time.time()
    for _ in range(10000):
        rbac.check_permission("user1", "commands:execute")
    elapsed = time.time() - start

    assert elapsed < 0.5
