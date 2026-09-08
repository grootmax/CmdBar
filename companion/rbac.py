import json
import uuid
import csv
import io
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


DEFAULT_RBAC_CONFIG = {
    "enabled": True,
    "default_role": "user",
    "roles": {
        "admin": {
            "name": "Administrator",
            "description": "Full system access with wildcard permissions",
            "permissions": ["*"]
        },
        "user": {
            "name": "Standard User",
            "description": "Standard command viewing and execution rights",
            "permissions": ["command:view", "command:execute"]
        },
        "operator": {
            "name": "Operator",
            "description": "Execution, viewing, and approval requesting capabilities",
            "permissions": ["command:view", "command:execute", "approval:request", "commands:view", "commands:execute", "commands:approve", "command:approve"]
        },
        "approver": {
            "name": "Approver",
            "description": "Command viewing and approval chain authorization",
            "permissions": ["command:view", "command:approve", "commands:view", "commands:approve"]
        },
        "viewer": {
            "name": "Viewer",
            "description": "Read-only access to view commands",
            "permissions": ["commands:view", "command:view"]
        },
        "auditor": {
            "name": "Auditor",
            "description": "Read-only access to commands and audit logs",
            "permissions": ["command:view", "audit:read"]
        }
    },
    "user_roles": {
        "admin": ["admin"],
        "alice": ["admin"],
        "bob": ["user"],
        "charlie": ["operator"],
        "david": ["approver"]
    },
    "user_permissions": {},
    "delegations": [],
    "approval_requests": [],
    "audit_logs": []
}

def _parse_time(t):
    if t is None:
        return datetime.now(timezone.utc)
    if isinstance(t, datetime):
        if t.tzinfo is None:
            return t.replace(tzinfo=timezone.utc)
        return t
    if isinstance(t, (int, float)):
        if t > 1e11:
            t = t / 1000.0
        return datetime.fromtimestamp(t, timezone.utc)
    if isinstance(t, str):
        try:
            return datetime.fromisoformat(t.replace("Z", "+00:00"))
        except Exception:
            return datetime.now(timezone.utc)
    return datetime.now(timezone.utc)

class RBACManager:
    def __init__(self, config=None):
        self.load_config(config or {})

    def load_config(self, config=None):
        config = config or {}
        base = json.loads(json.dumps(DEFAULT_RBAC_CONFIG))
        self.enabled = config.get("enabled", base["enabled"])
        self.default_role = config.get("default_role", base["default_role"])
        
        roles = base["roles"]
        if "roles" in config:
            roles.update(config["roles"])
        self.roles = roles

        user_roles = base["user_roles"]
        if "users" in config and isinstance(config["users"], dict):
            self.users = dict(config["users"])
            for u, udata in config["users"].items():
                if isinstance(udata, dict) and udata.get("role"):
                    user_roles[u] = [udata["role"]]
        else:
            self.users = getattr(self, "users", {})

        if "user_roles" in config:
            user_roles.update(config["user_roles"])
        self.user_roles = user_roles

        user_permissions = base["user_permissions"]
        if "user_permissions" in config:
            user_permissions.update(config["user_permissions"])
        self.user_permissions = user_permissions

        self.delegations = list(config.get("delegations", base["delegations"]))
        self.approval_requests = list(config.get("approval_requests", base["approval_requests"]))
        self.audit_logs = list(config.get("audit_logs", base["audit_logs"]))
        self.audit_logger = AuditLogger(logs=self.audit_logs)

    def export_config(self):
        return {
            "enabled": self.enabled,
            "default_role": self.default_role,
            "roles": json.loads(json.dumps(self.roles)),
            "user_roles": json.loads(json.dumps(self.user_roles)),
            "user_permissions": json.loads(json.dumps(self.user_permissions)),
            "delegations": json.loads(json.dumps(self.delegations)),
            "approval_requests": json.loads(json.dumps(self.approval_requests)),
            "audit_logs": json.loads(json.dumps(self.audit_logs))
        }

    def to_json(self):
        return {
            "enabled": self.enabled,
            "default_role": self.default_role,
            "roles": self.roles,
            "users": getattr(self, "users", {}),
            "delegations": self.delegations,
            "approval_requests": self.approval_requests,
            "audit_logs": self.audit_logs,
        }

    # --- Roles & Permissions ---

    def get_user_role(self, username):
        if not username:
            return self.default_role
        if hasattr(self, "users") and username in self.users:
            u = self.users[username]
            if isinstance(u, dict) and u.get("role"):
                return u["role"]
        roles = self.get_user_roles(username)
        return roles[0] if roles else self.default_role

    def set_user_role(self, username, role, actor="admin"):
        if not username or not isinstance(username, str):
            return False
        if role not in self.roles:
            raise ValueError(f"Role '{role}' does not exist.")
        if not hasattr(self, "users"):
            self.users = {}
        if username not in self.users:
            self.users[username] = {}
        self.users[username]["role"] = role
        self.assign_user_role(username, role, actor=actor)
        return True

    def get_user_roles(self, user):
        if not user:
            return [self.default_role]
        if hasattr(self, "users") and user in self.users:
            u = self.users[user]
            if isinstance(u, dict) and u.get("role"):
                return [u["role"]]
        roles = self.user_roles.get(user)
        if roles and isinstance(roles, list):
            return list(roles)
        return [self.default_role]

    def assign_user_role(self, user, role, actor="system"):
        if not user or not role:
            return False
        if user not in self.user_roles:
            self.user_roles[user] = []
        roles_to_add = role if isinstance(role, list) else [role]
        for r in roles_to_add:
            if r not in self.user_roles[user]:
                self.user_roles[user].append(r)
        self.log_audit(
            actor=actor,
            action="ROLE_ASSIGNED",
            resource=user,
            outcome="success",
            details={"assigned_roles": roles_to_add}
        )
        return True

    def remove_user_role(self, user, role, actor="system"):
        if not user or not role or user not in self.user_roles:
            return False
        self.user_roles[user] = [r for r in self.user_roles[user] if r != role]
        self.log_audit(
            actor=actor,
            action="ROLE_REVOKED",
            resource=user,
            outcome="success",
            details={"revoked_role": role}
        )
        return True

    def get_user_permissions(self, user):
        if not user or user not in self.user_permissions:
            return []
        return list(self.user_permissions[user])

    def assign_user_permission(self, user, permission, actor="system"):
        if not user or not permission:
            return False
        if user not in self.user_permissions:
            self.user_permissions[user] = []
        perms_to_add = permission if isinstance(permission, list) else [permission]
        for p in perms_to_add:
            if p not in self.user_permissions[user]:
                self.user_permissions[user].append(p)
        self.log_audit(
            actor=actor,
            action="PERMISSION_ASSIGNED",
            resource=user,
            outcome="success",
            details={"assigned_permissions": perms_to_add}
        )
        return True

    @staticmethod
    def match_permission(user_permissions, required_permission):
        if not isinstance(user_permissions, list) or not required_permission:
            return False
        if "*" in user_permissions:
            return True
        if required_permission in user_permissions:
            return True
        for perm in user_permissions:
            if isinstance(perm, str) and perm.endswith("*"):
                prefix = perm[:-1]
                if required_permission.startswith(prefix):
                    return True
        return False

    def get_active_delegations(self, user, current_time=None):
        if not user:
            return []
        now = _parse_time(current_time)
        active = []
        for d in self.delegations:
            if d.get("delegatee") != user or d.get("status") != "active":
                continue
            start = _parse_time(d.get("start_time"))
            if (start - now).total_seconds() > 5:
                continue
            if d.get("end_time"):
                end = _parse_time(d.get("end_time"))
                if end < now:
                    d["status"] = "expired"
                    continue
            active.append(d)
        return active

    def get_effective_roles(self, user, current_time=None):
        roles_set = set(self.get_user_roles(user))
        for d in self.get_active_delegations(user, current_time):
            for r in d.get("roles", []):
                roles_set.add(r)
            if d.get("role"):
                roles_set.add(d["role"])
        return list(roles_set)

    def get_effective_permissions(self, user, current_time=None):
        perm_set = set(self.get_user_permissions(user))
        roles = self.get_effective_roles(user, current_time)

        for r in roles:
            role_def = self.roles.get(r, {})
            for p in role_def.get("permissions", []):
                perm_set.add(p)

        for d in self.get_active_delegations(user, current_time):
            for p in d.get("permissions", []):
                perm_set.add(p)

        return list(perm_set)

    def has_permission(self, user, required_permission, current_time=None):
        if not self.enabled:
            return True
        effective_perms = self.get_effective_permissions(user, current_time)
        return RBACManager.match_permission(effective_perms, required_permission)

    def check_permission(self, username, required_permission, role=None, now=None):
        if not self.enabled:
            return True
        eff_perms = self.get_effective_permissions(username, current_time=now)
        allowed = has_permission(eff_perms, required_permission) or self.has_permission(username, required_permission, current_time=now)
        user_role = role or self.get_user_role(username)
        target_str = ",".join(required_permission) if isinstance(required_permission, list) else str(required_permission)
        self.log_audit(
            actor=username,
            action="PERMISSION_CHECK",
            resource=target_str,
            outcome="ALLOWED" if allowed else "DENIED",
            details={"effective_permissions": eff_perms}
        )
        return allowed

    # --- Command Visibility Rules ---

    def is_command_visible(self, command, username, role=None, now=None):
        if not self.enabled:
            return True
        if not command or not isinstance(command, dict):
            return False
        user_role = role or self.get_user_role(username)
        eff_perms = self.get_effective_permissions(username, current_time=now)
        if user_role == "admin" or "*" in eff_perms:
            return command.get("visibility") != "hidden"
        vis = command.get("visibility")
        if vis == "hidden" or vis == "admin-only" or vis == "admin_only":
            return False
        req_roles = command.get("required_roles") or ([command["required_role"]] if command.get("required_role") else [])
        if req_roles:
            eff_roles = self.get_effective_roles(username, current_time=now)
            if not any(r in eff_roles or user_role in req_roles for r in req_roles):
                return False
        req_perms = command.get("required_permissions") or ([command["required_permission"]] if command.get("required_permission") else [])
        if req_perms:
            if not has_permission(eff_perms, req_perms):
                return False
        return self.can_view_command(username, command, current_time=now)

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

    def can_view_command(self, user, command, current_time=None):
        if not self.enabled:
            return True
        if not command:
            return False

        visibility = command.get("visibility", "public")
        if visibility == "hidden":
            return False

        effective_roles = self.get_effective_roles(user, current_time)
        effective_perms = self.get_effective_permissions(user, current_time)

        if visibility == "admin_only" or visibility == "admin-only":
            if "admin" not in effective_roles and "*" not in effective_perms:
                return False

        allowed_roles = command.get("allowed_roles") or command.get("roles") or ([command["required_role"]] if command.get("required_role") else None)
        if isinstance(allowed_roles, list) and len(allowed_roles) > 0:
            has_role = any(r in effective_roles or "admin" in effective_roles for r in allowed_roles)
            if not has_role and "*" not in effective_perms:
                return False

        required_perms = command.get("required_permissions") or command.get("permissions") or ([command["required_permission"]] if command.get("required_permission") else None)
        if isinstance(required_perms, list) and len(required_perms) > 0:
            has_all_perms = all(RBACManager.match_permission(effective_perms, p) for p in required_perms)
            if not has_all_perms:
                return False

        if command.get("min_role"):
            if command.get("min_role") == "admin" and "admin" not in effective_roles and "*" not in effective_perms:
                return False

        return True

    def filter_visible_commands(self, categories, user, current_time=None):
        if not self.enabled:
            return categories
        if not isinstance(categories, list):
            return []

        filtered = []
        for cat in categories:
            cmds = cat.get("commands", [])
            visible_cmds = [cmd for cmd in cmds if self.can_view_command(user, cmd, current_time)]
            if len(visible_cmds) > 0:
                cat_copy = dict(cat)
                cat_copy["commands"] = visible_cmds
                filtered.append(cat_copy)
        return filtered

    # --- Command Execution & Approval Chains ---

    def can_execute_command(self, arg1, arg2, options=None, now=None):
        if isinstance(arg1, dict) and isinstance(arg2, str):
            command, user = arg1, arg2
        elif isinstance(arg1, str) and isinstance(arg2, dict):
            user, command = arg1, arg2
        elif isinstance(arg1, str) and isinstance(arg2, str):
            if arg1 in getattr(self, "users", {}) or arg1 in self.user_roles:
                user, command = arg1, {"name": arg2, "command": arg2}
            else:
                command, user = {"name": arg1, "command": arg1}, arg2
        else:
            user, command = arg1, arg2

        options = options or {}
        current_time = options.get("current_time") or now
        request_id = options.get("approval_request_id") or options.get("request_id")

        if not self.enabled:
            return {"allowed": True, "status": "granted", "requires_approval": False}

        user_role = self.get_user_role(user)
        effective_roles = self.get_effective_roles(user, current_time)
        effective_perms = self.get_effective_permissions(user, current_time)

        if not self.can_view_command(user, command, current_time) and not self.is_command_visible(command, user, now=current_time):
            self.log_audit(
                actor=user,
                action="COMMAND_EXECUTION_DENIED",
                resource=command.get("name", "unknown") if isinstance(command, dict) else "unknown",
                outcome="denied",
                details={"reason": "Command not visible to user"}
            )
            return {"allowed": False, "status": "denied", "requires_approval": False, "reason": "Command not visible to user"}

        exec_perm = command.get("execution_permission") or command.get("required_permission") or "command:execute"
        if not self.has_permission(user, exec_perm, current_time) and not has_permission(effective_perms, DEFAULT_PERMISSIONS["COMMANDS_EXECUTE"]):
            self.log_audit(
                actor=user,
                action="COMMAND_EXECUTION_DENIED",
                resource=command.get("name", "unknown") if isinstance(command, dict) else "unknown",
                outcome="denied",
                details={"reason": f"Missing required permission: {exec_perm}"}
            )
            return {"allowed": False, "status": "denied", "requires_approval": False, "reason": f"Missing required permission: {exec_perm}"}

        requires_approval = bool(
            command.get("requires_approval") or command.get("approval_required") or (isinstance(command.get("approval_chain"), list) and len(command.get("approval_chain")) > 0)
        )

        if requires_approval:
            can_auto_approve = "admin" in effective_roles or user_role == "admin" or has_permission(effective_perms, DEFAULT_PERMISSIONS["COMMANDS_APPROVE"]) or "command:approve" in effective_perms
            if can_auto_approve and (options.get("bypass_approval_if_admin") or user_role == "admin"):
                self.log_audit(
                    actor=user,
                    action="COMMAND_EXECUTED",
                    resource=command.get("name"),
                    outcome="success",
                    details={"admin_bypass": True}
                )
                return {"allowed": True, "status": "granted", "requires_approval": False, "admin_bypass": True}

            if request_id:
                req = self.get_approval_request(request_id)
                if not req:
                    return {"allowed": False, "status": "denied", "requires_approval": True, "reason": "Approval request not found"}
                if req.get("status") == "approved":
                    self.log_audit(
                        actor=user,
                        action="COMMAND_EXECUTED",
                        resource=command.get("name"),
                        outcome="success",
                        details={"approval_request_id": request_id}
                    )
                    return {"allowed": True, "status": "granted", "requires_approval": False, "approval_request_id": request_id}
                return {"allowed": False, "status": req.get("status"), "requires_approval": True, "reason": f"Approval request is {req.get('status')}"}

            if not can_auto_approve:
                approval_chain = command.get("approval_chain")
                if isinstance(approval_chain, list) and len(approval_chain) > 0:
                    cmd_name = command.get("name") or str(command)
                    cmd_str = command.get("command") or cmd_name
                    new_req = self.create_approval_request(
                        command_name=cmd_name,
                        command_id=command.get("id") or cmd_name,
                        requester=user,
                        parameters=options.get("parameters", {}),
                        approval_chain=approval_chain
                    )

                    return {
                        "allowed": False,
                        "status": "requires_approval",
                        "requires_approval": True,
                        "approval_request_id": new_req["id"],
                        "request": new_req,
                        "reason": "Command execution requires admin or approver approval."
                    }

                return {
                    "allowed": False,
                    "status": "requires_approval",
                    "requires_approval": True,
                    "reason": "Command execution requires admin or approver approval."
                }

        self.log_audit(
            actor=user,
            action="COMMAND_EXECUTED",
            resource=command.get("name") if isinstance(command, dict) else "unknown",
            outcome="success",
            details={"parameters": options.get("parameters")}
        )

        return {"allowed": True, "status": "granted", "requires_approval": False}

    def create_approval_request(self, command_name, command_id=None, requester="anonymous", parameters=None, approval_chain=None, reason=""):
        if isinstance(command_id, str) and requester and requester != "anonymous" and not isinstance(requester, dict) and not parameters and not approval_chain and not reason:
            command_str = command_id
            requested_by = requester
            requester_role = self.get_user_role(requested_by)
            rand_str = ''.join(random.choices(string.ascii_lowercase + string.digits, k=7))
            req = {
                "id": f"appr_{int(time.time() * 1000)}_{rand_str}",
                "command_name": command_name,
                "command_id": command_name,
                "command_str": command_str or command_name,
                "requester": requested_by,
                "requested_by": requested_by,
                "role": requester_role,
                "status": "pending",
                "reason": reason or "Execution requested",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "reviewed_by": None,
                "reviewed_at": None,
                "review_reason": None,
                "approval_chain": ["approver"],
                "approvals": []
            }
        else:
            requested_by = requester or "anonymous"
            requester_role = self.get_user_role(requested_by)
            rand_str = ''.join(random.choices(string.ascii_lowercase + string.digits, k=7))
            req = {
                "id": f"appr_{int(datetime.now(timezone.utc).timestamp()*1000)}_{rand_str}",
                "command_name": command_name or "Unknown Command",
                "command_id": command_id or command_name or "unknown",
                "command_str": command_name or "unknown",
                "requester": requested_by,
                "requested_by": requested_by,
                "role": requester_role,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "parameters": parameters or {},
                "approval_chain": list(approval_chain) if approval_chain else ["approver"],
                "approvals": [],
                "status": "pending",
                "reason": reason or "Execution requested",
                "reviewed_by": None,
                "reviewed_at": None,
                "review_reason": None,
            }

        self.approval_requests.insert(0, req)

        self.log_audit(
            actor=requested_by,
            action="APPROVAL_REQUESTED",
            resource=req["command_name"],
            outcome="pending",
            details={"request_id": req["id"], "approval_chain": req.get("approval_chain", [])}
        )

        return req

    def get_approval_request(self, request_id):
        for req in self.approval_requests:
            if req.get("id") == request_id:
                return req
        return None

    def get_pending_approval_requests(self):
        return [r for r in self.approval_requests if r.get("status") == "pending"]

    def approve_request(self, request_id, approver_user, review_reason_or_time=None):
        req = self.get_approval_request(request_id)
        if not req:
            raise ValueError(f"Approval request '{request_id}' not found.")
        if req.get("status") != "pending":
            raise ValueError(f"Cannot approve request '{request_id}': status is already '{req.get('status')}'.")

        current_time = review_reason_or_time if isinstance(review_reason_or_time, (int, float, datetime)) else None
        review_reason = review_reason_or_time if isinstance(review_reason_or_time, str) else "Approved"

        effective_roles = self.get_effective_roles(approver_user, current_time)
        effective_perms = self.get_effective_permissions(approver_user, current_time)

        can_approve = (
            "admin" in effective_roles
            or "*" in effective_perms
            or "command:approve" in effective_perms
            or "commands:approve" in effective_perms
            or any(r in effective_roles or RBACManager.match_permission(effective_perms, r) for r in req.get("approval_chain", []))
        )

        if not can_approve:
            self.log_audit(
                actor=approver_user,
                action="APPROVAL_DENIED",
                resource=req.get("command_name"),
                outcome="denied",
                details={"request_id": request_id, "reason": "Approver lacks approval privileges"}
            )
            raise PermissionError(f"User '{approver_user}' does not have permission to approve request '{request_id}'.")

        now_str = _parse_time(current_time).isoformat()
        req.setdefault("approvals", []).append({
            "approver": approver_user,
            "timestamp": now_str
        })
        req["status"] = "approved"
        req["reviewed_by"] = approver_user
        req["reviewed_at"] = now_str
        req["review_reason"] = review_reason

        self.log_audit(
            actor=approver_user,
            action="APPROVAL_GRANTED",
            resource=req.get("command_name"),
            outcome=req.get("status"),
            details={"request_id": request_id, "chain_status": req.get("status")}
        )

        return req

    def reject_request(self, request_id, approver_user, reason="Rejected by approver"):
        req = self.get_approval_request(request_id)
        if not req:
            raise ValueError(f"Approval request '{request_id}' not found.")
        if req.get("status") != "pending":
            raise ValueError(f"Cannot reject request '{request_id}': status is already '{req.get('status')}'.")

        effective_roles = self.get_effective_roles(approver_user)
        effective_perms = self.get_effective_permissions(approver_user)

        can_approve = (
            "admin" in effective_roles
            or "*" in effective_perms
            or "command:approve" in effective_perms
            or "commands:approve" in effective_perms
            or any(r in effective_roles or RBACManager.match_permission(effective_perms, r) for r in req.get("approval_chain", []))
        )

        if not can_approve:
            self.log_audit(
                actor=approver_user,
                action="APPROVAL_DENIED",
                resource=req.get("command_name"),
                outcome="denied",
                details={"request_id": request_id, "reason": "Approver lacks approval privileges"}
            )
            raise PermissionError(f"User '{approver_user}' does not have permission to reject request '{request_id}'.")

        req["status"] = "rejected"
        req["rejection_reason"] = reason
        req["review_reason"] = reason
        req["reviewed_by"] = approver_user
        req["rejected_by"] = approver_user
        req["rejected_at"] = datetime.now(timezone.utc).isoformat()

        self.log_audit(
            actor=approver_user,
            action="APPROVAL_REJECTED",
            resource=req.get("command_name"),
            outcome="rejected",
            details={"request_id": request_id, "reason": reason}
        )

        return req

    # --- Delegation ---

    def create_delegation(self, delegator=None, delegatee=None, roles=None, permissions=None, start_time=None, end_time=None, actor=None, role=None, duration_ms=None, reason=""):
        if isinstance(delegator, dict):
            opts = delegator
            delegator = opts.get("delegator")
            delegatee = opts.get("delegatee")
            roles = opts.get("roles") or ([opts["role"]] if opts.get("role") else None)
            permissions = opts.get("permissions")
            start_time = opts.get("start_time")
            end_time = opts.get("end_time")
            duration_ms = opts.get("duration_ms")
            reason = opts.get("reason", "")

        if not delegator or not delegatee:
            raise ValueError("Delegation requires both delegator and delegatee.")

        if role and not roles:
            roles = [role]

        if duration_ms and not end_time:
            end_time = time.time() * 1000 + duration_ms

        rand_str = ''.join(random.choices(string.ascii_lowercase + string.digits, k=7))
        delegation = {
            "id": f"del_{int(datetime.now(timezone.utc).timestamp()*1000)}_{rand_str}",
            "delegator": delegator,
            "delegatee": delegatee,
            "role": roles[0] if roles else None,
            "roles": list(roles) if roles else [],
            "permissions": list(permissions) if permissions else [],
            "start_time": _parse_time(start_time).isoformat() if start_time else datetime.now(timezone.utc).isoformat(),
            "end_time": _parse_time(end_time).isoformat() if end_time else None,
            "expires_at": end_time,
            "status": "active",
            "active": True,
            "reason": reason or "Delegated access",
            "created_at": datetime.now(timezone.utc).isoformat()
        }

        self.delegations.append(delegation)

        self.log_audit(
            actor=actor or delegator,
            action="DELEGATION_CREATED",
            resource=delegatee,
            outcome="success",
            details={"delegation_id": delegation["id"], "delegator": delegator, "roles": roles, "permissions": permissions}
        )

        return delegation

    def revoke_delegation(self, delegation_id, revoked_by="system"):
        target_del = None
        for d in self.delegations:
            if d.get("id") == delegation_id:
                target_del = d
                break
        if not target_del:
            raise ValueError(f"Delegation '{delegation_id}' not found.")

        target_del["status"] = "revoked"
        target_del["revoked_at"] = datetime.now(timezone.utc).isoformat()
        target_del["revoked_by"] = revoked_by

        self.log_audit(
            actor=revoked_by,
            action="DELEGATION_REVOKED",
            resource=target_del.get("delegatee"),
            outcome="success",
            details={"delegation_id": delegation_id, "delegator": target_del.get("delegator")}
        )

        return target_del

    # --- Audit Trail ---

    def log_audit(self, actor="system", action="", resource="", outcome="success", details=None):
        entry = {
            "id": f"aud_{int(datetime.now(timezone.utc).timestamp()*1000)}_{uuid.uuid4().hex[:6]}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "actor": actor,
            "action": action,
            "resource": resource,
            "outcome": outcome,
            "details": details or {}
        }
        self.audit_logs.append(entry)
        return entry

    def query_audit_logs(self, filters=None):
        filters = filters or {}
        result = list(self.audit_logs)

        if filters.get("actor"):
            result = [l for l in result if l.get("actor") == filters["actor"]]
        if filters.get("action"):
            result = [l for l in result if l.get("action") == filters["action"]]
        if filters.get("resource"):
            result = [l for l in result if l.get("resource") == filters["resource"]]
        if filters.get("outcome"):
            result = [l for l in result if l.get("outcome") == filters["outcome"]]
        if filters.get("start_date"):
            start = _parse_time(filters["start_date"])
            result = [l for l in result if _parse_time(l.get("timestamp")) >= start]
        if filters.get("end_date"):
            end = _parse_time(filters["end_date"])
            result = [l for l in result if _parse_time(l.get("timestamp")) <= end]

        offset = filters.get("offset", 0)
        limit = filters.get("limit", len(result))

        return result[offset:offset + limit]

    def export_audit_logs(self, format="json", filters=None):
        logs = self.query_audit_logs(filters)

        if str(format).lower() == "csv":
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(["id", "timestamp", "actor", "action", "resource", "outcome", "details"])
            for l in logs:
                writer.writerow([
                    l.get("id"),
                    l.get("timestamp"),
                    l.get("actor"),
                    l.get("action"),
                    l.get("resource"),
                    l.get("outcome"),
                    json.dumps(l.get("details", {}))
                ])
            return output.getvalue()

        return json.dumps(logs, indent=2)
