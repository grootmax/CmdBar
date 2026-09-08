import json
import uuid
import csv
import io
from datetime import datetime, timezone

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
            "permissions": ["command:view", "command:execute", "approval:request"]
        },
        "approver": {
            "name": "Approver",
            "description": "Command viewing and approval chain authorization",
            "permissions": ["command:view", "command:approve"]
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

    # --- Roles & Permissions ---

    def get_user_roles(self, user):
        if not user:
            return [self.default_role]
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
            if start > now:
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

    # --- Command Visibility Rules ---

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

        if visibility == "admin_only":
            if "admin" not in effective_roles and "*" not in effective_perms:
                return False

        allowed_roles = command.get("allowed_roles") or command.get("roles")
        if isinstance(allowed_roles, list) and len(allowed_roles) > 0:
            has_role = any(r in effective_roles or "admin" in effective_roles for r in allowed_roles)
            if not has_role and "*" not in effective_perms:
                return False

        required_perms = command.get("required_permissions") or command.get("permissions")
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

    def can_execute_command(self, user, command, options=None):
        options = options or {}
        current_time = options.get("current_time")
        request_id = options.get("approval_request_id") or options.get("request_id")

        if not self.enabled:
            return {"allowed": True, "status": "granted"}

        if not self.can_view_command(user, command, current_time):
            self.log_audit(
                actor=user,
                action="COMMAND_EXECUTION_DENIED",
                resource=command.get("name", "unknown") if command else "unknown",
                outcome="denied",
                details={"reason": "Command not visible to user"}
            )
            return {"allowed": False, "status": "denied", "reason": "Command not visible to user"}

        exec_perm = command.get("execution_permission") or command.get("required_permission") or "command:execute"
        if not self.has_permission(user, exec_perm, current_time):
            self.log_audit(
                actor=user,
                action="COMMAND_EXECUTION_DENIED",
                resource=command.get("name", "unknown") if command else "unknown",
                outcome="denied",
                details={"reason": f"Missing required permission: {exec_perm}"}
            )
            return {"allowed": False, "status": "denied", "reason": f"Missing required permission: {exec_perm}"}

        requires_approval = bool(
            command.get("requires_approval") or (isinstance(command.get("approval_chain"), list) and len(command.get("approval_chain")) > 0)
        )

        if requires_approval:
            effective_roles = self.get_effective_roles(user, current_time)
            if "admin" in effective_roles and options.get("bypass_approval_if_admin"):
                self.log_audit(
                    actor=user,
                    action="COMMAND_EXECUTED",
                    resource=command.get("name"),
                    outcome="success",
                    details={"admin_bypass": True}
                )
                return {"allowed": True, "status": "granted", "admin_bypass": True}

            if request_id:
                req = self.get_approval_request(request_id)
                if not req:
                    return {"allowed": False, "status": "denied", "reason": "Approval request not found"}
                if req.get("status") == "approved":
                    self.log_audit(
                        actor=user,
                        action="COMMAND_EXECUTED",
                        resource=command.get("name"),
                        outcome="success",
                        details={"approval_request_id": request_id}
                    )
                    return {"allowed": True, "status": "granted", "approval_request_id": request_id}
                return {"allowed": False, "status": req.get("status"), "reason": f"Approval request is {req.get('status')}"}

            approval_chain = command.get("approval_chain")
            if not isinstance(approval_chain, list) or len(approval_chain) == 0:
                approval_chain = ["approver"]

            new_req = self.create_approval_request(
                command_name=command.get("name"),
                command_id=command.get("id") or command.get("name"),
                requester=user,
                parameters=options.get("parameters", {}),
                approval_chain=approval_chain
            )

            return {
                "allowed": False,
                "status": "requires_approval",
                "approval_request_id": new_req["id"],
                "request": new_req
            }

        self.log_audit(
            actor=user,
            action="COMMAND_EXECUTED",
            resource=command.get("name") if command else "unknown",
            outcome="success",
            details={"parameters": options.get("parameters")}
        )

        return {"allowed": True, "status": "granted"}

    def create_approval_request(self, command_name, command_id=None, requester="anonymous", parameters=None, approval_chain=None):
        req = {
            "id": f"appr_{int(datetime.now(timezone.utc).timestamp()*1000)}_{uuid.uuid4().hex[:6]}",
            "command_name": command_name or "Unknown Command",
            "command_id": command_id or command_name or "unknown",
            "requester": requester or "anonymous",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "parameters": parameters or {},
            "approval_chain": list(approval_chain) if approval_chain else ["approver"],
            "approvals": [],
            "status": "pending"
        }

        self.approval_requests.append(req)

        self.log_audit(
            actor=requester,
            action="APPROVAL_REQUESTED",
            resource=req["command_name"],
            outcome="pending",
            details={"request_id": req["id"], "approval_chain": req["approval_chain"]}
        )

        return req

    def get_approval_request(self, request_id):
        for req in self.approval_requests:
            if req.get("id") == request_id:
                return req
        return None

    def approve_request(self, request_id, approver_user, current_time=None):
        req = self.get_approval_request(request_id)
        if not req:
            raise ValueError(f"Approval request '{request_id}' not found.")
        if req.get("status") != "pending":
            raise ValueError(f"Cannot approve request '{request_id}': status is already '{req.get('status')}'.")

        effective_roles = self.get_effective_roles(approver_user, current_time)
        effective_perms = self.get_effective_permissions(approver_user, current_time)

        can_approve = (
            "admin" in effective_roles
            or "*" in effective_perms
            or "command:approve" in effective_perms
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
        req["approvals"].append({
            "approver": approver_user,
            "timestamp": now_str
        })

        approved_roles_or_perms = []
        approved_perms = []
        for a in req["approvals"]:
            approved_roles_or_perms.extend(self.get_effective_roles(a["approver"], current_time))
            approved_perms.extend(self.get_effective_permissions(a["approver"], current_time))

        all_satisfied = all(
            "admin" in approved_roles_or_perms
            or "*" in approved_perms
            or req_item in approved_roles_or_perms
            or RBACManager.match_permission(approved_perms, req_item)
            for req_item in req.get("approval_chain", [])
        )

        if all_satisfied:
            req["status"] = "approved"

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

        req["status"] = "rejected"
        req["rejection_reason"] = reason
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

    def create_delegation(self, delegator, delegatee, roles=None, permissions=None, start_time=None, end_time=None, actor=None):
        if not delegator or not delegatee:
            raise ValueError("Delegation requires both delegator and delegatee.")

        delegation = {
            "id": f"del_{int(datetime.now(timezone.utc).timestamp()*1000)}_{uuid.uuid4().hex[:6]}",
            "delegator": delegator,
            "delegatee": delegatee,
            "roles": list(roles) if roles else [],
            "permissions": list(permissions) if permissions else [],
            "start_time": _parse_time(start_time).isoformat(),
            "end_time": _parse_time(end_time).isoformat() if end_time else None,
            "status": "active",
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
