import time
import pytest
from app.rbac import (
    RBACManager,
    AuditLogger,
    has_permission,
    DEFAULT_PERMISSIONS,
    DEFAULT_ROLES,
)

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

    approved = rbac.approve_request(req["id"], "op1", review_reason="ok")
    assert approved["status"] == "approved"
    assert approved["reviewed_by"] == "op1"

    req2 = rbac.create_approval_request(cmd["name"], cmd["command"], "user1")
    rejected = rbac.reject_request(req2["id"], "op1", review_reason="not allowed")
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

    perms = rbac.get_effective_permissions("user1", now=now)
    assert "commands:approve" in perms

    # Check future expiration
    future = now + 120000
    perms_future = rbac.get_effective_permissions("user1", now=future)
    assert "commands:approve" not in perms_future

    # Revoke delegation
    rbac.revoke_delegation(del_obj["id"], revoker="admin1")
    perms_revoked = rbac.get_effective_permissions("user1", now=now)
    assert "commands:approve" not in perms_revoked

def test_rbac_performance_benchmarks():
    rbac = RBACManager({
        "users": {"user1": {"role": "user"}, "admin1": {"role": "admin"}}
    })

    start = time.time()
    for _ in range(10000):
        rbac.check_permission("user1", "commands:execute")
    elapsed = time.time() - start

    # 10,000 checks should take less than 0.5s
    assert elapsed < 0.5
