import os
import json
import time
import random
import string
from datetime import datetime, timezone

DEFAULT_PERMISSIONS = {
    "COMMANDS_VIEW": "commands:view",
    "COMMANDS_EXECUTE": "commands:execute",
    "COMMANDS_APPROVE": "commands:approve",
    "COMMANDS_MANAGE": "commands:manage",
    "RBAC_MANAGE": "rbac:manage",
    "AUDIT_VIEW": "audit:view",
    "ALL": "*",
}

DEFAULT_ROLES = {
    "admin": {
        "name": "Admin",
        "description": "Administrator with full access",
        "permissions": ["*"],
    },
    "operator": {
        "name": "Operator",
        "description": "Operator with command execution and approval access",
        "permissions": ["commands:view", "commands:execute", "commands:approve"],
    },
    "user": {
        "name": "User",
        "description": "Standard user with command execution access",
        "permissions": ["commands:view", "commands:execute"],
    },
    "viewer": {
        "name": "Viewer",
        "description": "Read-only access to view commands",
        "permissions": ["commands:view"],
    },
    "auditor": {
        "name": "Auditor",
        "description": "Access to view commands and audit trail",
        "permissions": ["commands:view", "audit:view"],
    },
}

def has_permission(granted, required):
    """
    Checks if granted permissions list satisfies required permission(s).
    Supports superuser wildcard '*' and namespace wildcards e.g. 'commands:*'.
    """
    if not granted or not isinstance(granted, list):
        return False
    if not required:
        return True

    if "*" in granted:
        return True

    req_list = required if isinstance(required, list) else [required]
    if not req_list:
        return True

    for req in req_list:
        if not req:
            continue
        if req in granted:
            continue

        matched = False
        for g in granted:
            if isinstance(g, str) and g.endswith(":*"):
                prefix = g[:-1]  # e.g. 'commands:'
                if str(req).startswith(prefix):
                    matched = True
                    break
        if not matched:
            return False

    return True


class AuditLogger:
    def __init__(self, logs=None, max_logs=1000):
        self.logs = logs if logs is not None else []
        self.max_logs = max_logs

    def log(self, actor, role, action, target, result, details=None):
        rand_str = ''.join(random.choices(string.ascii_lowercase + string.digits, k=7))
        entry = {
            "id": f"audit_{int(time.time() * 1000)}_{rand_str}",
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "actor": actor or "anonymous",
            "role": role or "unknown",
            "action": action or "UNKNOWN_ACTION",
            "target": target or "system",
            "result": result or "UNKNOWN",
            "details": details or {},
        }
        self.logs.insert(0, entry)
        if len(self.logs) > self.max_logs:
            self.logs = self.logs[:self.max_logs]
        return entry

    def get_logs(self, actor=None, action=None, target=None, result=None, since=None, until=None, limit=None):
        filtered = list(self.logs)
        if actor:
            a = actor.lower()
            filtered = [l for l in filtered if (l.get("actor") or "").lower() == a]
        if action:
            act = action.upper()
            filtered = [l for l in filtered if (l.get("action") or "").upper() == act]
        if target:
            t = target.lower()
            filtered = [l for l in filtered if (l.get("target") or "").lower() == t]
        if result:
            r = result.upper()
            filtered = [l for l in filtered if (l.get("result") or "").upper() == r]
        if since:
            filtered = [l for l in filtered if l.get("timestamp", "") >= since]
        if until:
            filtered = [l for l in filtered if l.get("timestamp", "") <= until]
        if limit and isinstance(limit, int):
            filtered = filtered[:limit]
        return filtered

    def clear(self):
        self.logs = []


class RBACManager:
    def __init__(self, config=None):
        cfg = config or {}
        self.enabled = cfg.get("enabled", True)
        self.default_role = cfg.get("default_role", "user")
        self.roles = dict(DEFAULT_ROLES)
        if cfg.get("roles"):
            self.roles.update(cfg["roles"])
        self.users = cfg.get("users", {})
        self.delegations = cfg.get("delegations", [])
        self.approval_requests = cfg.get("approval_requests", [])
        self.audit_logger = AuditLogger(logs=cfg.get("audit_logs"))

    def to_json(self):
        return {
            "enabled": self.enabled,
            "default_role": self.default_role,
            "roles": self.roles,
            "users": self.users,
            "delegations": self.delegations,
            "approval_requests": self.approval_requests,
            "audit_logs": self.audit_logger.logs,
        }

    def get_user_role(self, username):
        if not username:
            return self.default_role
        user_data = self.users.get(username)
        if user_data and user_data.get("role"):
            return user_data["role"]
        return self.default_role

    def set_user_role(self, username, role, actor="admin"):
        if not username or not isinstance(username, str):
            return False
        if role not in self.roles:
            raise ValueError(f"Role '{role}' does not exist.")
        prev_role = self.get_user_role(username)
        if username not in self.users:
            self.users[username] = {}
        self.users[username]["role"] = role

        self.audit_logger.log(
            actor,
            self.get_user_role(actor),
            "ROLE_ASSIGNED",
            username,
            "SUCCESS",
            {"previous_role": prev_role, "new_role": role}
        )
        return True

    def get_active_delegations(self, username, now=None):
        if not username:
            return []
        current_time = now if now is not None else time.time() * 1000

        active = []
        for d in self.delegations:
            if not d or d.get("active") is False:
                continue
            if d.get("delegatee") != username:
                continue
            expires_at = d.get("expires_at")
            if expires_at:
                exp_ts = expires_at if isinstance(expires_at, (int, float)) else time.mktime(datetime.fromisoformat(expires_at.replace("Z", "")).timetuple()) * 1000
                if current_time >= exp_ts:
                    continue
            active.append(d)
        return active

    def get_effective_permissions(self, username, role=None, now=None):
        user_role_name = role or self.get_user_role(username)
        role_def = self.roles.get(user_role_name, {})
        perms = set(role_def.get("permissions", []))

        user_data = self.users.get(username, {})
        if isinstance(user_data.get("custom_permissions"), list):
            perms.update(user_data["custom_permissions"])

        active_delegated = self.get_active_delegations(username, now=now)
        for delegation in active_delegated:
            del_role = delegation.get("role")
            if del_role and del_role in self.roles:
                perms.update(self.roles[del_role].get("permissions", []))
            if isinstance(delegation.get("permissions"), list):
                perms.update(delegation["permissions"])

        return list(perms)

    def check_permission(self, username, required_permission, role=None, now=None):
        if not self.enabled:
            return True

        eff_perms = self.get_effective_permissions(username, role=role, now=now)
        allowed = has_permission(eff_perms, required_permission)
        user_role = self.get_user_role(username)

        target_str = ",".join(required_permission) if isinstance(required_permission, list) else str(required_permission)
        self.audit_logger.log(
            username,
            user_role,
            "PERMISSION_CHECK",
            target_str,
            "ALLOWED" if allowed else "DENIED",
            {"effective_permissions": eff_perms}
        )

        return allowed

    def is_command_visible(self, command, username, role=None, now=None):
        if not self.enabled:
            return True
        if not command or not isinstance(command, dict):
            return False

        user_role = role or self.get_user_role(username)
        eff_perms = self.get_effective_permissions(username, role=user_role, now=now)

        if user_role == "admin" or "*" in eff_perms:
            return command.get("visibility") != "hidden"

        vis = command.get("visibility")
        if vis == "hidden" or vis == "admin-only":
            return False

        if not has_permission(eff_perms, DEFAULT_PERMISSIONS["COMMANDS_VIEW"]):
            return False

        req_roles = command.get("required_roles") or ([command["required_role"]] if command.get("required_role") else [])
        if req_roles:
            active_d = self.get_active_delegations(username, now=now)
            user_roles = {user_role}
            for d in active_d:
                if d.get("role"):
                    user_roles.add(d["role"])
            if not any(r in user_roles for r in req_roles):
                return False

        req_perms = command.get("required_permissions") or ([command["required_permission"]] if command.get("required_permission") else [])
        if req_perms:
            if not has_permission(eff_perms, req_perms):
                return False

        return True

    def get_visible_commands(self, categories, username, role=None, now=None):
        if not isinstance(categories, list):
            return []
        if not self.enabled:
            return categories

        visible_cats = []
        for cat in categories:
            if not isinstance(cat, dict):
                continue

            if not self.is_command_visible(cat, username, role=role, now=now):
                continue

            visible_cmds = []
            cmds = cat.get("commands")
            if isinstance(cmds, list):
                for cmd in cmds:
                    if self.is_command_visible(cmd, username, role=role, now=now):
                        visible_cmds.append(cmd)

            if visible_cmds or (cmds is not None and len(cmds) == 0):
                cat_copy = dict(cat)
                cat_copy["commands"] = visible_cmds
                visible_cats.append(cat_copy)

        return visible_cats

    def can_execute_command(self, command, username, role=None, now=None):
        if not self.enabled:
            return {"allowed": True, "requires_approval": False}

        cmd_name = command if isinstance(command, str) else (command.get("name") or command.get("command"))
        cmd_obj = command if isinstance(command, dict) else {"name": cmd_name}
        user_role = role or self.get_user_role(username)
        eff_perms = self.get_effective_permissions(username, role=user_role, now=now)

        if not self.is_command_visible(cmd_obj, username, role=user_role, now=now):
            self.audit_logger.log(username, user_role, "COMMAND_EXECUTE", cmd_name, "DENIED", {
                "reason": "Command is not visible or allowed for user role"
            })
            return {"allowed": False, "requires_approval": False, "reason": "Command not visible or accessible."}

        if not has_permission(eff_perms, DEFAULT_PERMISSIONS["COMMANDS_EXECUTE"]):
            self.audit_logger.log(username, user_role, "COMMAND_EXECUTE", cmd_name, "DENIED", {
                "reason": "User lacks execute permission"
            })
            return {"allowed": False, "requires_approval": False, "reason": "Execution permission denied."}

        requires_approval = bool(cmd_obj.get("requires_approval") or cmd_obj.get("approval_required") or cmd_obj.get("approval_chain"))

        if requires_approval:
            can_auto_approve = has_permission(eff_perms, DEFAULT_PERMISSIONS["COMMANDS_APPROVE"]) or user_role == "admin"
            if not can_auto_approve:
                self.audit_logger.log(username, user_role, "COMMAND_EXECUTE", cmd_name, "PENDING_APPROVAL", {
                    "reason": "Command requires approver review"
                })
                return {
                    "allowed": False,
                    "requires_approval": True,
                    "reason": "Command execution requires admin or approver approval."
                }

        self.audit_logger.log(username, user_role, "COMMAND_EXECUTE", cmd_name, "ALLOWED", {
            "command_str": cmd_obj.get("command") or cmd_name
        })

        return {"allowed": True, "requires_approval": False}

    def create_approval_request(self, command_name, command_str, requested_by, reason=""):
        user_role = self.get_user_role(requested_by)
        rand_str = ''.join(random.choices(string.ascii_lowercase + string.digits, k=7))
        req = {
            "id": f"appr_{int(time.time() * 1000)}_{rand_str}",
            "command_name": command_name,
            "command_str": command_str or command_name,
            "requested_by": requested_by,
            "role": user_role,
            "status": "pending",
            "reason": reason or "Execution requested",
            "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "reviewed_by": None,
            "reviewed_at": None,
            "review_reason": None,
        }
        self.approval_requests.insert(0, req)

        self.audit_logger.log(requested_by, user_role, "APPROVAL_REQUESTED", command_name, "PENDING", {
            "approval_id": req["id"],
            "command_str": command_str,
            "reason": reason,
        })
        return req

    def approve_request(self, request_id, reviewer_username, review_reason=""):
        reviewer_role = self.get_user_role(reviewer_username)
        eff_perms = self.get_effective_permissions(reviewer_username)

        if not has_permission(eff_perms, DEFAULT_PERMISSIONS["COMMANDS_APPROVE"]) and reviewer_role != "admin":
            self.audit_logger.log(reviewer_username, reviewer_role, "APPROVAL_REVIEW", request_id, "DENIED", {
                "reason": "Reviewer lacks approval permission"
            })
            raise PermissionError(f"User '{reviewer_username}' does not have permission to approve requests.")

        req = next((r for r in self.approval_requests if r["id"] == request_id), None)
        if not req:
            raise ValueError(f"Approval request '{request_id}' not found.")

        req["status"] = "approved"
        req["reviewed_by"] = reviewer_username
        req["reviewed_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        req["review_reason"] = review_reason or "Approved"

        self.audit_logger.log(reviewer_username, reviewer_role, "APPROVAL_APPROVED", req["command_name"], "SUCCESS", {
            "approval_id": request_id,
            "requested_by": req["requested_by"],
            "review_reason": req["review_reason"],
        })
        return req

    def reject_request(self, request_id, reviewer_username, review_reason=""):
        reviewer_role = self.get_user_role(reviewer_username)
        eff_perms = self.get_effective_permissions(reviewer_username)

        if not has_permission(eff_perms, DEFAULT_PERMISSIONS["COMMANDS_APPROVE"]) and reviewer_role != "admin":
            self.audit_logger.log(reviewer_username, reviewer_role, "APPROVAL_REVIEW", request_id, "DENIED", {
                "reason": "Reviewer lacks approval permission"
            })
            raise PermissionError(f"User '{reviewer_username}' does not have permission to reject requests.")

        req = next((r for r in self.approval_requests if r["id"] == request_id), None)
        if not req:
            raise ValueError(f"Approval request '{request_id}' not found.")

        req["status"] = "rejected"
        req["reviewed_by"] = reviewer_username
        req["reviewed_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        req["review_reason"] = review_reason or "Rejected"

        self.audit_logger.log(reviewer_username, reviewer_role, "APPROVAL_REJECTED", req["command_name"], "REJECTED", {
            "approval_id": request_id,
            "requested_by": req["requested_by"],
            "review_reason": req["review_reason"],
        })
        return req

    def get_pending_approval_requests(self):
        return [r for r in self.approval_requests if r.get("status") == "pending"]

    def create_delegation(self, delegator, delegatee, role=None, permissions=None, command_name=None, duration_ms=3600000, reason=""):
        delegator_role = self.get_user_role(delegator)
        eff_perms = self.get_effective_permissions(delegator)

        if not has_permission(eff_perms, DEFAULT_PERMISSIONS["RBAC_MANAGE"]) and delegator_role != "admin":
            self.audit_logger.log(delegator, delegator_role, "DELEGATION_CREATE", delegatee, "DENIED", {
                "reason": "Delegator lacks rbac:manage permission"
            })
            raise PermissionError(f"User '{delegator}' does not have permission to delegate roles.")

        expires_at = time.time() * 1000 + duration_ms
        rand_str = ''.join(random.choices(string.ascii_lowercase + string.digits, k=7))

        delegation = {
            "id": f"del_{int(time.time() * 1000)}_{rand_str}",
            "delegator": delegator,
            "delegatee": delegatee,
            "role": role or None,
            "permissions": permissions or [],
            "command_name": command_name or None,
            "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "expires_at": expires_at,
            "reason": reason or "Delegated access",
            "active": True,
        }
        self.delegations.append(delegation)

        self.audit_logger.log(delegator, delegator_role, "DELEGATION_CREATED", delegatee, "SUCCESS", {
            "delegation_id": delegation["id"],
            "role": role,
            "permissions": permissions,
            "expires_at": datetime.fromtimestamp(expires_at / 1000.0, timezone.utc).isoformat().replace("+00:00", "Z"),
        })
        return delegation

    def revoke_delegation(self, delegation_id, revoker):
        revoker_role = self.get_user_role(revoker)
        eff_perms = self.get_effective_permissions(revoker)

        delegation = next((d for d in self.delegations if d.get("id") == delegation_id), None)
        if not delegation:
            raise ValueError(f"Delegation '{delegation_id}' not found.")

        if revoker != delegation["delegator"] and not has_permission(eff_perms, DEFAULT_PERMISSIONS["RBAC_MANAGE"]) and revoker_role != "admin":
            self.audit_logger.log(revoker, revoker_role, "DELEGATION_REVOKE", delegation_id, "DENIED", {
                "reason": "Revoker lacks permission"
            })
            raise PermissionError(f"User '{revoker}' cannot revoke delegation created by '{delegation['delegator']}'.")

        delegation["active"] = False

        self.audit_logger.log(revoker, revoker_role, "DELEGATION_REVOKED", delegation["delegatee"], "SUCCESS", {
            "delegation_id": delegation_id
        })
        return delegation
