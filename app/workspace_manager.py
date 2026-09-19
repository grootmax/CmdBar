import os
import json
import uuid
import time
import hmac
import hashlib
import re
from datetime import datetime, timezone, timedelta

WORKSPACE_ROLES = {
    "ADMIN": "admin",
    "MEMBER": "member",
    "VIEWER": "viewer",
}

ROLE_LEVELS = {
    "admin": 3,
    "member": 2,
    "viewer": 1,
}

PLAN_TIERS = {
    "FREE": "free",
    "PRO": "pro",
    "ENTERPRISE": "enterprise",
}

PLAN_LIMITS = {
    "free": {
        "max_workspaces": 1,
        "max_members": 5,
        "max_shared_commands": 10,
        "private_registry_enabled": False,
        "slack_integration_enabled": False,
    },
    "pro": {
        "max_workspaces": 5,
        "max_members": 25,
        "max_shared_commands": 100,
        "private_registry_enabled": False,
        "slack_integration_enabled": True,
    },
    "enterprise": {
        "max_workspaces": float("inf"),
        "max_members": float("inf"),
        "max_shared_commands": float("inf"),
        "private_registry_enabled": True,
        "slack_integration_enabled": True,
    },
}

class WorkspaceManager:
    """
    Organization Workspaces Manager for CmdBar.
    Handles team workspaces, shared commands, admin policies, usage analytics,
    subscription billing, private registries, and Slack integrations.
    :visibility: public
    """

    def __init__(self, storage_path=None):
        """
        Initializes WorkspaceManager.
        :visibility: public
        """
        self.storage_path = storage_path
        self.workspaces = {}
        self.analytics_events = []
        self.private_registries = {}  # workspace_id -> {pkg_id: pkg_dict}

    def _generate_id(self, prefix="ws") -> str:
        return f"{prefix}_{uuid.uuid4().hex[:12]}"

    def create_workspace(self, name: str, org_id: str, owner_id: str, description: str = "", plan_tier: str = "free") -> dict:
        """
        Creates a new organization workspace.
        :visibility: public
        """
        if not name or not name.strip():
            raise ValueError("Workspace name is required.")
        if not org_id or not owner_id:
            raise ValueError("org_id and owner_id are required.")

        tier = PLAN_TIERS.get(plan_tier.upper(), "free")
        existing = self.list_workspaces(org_id)
        limit = PLAN_LIMITS[tier]["max_workspaces"]
        if len(existing) >= limit:
            raise ValueError(f"Workspace creation limit reached for plan tier '{tier}' ({limit}).")

        ws_id = self._generate_id("ws")
        now_str = datetime.now(timezone.utc).isoformat()
        workspace = {
            "id": ws_id,
            "name": name.strip(),
            "description": description.strip(),
            "org_id": org_id,
            "owner_id": owner_id,
            "plan_tier": tier,
            "status": "active",
            "created_at": now_str,
            "updated_at": now_str,
            "members": [
                {
                    "user_id": owner_id,
                    "name": "Owner",
                    "email": f"{owner_id}@org.com",
                    "role": WORKSPACE_ROLES["ADMIN"],
                    "joined_at": now_str,
                }
            ],
            "shared_categories": [],
            "admin_settings": {
                "allowed_execution_modes": ["shell-quoted", "direct-array"],
                "prohibited_patterns": [r"rm\s+-rf\s+/", r"chmod\s+777\s+/"],
                "require_confirmation": True,
                "allowed_hosts": [],
                "enforce_admin_only_edit": True,
            },
            "audit_logs": [
                {
                    "id": self._generate_id("audit"),
                    "timestamp": now_str,
                    "actor_id": owner_id,
                    "action": "WORKSPACE_CREATED",
                    "details": f"Workspace '{name}' created with plan tier '{tier}'.",
                }
            ],
            "billing": {
                "plan_tier": tier,
                "seat_limit": PLAN_LIMITS[tier]["max_members"],
                "command_limit": PLAN_LIMITS[tier]["max_shared_commands"],
                "status": "active",
                "billing_email": f"{owner_id}@org.com",
                "renewal_date": (datetime.now(timezone.utc) + timedelta(days=365)).isoformat(),
            },
            "private_registry": {
                "enabled": PLAN_LIMITS[tier]["private_registry_enabled"],
                "installed_packages": [],
            },
            "slack_integration": {
                "enabled": PLAN_LIMITS[tier]["slack_integration_enabled"],
                "webhook_url": "",
                "signing_secret": f"secret_{self._generate_id('slack')}",
                "enabled_events": ["command_execution", "audit_log", "member_joined"],
            },
        }

        self.workspaces[ws_id] = workspace
        self.private_registries[ws_id] = {}
        return workspace

    def get_workspace(self, workspace_id: str) -> dict:
        """
        Retrieves a workspace by ID.
        :visibility: public
        """
        return self.workspaces.get(workspace_id)

    def update_workspace(self, workspace_id: str, updates: dict, actor_id: str) -> dict:
        """
        Updates workspace settings.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        if not ws:
            raise ValueError(f"Workspace '{workspace_id}' not found.")
        if not self.has_permission(workspace_id, actor_id, WORKSPACE_ROLES["ADMIN"]):
            raise PermissionError(f"Actor '{actor_id}' lacks ADMIN permission.")

        if "name" in updates and isinstance(updates["name"], str):
            ws["name"] = updates["name"].strip()
        if "description" in updates and isinstance(updates["description"], str):
            ws["description"] = updates["description"].strip()
        if "admin_settings" in updates and isinstance(updates["admin_settings"], dict):
            ws["admin_settings"].update(updates["admin_settings"])
        if "slack_integration" in updates and isinstance(updates["slack_integration"], dict):
            ws["slack_integration"].update(updates["slack_integration"])

        ws["updated_at"] = datetime.now(timezone.utc).isoformat()
        self._log_audit(ws, actor_id, "WORKSPACE_UPDATED", "Updated workspace settings.")
        return ws

    def delete_workspace(self, workspace_id: str, actor_id: str) -> bool:
        """
        Deletes a workspace.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        if not ws:
            return False
        if ws["owner_id"] != actor_id and not self.has_permission(workspace_id, actor_id, WORKSPACE_ROLES["ADMIN"]):
            raise PermissionError("Actor not authorized to delete workspace.")

        self.private_registries.pop(workspace_id, None)
        del self.workspaces[workspace_id]
        return True

    def list_workspaces(self, org_id: str) -> list:
        """
        Lists workspaces belonging to an organization.
        :visibility: public
        """
        return [ws for ws in self.workspaces.values() if ws["org_id"] == org_id]

    # --- Members ---

    def add_member(self, workspace_id: str, user_id: str, name: str = "", email: str = "", role: str = "member", actor_id: str = "") -> dict:
        """
        Adds a member to a workspace.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        if not ws:
            raise ValueError(f"Workspace '{workspace_id}' not found.")
        if not self.has_permission(workspace_id, actor_id, WORKSPACE_ROLES["ADMIN"]):
            raise PermissionError("Only ADMINs can add members.")

        seats = self.check_plan_limits(workspace_id, "members")
        if not seats["allowed"]:
            raise ValueError(seats["reason"])

        if any(m["user_id"] == user_id for m in ws["members"]):
            raise ValueError(f"User '{user_id}' is already a member.")

        m_role = WORKSPACE_ROLES.get(role.upper(), WORKSPACE_ROLES["MEMBER"])
        member = {
            "user_id": user_id,
            "name": name or user_id,
            "email": email or f"{user_id}@org.com",
            "role": m_role,
            "joined_at": datetime.now(timezone.utc).isoformat(),
        }

        ws["members"].append(member)
        ws["updated_at"] = datetime.now(timezone.utc).isoformat()
        self._log_audit(ws, actor_id, "MEMBER_ADDED", f"Added member '{user_id}' with role '{m_role}'.")
        self.send_slack_notification(workspace_id, "member_joined", {"member": member})
        return member

    def update_member_role(self, workspace_id: str, target_user_id: str, new_role: str, actor_id: str) -> dict:
        """
        Updates member role.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        if not ws:
            raise ValueError(f"Workspace '{workspace_id}' not found.")
        if not self.has_permission(workspace_id, actor_id, WORKSPACE_ROLES["ADMIN"]):
            raise PermissionError("Only ADMINs can update member roles.")

        member = next((m for m in ws["members"] if m["user_id"] == target_user_id), None)
        if not member:
            raise ValueError(f"Member '{target_user_id}' not found.")

        old_role = member["role"]
        m_role = WORKSPACE_ROLES.get(new_role.upper(), WORKSPACE_ROLES["MEMBER"])
        member["role"] = m_role
        ws["updated_at"] = datetime.now(timezone.utc).isoformat()

        self._log_audit(ws, actor_id, "ROLE_UPDATED", f"Updated role for '{target_user_id}' from '{old_role}' to '{m_role}'.")
        return member

    def remove_member(self, workspace_id: str, target_user_id: str, actor_id: str) -> bool:
        """
        Removes a member from a workspace.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        if not ws:
            raise ValueError(f"Workspace '{workspace_id}' not found.")
        if not self.has_permission(workspace_id, actor_id, WORKSPACE_ROLES["ADMIN"]):
            raise PermissionError("Only ADMINs can remove members.")
        if ws["owner_id"] == target_user_id:
            raise ValueError("Cannot remove workspace owner.")

        ws["members"] = [m for m in ws["members"] if m["user_id"] != target_user_id]
        ws["updated_at"] = datetime.now(timezone.utc).isoformat()
        self._log_audit(ws, actor_id, "MEMBER_REMOVED", f"Removed member '{target_user_id}'.")
        return True

    def has_permission(self, workspace_id: str, user_id: str, required_role: str) -> bool:
        """
        Checks role level permission.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        if not ws:
            return False
        member = next((m for m in ws["members"] if m["user_id"] == user_id), None)
        if not member:
            return False

        user_lvl = ROLE_LEVELS.get(member["role"], 0)
        req_lvl = ROLE_LEVELS.get(required_role, 1)
        return user_lvl >= req_lvl

    # --- Shared Commands ---

    def add_shared_command(self, workspace_id: str, category_name: str, command_data: dict, actor_id: str) -> dict:
        """
        Adds or updates a shared command in a workspace category.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        if not ws:
            raise ValueError(f"Workspace '{workspace_id}' not found.")

        if ws["admin_settings"].get("enforce_admin_only_edit") and not self.has_permission(workspace_id, actor_id, WORKSPACE_ROLES["ADMIN"]):
            raise PermissionError("Workspace policy restricts command editing to ADMINs only.")
        elif not self.has_permission(workspace_id, actor_id, WORKSPACE_ROLES["MEMBER"]):
            raise PermissionError("Actor lacks permission to edit workspace commands.")

        cmd_check = self.check_plan_limits(workspace_id, "commands")
        if not cmd_check["allowed"]:
            raise ValueError(cmd_check["reason"])

        policy_check = self.validate_command_against_policies(workspace_id, command_data)
        if not policy_check["allowed"]:
            raise ValueError(f"Command blocked by policy: {policy_check['reason']}")

        cat = next((c for c in ws["shared_categories"] if c["name"].lower() == category_name.lower()), None)
        if not cat:
            cat = {"name": category_name, "commands": []}
            ws["shared_categories"].append(cat)

        dup_idx = next((i for i, c in enumerate(cat["commands"]) if c["name"].lower() == command_data["name"].lower()), None)
        if dup_idx is not None:
            cat["commands"][dup_idx] = dict(command_data)
        else:
            cat["commands"].append(dict(command_data))

        ws["updated_at"] = datetime.now(timezone.utc).isoformat()
        self._log_audit(ws, actor_id, "COMMAND_ADDED", f"Added shared command '{command_data.get('name')}' to category '{category_name}'.")
        return command_data

    def remove_shared_command(self, workspace_id: str, category_name: str, command_name: str, actor_id: str) -> bool:
        """
        Removes a shared command.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        if not ws:
            raise ValueError(f"Workspace '{workspace_id}' not found.")

        if ws["admin_settings"].get("enforce_admin_only_edit") and not self.has_permission(workspace_id, actor_id, WORKSPACE_ROLES["ADMIN"]):
            raise PermissionError("Workspace policy restricts command editing to ADMINs only.")
        elif not self.has_permission(workspace_id, actor_id, WORKSPACE_ROLES["MEMBER"]):
            raise PermissionError("Actor lacks permission.")

        cat = next((c for c in ws["shared_categories"] if c["name"].lower() == category_name.lower()), None)
        if not cat:
            return False

        cat["commands"] = [c for c in cat["commands"] if c["name"].lower() != command_name.lower()]
        if not cat["commands"]:
            ws["shared_categories"].remove(cat)

        ws["updated_at"] = datetime.now(timezone.utc).isoformat()
        self._log_audit(ws, actor_id, "COMMAND_REMOVED", f"Removed command '{command_name}' from category '{category_name}'.")
        return True

    def get_merged_config(self, workspace_id: str, base_config: dict) -> dict:
        """
        Merges workspace shared commands into a base CmdBar config.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        if not ws:
            return base_config

        merged = json.loads(json.dumps(base_config or {}))
        if "categories" not in merged or not isinstance(merged["categories"], list):
            merged["categories"] = []

        for ws_cat in ws["shared_categories"]:
            target_cat = next((c for c in merged["categories"] if c.get("name", "").lower() == ws_cat["name"].lower()), None)
            if not target_cat:
                target_cat = {"name": ws_cat["name"], "commands": []}
                merged["categories"].append(target_cat)

            if "commands" not in target_cat or not isinstance(target_cat["commands"], list):
                target_cat["commands"] = []

            for cmd in ws_cat["commands"]:
                dup_idx = next((i for i, c in enumerate(target_cat["commands"]) if c.get("name", "").lower() == cmd.get("name", "").lower()), None)
                tagged = dict(cmd)
                tagged["workspace_id"] = ws["id"]
                tagged["workspace_name"] = ws["name"]

                if dup_idx is not None:
                    target_cat["commands"][dup_idx] = tagged
                else:
                    target_cat["commands"].append(tagged)

        return merged

    def validate_command_against_policies(self, workspace_id: str, command_data: dict) -> dict:
        """
        Validates command against admin policies.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        if not ws:
            return {"allowed": True, "reason": None}

        settings = ws["admin_settings"]
        mode = command_data.get("mode", "shell-quoted")
        if settings.get("allowed_execution_modes") and mode not in settings["allowed_execution_modes"]:
            return {"allowed": False, "reason": f"Execution mode '{mode}' disallowed by policy."}

        cmd_str = command_data.get("command", "")
        for pattern in settings.get("prohibited_patterns", []):
            if re.search(pattern, cmd_str, re.IGNORECASE):
                return {"allowed": False, "reason": f"Command matches prohibited pattern '{pattern}'."}

        allowed_hosts = settings.get("allowed_hosts", [])
        if allowed_hosts and any(kw in cmd_str for kw in ["ping", "curl", "ssh"]):
            if not any(h in cmd_str for h in allowed_hosts):
                return {"allowed": False, "reason": f"Target host not in allowed hosts list ({allowed_hosts})."}

        return {"allowed": True, "reason": None}

    # --- Analytics ---

    def record_command_execution(self, workspace_id: str, command_id: str, command_name: str, user_id: str, duration_ms: float = 0.0, success: bool = True, error_message: str = None) -> dict:
        """
        Records command execution for analytics.
        :visibility: public
        """
        event = {
            "id": self._generate_id("evt"),
            "workspace_id": workspace_id,
            "command_id": command_id or command_name,
            "command_name": command_name,
            "user_id": user_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "duration_ms": duration_ms,
            "success": bool(success),
            "error_message": error_message,
        }
        self.analytics_events.append(event)

        if workspace_id and not success:
            self.send_slack_notification(workspace_id, "command_execution_failure", {"event": event})

        return event

    def get_analytics_summary(self, workspace_id: str) -> dict:
        """
        Computes summary statistics for a workspace.
        :visibility: public
        """
        events = [e for e in self.analytics_events if e["workspace_id"] == workspace_id]
        total = len(events)
        successful = sum(1 for e in events if e["success"])
        failed = total - successful
        success_rate = (successful / total * 100.0) if total > 0 else 100.0

        total_dur = sum(e["duration_ms"] for e in events)
        avg_dur = (total_dur / total) if total > 0 else 0.0

        cmd_counts = {}
        user_counts = {}
        for e in events:
            c_name = e["command_name"]
            u_id = e["user_id"]
            cmd_counts[c_name] = cmd_counts.get(c_name, 0) + 1
            user_counts[u_id] = user_counts.get(u_id, 0) + 1

        top_cmds = [{"name": k, "count": v} for k, v in sorted(cmd_counts.items(), key=lambda x: x[1], reverse=True)]
        active_users = [{"user_id": k, "count": v} for k, v in sorted(user_counts.items(), key=lambda x: x[1], reverse=True)]

        return {
            "workspace_id": workspace_id,
            "total_executions": total,
            "successful": successful,
            "failed": failed,
            "success_rate": round(success_rate, 2),
            "avg_duration_ms": round(avg_dur, 2),
            "top_commands": top_cmds,
            "active_users": active_users,
        }

    def export_analytics_csv(self, workspace_id: str) -> str:
        """
        Exports analytics as CSV string.
        :visibility: public
        """
        events = [e for e in self.analytics_events if e["workspace_id"] == workspace_id]
        lines = ["id,timestamp,userId,commandName,durationMs,success,errorMessage"]
        for e in events:
            cmd = (e['command_name'] or '').replace('"', '""')
            err = (e['error_message'] or '').replace('"', '""')
            lines.append(f'{e["id"]},{e["timestamp"]},{e["user_id"]},"{cmd}",{e["duration_ms"]},{e["success"]},"{err}"')
        return "\n".join(lines)

    def export_analytics_json(self, workspace_id: str) -> str:
        """
        Exports analytics as JSON string.
        :visibility: public
        """
        events = [e for e in self.analytics_events if e["workspace_id"] == workspace_id]
        return json.dumps(events, indent=2)

    # --- Billing ---

    def update_billing_plan(self, workspace_id: str, new_plan_tier: str, actor_id: str, details: dict = None) -> dict:
        """
        Updates subscription billing plan for a workspace.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        if not ws:
            raise ValueError(f"Workspace '{workspace_id}' not found.")
        if not self.has_permission(workspace_id, actor_id, WORKSPACE_ROLES["ADMIN"]):
            raise PermissionError("Only ADMINs can update billing plans.")

        tier = PLAN_TIERS.get(new_plan_tier.upper(), "free")
        ws["plan_tier"] = tier
        billing = ws["billing"]
        billing["plan_tier"] = tier
        billing["seat_limit"] = PLAN_LIMITS[tier]["max_members"]
        billing["command_limit"] = PLAN_LIMITS[tier]["max_shared_commands"]
        if details:
            billing.update(details)

        ws["private_registry"]["enabled"] = PLAN_LIMITS[tier]["private_registry_enabled"]
        ws["slack_integration"]["enabled"] = PLAN_LIMITS[tier]["slack_integration_enabled"]
        ws["updated_at"] = datetime.now(timezone.utc).isoformat()

        self._log_audit(ws, actor_id, "BILLING_PLAN_UPDATED", f"Updated plan tier to '{tier}'.")
        return billing

    def check_plan_limits(self, workspace_id: str, feature_or_limit: str) -> dict:
        """
        Checks plan limits for a workspace.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        if not ws:
            return {"allowed": False, "limit": 0, "current": 0, "reason": "Workspace not found."}

        tier = ws["plan_tier"]
        limits = PLAN_LIMITS[tier]

        if feature_or_limit == "members":
            current = len(ws["members"])
            limit = limits["max_members"]
            allowed = current < limit
            return {
                "allowed": allowed,
                "limit": limit,
                "current": current,
                "reason": None if allowed else f"Seat limit reached ({current}/{limit}) for plan tier '{tier}'.",
            }
        elif feature_or_limit == "commands":
            current = sum(len(c["commands"]) for c in ws["shared_categories"])
            limit = limits["max_shared_commands"]
            allowed = current < limit
            return {
                "allowed": allowed,
                "limit": limit,
                "current": current,
                "reason": None if allowed else f"Command limit reached ({current}/{limit}) for plan tier '{tier}'.",
            }
        elif feature_or_limit == "private_registry":
            allowed = limits["private_registry_enabled"]
            return {
                "allowed": allowed,
                "limit": allowed,
                "current": len(ws["private_registry"]["installed_packages"]),
                "reason": None if allowed else "Private registry is an Enterprise tier feature.",
            }
        elif feature_or_limit == "slack_integration":
            allowed = limits["slack_integration_enabled"]
            return {
                "allowed": allowed,
                "limit": allowed,
                "current": 1 if ws["slack_integration"]["enabled"] else 0,
                "reason": None if allowed else "Slack integration requires Pro or Enterprise tier.",
            }

        return {"allowed": True, "limit": float("inf"), "current": 0, "reason": None}

    # --- Private Registry ---

    def publish_package(self, workspace_id: str, name: str, commands: list, actor_id: str, version: str = "1.0.0", description: str = "", publisher: str = "internal", pkg_id: str = None) -> dict:
        """
        Publishes a command package to workspace private registry.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        if not ws:
            raise ValueError(f"Workspace '{workspace_id}' not found.")
        if not self.has_permission(workspace_id, actor_id, WORKSPACE_ROLES["ADMIN"]):
            raise PermissionError("Only ADMINs can publish packages.")

        reg_check = self.check_plan_limits(workspace_id, "private_registry")
        if not reg_check["allowed"]:
            raise ValueError(reg_check["reason"])

        reg = self.private_registries.setdefault(workspace_id, {})
        package_id = pkg_id or self._generate_id("pkg")

        cmd_json = json.dumps(commands, sort_keys=True)
        checksum = hashlib.sha256(cmd_json.encode("utf-8")).hexdigest()

        pkg = {
            "id": package_id,
            "name": name or package_id,
            "version": version,
            "description": description,
            "commands": commands,
            "publisher": publisher,
            "published_at": datetime.now(timezone.utc).isoformat(),
            "checksum": checksum,
        }

        reg[package_id] = pkg
        self._log_audit(ws, actor_id, "PACKAGE_PUBLISHED", f"Published package '{pkg['name']}' v{version}.")
        self.send_slack_notification(workspace_id, "package_published", {"package": pkg})
        return pkg

    def list_packages(self, workspace_id: str) -> list:
        """
        Lists packages in workspace private registry.
        :visibility: public
        """
        reg = self.private_registries.get(workspace_id, {})
        return list(reg.values())

    def search_packages(self, workspace_id: str, query: str) -> list:
        """
        Searches private registry packages.
        :visibility: public
        """
        pkgs = self.list_packages(workspace_id)
        if not query or not query.strip():
            return pkgs
        q = query.lower().strip()
        return [p for p in pkgs if q in p["name"].lower() or q in p["description"].lower()]

    def install_package(self, workspace_id: str, package_id: str, actor_id: str) -> dict:
        """
        Installs package from private registry.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        if not ws:
            raise ValueError(f"Workspace '{workspace_id}' not found.")
        if not self.has_permission(workspace_id, actor_id, WORKSPACE_ROLES["ADMIN"]):
            raise PermissionError("Only ADMINs can install private registry packages.")

        reg = self.private_registries.get(workspace_id, {})
        pkg = reg.get(package_id)
        if not pkg:
            raise ValueError(f"Package '{package_id}' not found.")

        cat_name = f"Package: {pkg['name']}"
        for cmd in pkg["commands"]:
            self.add_shared_command(workspace_id, cat_name, cmd, actor_id)

        if package_id not in ws["private_registry"]["installed_packages"]:
            ws["private_registry"]["installed_packages"].append(package_id)

        self._log_audit(ws, actor_id, "PACKAGE_INSTALLED", f"Installed package '{pkg['name']}'.")
        return ws

    def uninstall_package(self, workspace_id: str, package_id: str, actor_id: str) -> bool:
        """
        Uninstalls a package from workspace.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        if not ws:
            raise ValueError(f"Workspace '{workspace_id}' not found.")
        if not self.has_permission(workspace_id, actor_id, WORKSPACE_ROLES["ADMIN"]):
            raise PermissionError("Only ADMINs can uninstall packages.")

        reg = self.private_registries.get(workspace_id, {})
        pkg = reg.get(package_id)
        cat_name = f"Package: {pkg['name']}" if pkg else None

        if cat_name:
            ws["shared_categories"] = [c for c in ws["shared_categories"] if c["name"].lower() != cat_name.lower()]

        if package_id in ws["private_registry"]["installed_packages"]:
            ws["private_registry"]["installed_packages"].remove(package_id)

        self._log_audit(ws, actor_id, "PACKAGE_UNINSTALLED", f"Uninstalled package '{package_id}'.")
        return True

    # --- Slack Integration ---

    def send_slack_notification(self, workspace_id: str, event_type: str, payload_data: dict) -> dict:
        """
        Formats Slack webhook notification payload.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        if not ws or not ws["slack_integration"]["enabled"]:
            return None
        if event_type not in ws["slack_integration"]["enabled_events"]:
            return None

        return {
            "text": f"[CmdBar Alert: {ws['name']}] Event: {event_type}",
            "blocks": [
                {
                    "type": "header",
                    "text": {"type": "plain_text", "text": f"⚡ CmdBar Alert: {ws['name']}"},
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*Event:* `{event_type}`\n*Workspace:* {ws['name']} (`{ws['id']}`)\n*Details:* {json.dumps(payload_data)}",
                    },
                },
            ],
        }

    def handle_slack_slash_command(self, workspace_id: str, slack_payload: dict, signature: str = None, timestamp: str = None) -> dict:
        """
        Handles Slack slash command requests.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        if not ws:
            return {"response_type": "ephemeral", "text": "Workspace not found."}
        if not ws["slack_integration"]["enabled"]:
            return {"response_type": "ephemeral", "text": "Slack integration disabled."}

        text = (slack_payload.get("text") or "").strip()
        parts = text.split()
        sub_cmd = parts[0].lower() if parts else "list"

        if sub_cmd == "list":
            cat_cnt = len(ws["shared_categories"])
            cmd_cnt = sum(len(c["commands"]) for c in ws["shared_categories"])
            return {
                "response_type": "in_channel",
                "text": f"*CmdBar Workspace Commands ({ws['name']})*\nCategories: {cat_cnt} | Shared Commands: {cmd_cnt}",
            }
        elif sub_cmd == "stats":
            stats = self.get_analytics_summary(workspace_id)
            return {
                "response_type": "in_channel",
                "text": f"*CmdBar Usage Stats ({ws['name']})*\nExecutions: {stats['total_executions']} | Success Rate: {stats['success_rate']}% | Avg Duration: {stats['avg_duration_ms']}ms",
            }
        elif sub_cmd == "exec":
            cmd_name = " ".join(parts[1:])
            return {
                "response_type": "in_channel",
                "text": f"🚀 Triggered command: `{cmd_name}` in workspace `{ws['name']}`.",
            }

        return {
            "response_type": "ephemeral",
            "text": f"Unknown sub-command '{sub_cmd}'. Available: `list`, `stats`, `exec <cmd>`.",
        }

    # --- Internal Helpers ---

    def _log_audit(self, ws: dict, actor_id: str, action: str, details: str):
        ws.setdefault("audit_logs", []).append({
            "id": self._generate_id("audit"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "actor_id": actor_id,
            "action": action,
            "details": details,
        })
