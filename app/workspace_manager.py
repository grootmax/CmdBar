import os
import json
import time
import uuid
import datetime
import urllib.request
import urllib.error

ROLE_ADMIN = "admin"
ROLE_MEMBER = "member"
ROLE_VIEWER = "viewer"

VALID_ROLES = {ROLE_ADMIN, ROLE_MEMBER, ROLE_VIEWER}

BILLING_PLANS = {
    "free": {
        "max_members": 3,
        "max_commands": 10,
        "max_monthly_executions": 1000
    },
    "pro": {
        "max_members": 25,
        "max_commands": 100,
        "max_monthly_executions": 50000
    },
    "enterprise": {
        "max_members": -1,  # unlimited
        "max_commands": -1, # unlimited
        "max_monthly_executions": -1  # unlimited
    }
}

PERMISSIONS = {
    ROLE_ADMIN: {
        "manage_members",
        "manage_commands",
        "manage_billing",
        "manage_registry",
        "manage_slack",
        "execute_command",
        "view_analytics",
        "manage_policy"
    },
    ROLE_MEMBER: {
        "manage_commands",
        "execute_command",
        "view_analytics",
        "manage_registry",
        "view_registry"
    },
    ROLE_VIEWER: {
        "execute_command",
        "view_analytics",
        "view_registry"
    }
}


def current_iso_timestamp():
    """
    Returns current UTC timestamp in ISO format.
    :visibility: public
    """
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


class WorkspaceManager:
    """
    Central Manager for Organization Workspaces in CmdBar.
    Provides team workspaces, shared commands, admin access controls, usage analytics,
    billing management, private command registries, and Slack integration notifications.
    :visibility: public
    """

    def __init__(self, config_or_path=None):
        """
        Initializes the WorkspaceManager with an in-memory dictionary, config dict, or file path.
        :visibility: public
        """
        self.config_path = None
        self.workspaces = {}

        if isinstance(config_or_path, str):
            self.config_path = config_or_path
            self._load_from_path()
        elif isinstance(config_or_path, dict):
            workspaces_data = config_or_path.get("workspaces", {})
            if isinstance(workspaces_data, list):
                for ws in workspaces_data:
                    if isinstance(ws, dict) and "id" in ws:
                        self.workspaces[ws["id"]] = ws
            elif isinstance(workspaces_data, dict):
                self.workspaces = workspaces_data
        else:
            self.workspaces = {}

    def _load_from_path(self):
        if self.config_path and os.path.exists(self.config_path):
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                workspaces_data = data.get("workspaces", {})
                if isinstance(workspaces_data, list):
                    for ws in workspaces_data:
                        if isinstance(ws, dict) and "id" in ws:
                            self.workspaces[ws["id"]] = ws
                elif isinstance(workspaces_data, dict):
                    self.workspaces = workspaces_data
            except Exception:
                pass

    def save_state(self, config_dict=None):
        """
        Saves current workspace state back into the provided config dict or config file path.
        :visibility: public
        """
        if config_dict is not None and isinstance(config_dict, dict):
            config_dict["workspaces"] = list(self.workspaces.values())

        if self.config_path:
            try:
                data = {}
                if os.path.exists(self.config_path):
                    try:
                        with open(self.config_path, "r", encoding="utf-8") as f:
                            data = json.load(f)
                    except Exception:
                        data = {}
                data["workspaces"] = list(self.workspaces.values())
                os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
                with open(self.config_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2)
            except Exception:
                pass

    def create_workspace(self, name: str, owner_id: str, organization: str = "Default Org", plan: str = "free") -> dict:
        """
        Creates a new organization workspace with owner assigned as admin.
        :visibility: public
        """
        if not name or not str(name).strip():
            raise ValueError("Workspace name cannot be empty.")
        if not owner_id or not str(owner_id).strip():
            raise ValueError("Owner ID cannot be empty.")
        if plan not in BILLING_PLANS:
            raise ValueError(f"Invalid plan '{plan}'. Must be one of: {list(BILLING_PLANS.keys())}")

        ws_id = f"ws_{uuid.uuid4().hex[:12]}"
        now = current_iso_timestamp()

        workspace = {
            "id": ws_id,
            "name": str(name).strip(),
            "organization": str(organization).strip() if organization else "Default Org",
            "owner_id": str(owner_id).strip(),
            "plan": plan,
            "members": [
                {
                    "user_id": str(owner_id).strip(),
                    "role": ROLE_ADMIN,
                    "joined_at": now
                }
            ],
            "categories": [],
            "private_registry": [],
            "slack_config": {
                "webhook_url": "",
                "channel": "#general",
                "enabled": False,
                "events": ["command_execution", "workspace_update", "registry_publish"]
            },
            "usage_analytics": {
                "total_executions": 0,
                "executions_by_user": {},
                "executions_by_command": {},
                "execution_logs": []
            },
            "security_policy": {
                "allow_untrusted_commands": False,
                "require_ai_confirmation": True,
                "allowed_registries": ["official", "private"]
            },
            "created_at": now,
            "updated_at": now
        }

        self.workspaces[ws_id] = workspace
        self.save_state()
        return workspace

    def get_workspace(self, workspace_id: str) -> dict:
        """
        Retrieves a workspace by its ID.
        :visibility: public
        """
        if workspace_id not in self.workspaces:
            raise KeyError(f"Workspace with ID '{workspace_id}' not found.")
        return self.workspaces[workspace_id]

    def list_workspaces(self, user_id: str = None) -> list:
        """
        Lists all workspaces, optionally filtered by user membership.
        :visibility: public
        """
        all_ws = list(self.workspaces.values())
        if not user_id:
            return all_ws

        clean_user = str(user_id).strip()
        filtered = []
        for ws in all_ws:
            members = ws.get("members", [])
            if any(m.get("user_id") == clean_user for m in members):
                filtered.append(ws)
        return filtered

    def update_workspace(self, workspace_id: str, requesting_user_id: str, updates: dict) -> dict:
        """
        Updates workspace metadata if requesting user has admin permission.
        :visibility: public
        """
        if not self.check_permission(workspace_id, requesting_user_id, "manage_policy"):
            raise PermissionError("User does not have admin permission to update workspace.")

        ws = self.get_workspace(workspace_id)
        allowed_keys = {"name", "organization", "security_policy"}
        for k, v in updates.items():
            if k in allowed_keys:
                if k == "security_policy" and isinstance(v, dict):
                    ws["security_policy"].update(v)
                else:
                    ws[k] = v

        ws["updated_at"] = current_iso_timestamp()
        self.save_state()
        return ws

    def delete_workspace(self, workspace_id: str, requesting_user_id: str) -> bool:
        """
        Deletes a workspace if requesting user is workspace owner or admin.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        if ws.get("owner_id") != requesting_user_id and not self.check_permission(workspace_id, requesting_user_id, "manage_policy"):
            raise PermissionError("User does not have permission to delete this workspace.")

        del self.workspaces[workspace_id]
        self.save_state()
        return True

    def set_active_workspace(self, workspace_id: str, user_config: dict) -> dict:
        """
        Sets the active workspace ID in user configuration.
        :visibility: public
        """
        if workspace_id and workspace_id not in self.workspaces:
            raise KeyError(f"Workspace '{workspace_id}' does not exist.")

        user_config["active_workspace_id"] = workspace_id
        return user_config

    def get_active_workspace(self, user_config: dict) -> dict:
        """
        Returns the workspace object for user_config's active_workspace_id, or None.
        :visibility: public
        """
        ws_id = user_config.get("active_workspace_id")
        if not ws_id or ws_id not in self.workspaces:
            return None
        return self.workspaces[ws_id]

    def check_permission(self, workspace_id: str, user_id: str, action: str) -> bool:
        """
        Checks if a user has permission to perform an action within a workspace.
        :visibility: public
        """
        if not user_id or workspace_id not in self.workspaces:
            return False

        ws = self.workspaces[workspace_id]
        clean_user = str(user_id).strip()

        role = None
        for member in ws.get("members", []):
            if member.get("user_id") == clean_user:
                role = member.get("role")
                break

        if not role or role not in PERMISSIONS:
            return False

        return action in PERMISSIONS[role]

    def add_member(self, workspace_id: str, user_id: str, role: str = "member", requesting_user_id: str = None) -> dict:
        """
        Adds or updates a member in a workspace with role-based permissions.
        :visibility: public
        """
        if requesting_user_id and not self.check_permission(workspace_id, requesting_user_id, "manage_members"):
            raise PermissionError("Requesting user does not have permission to manage members.")

        if role not in VALID_ROLES:
            raise ValueError(f"Invalid role '{role}'. Must be one of: {list(VALID_ROLES)}")

        ws = self.get_workspace(workspace_id)
        clean_user = str(user_id).strip()
        members = ws.get("members", [])

        existing_member = None
        for m in members:
            if m.get("user_id") == clean_user:
                existing_member = m
                break

        if not existing_member:
            # Check member limit in billing plan
            billing_status = self.get_billing_status(workspace_id)
            if billing_status["is_member_quota_exceeded"]:
                raise ValueError(f"Workspace member limit reached ({billing_status['max_members']}) for plan '{ws.get('plan')}'. Upgrade plan to add more members.")

            members.append({
                "user_id": clean_user,
                "role": role,
                "joined_at": current_iso_timestamp()
            })
        else:
            existing_member["role"] = role

        ws["updated_at"] = current_iso_timestamp()
        self.save_state()
        return ws

    def remove_member(self, workspace_id: str, user_id: str, requesting_user_id: str = None) -> bool:
        """
        Removes a member from a workspace.
        :visibility: public
        """
        if requesting_user_id and not self.check_permission(workspace_id, requesting_user_id, "manage_members"):
            raise PermissionError("Requesting user does not have permission to manage members.")

        ws = self.get_workspace(workspace_id)
        clean_user = str(user_id).strip()

        if ws.get("owner_id") == clean_user:
            raise ValueError("Cannot remove workspace owner.")

        initial_count = len(ws.get("members", []))
        ws["members"] = [m for m in ws.get("members", []) if m.get("user_id") != clean_user]

        if len(ws["members"]) < initial_count:
            ws["updated_at"] = current_iso_timestamp()
            self.save_state()
            return True
        return False

    def update_member_role(self, workspace_id: str, user_id: str, new_role: str, requesting_user_id: str = None) -> dict:
        """
        Updates an existing member's role in a workspace.
        :visibility: public
        """
        return self.add_member(workspace_id, user_id, role=new_role, requesting_user_id=requesting_user_id)

    def add_shared_command(self, workspace_id: str, category_name: str, command_obj: dict, requesting_user_id: str = None) -> dict:
        """
        Adds a shared command to a workspace category.
        :visibility: public
        """
        if requesting_user_id and not self.check_permission(workspace_id, requesting_user_id, "manage_commands"):
            raise PermissionError("Requesting user does not have permission to add shared commands.")

        ws = self.get_workspace(workspace_id)

        # Check command limit
        billing_status = self.get_billing_status(workspace_id)
        if billing_status["is_command_quota_exceeded"]:
            raise ValueError(f"Workspace command limit reached ({billing_status['max_commands']}) for plan '{ws.get('plan')}'. Upgrade plan to add more commands.")

        cat_name = str(category_name).strip() if category_name else "Workspace Shared"
        categories = ws.setdefault("categories", [])

        target_cat = None
        for cat in categories:
            if cat.get("name") == cat_name:
                target_cat = cat
                break

        if not target_cat:
            target_cat = {"name": cat_name, "commands": []}
            categories.append(target_cat)

        cmds = target_cat.setdefault("commands", [])
        clean_cmd_name = command_obj.get("name", "Unnamed Command")

        # Replace or append
        existing_idx = -1
        for idx, c in enumerate(cmds):
            if c.get("name") == clean_cmd_name:
                existing_idx = idx
                break

        cmd_entry = dict(command_obj)
        cmd_entry["shared_by"] = requesting_user_id if requesting_user_id else "admin"
        cmd_entry["workspace_id"] = workspace_id

        if existing_idx >= 0:
            cmds[existing_idx] = cmd_entry
        else:
            cmds.append(cmd_entry)

        ws["updated_at"] = current_iso_timestamp()
        self.save_state()

        # Trigger Slack notification
        self.send_slack_notification(
            workspace_id,
            "workspace_update",
            f"Shared command '{clean_cmd_name}' was added to category '{cat_name}'",
            {"command": clean_cmd_name, "category": cat_name, "user": requesting_user_id}
        )

        return ws

    def remove_shared_command(self, workspace_id: str, category_name: str, command_name: str, requesting_user_id: str = None) -> bool:
        """
        Removes a shared command from a workspace.
        :visibility: public
        """
        if requesting_user_id and not self.check_permission(workspace_id, requesting_user_id, "manage_commands"):
            raise PermissionError("Requesting user does not have permission to remove shared commands.")

        ws = self.get_workspace(workspace_id)
        categories = ws.get("categories", [])

        removed = False
        for cat in categories:
            if not category_name or cat.get("name") == category_name:
                cmds = cat.get("commands", [])
                init_len = len(cmds)
                cat["commands"] = [c for c in cmds if c.get("name") != command_name]
                if len(cat["commands"]) < init_len:
                    removed = True

        if removed:
            ws["updated_at"] = current_iso_timestamp()
            self.save_state()
        return removed

    def get_merged_categories(self, user_config: dict) -> list:
        """
        Merges local user categories with the active workspace's shared categories.
        :visibility: public
        """
        local_categories = json.loads(json.dumps(user_config.get("categories", [])))
        active_ws = self.get_active_workspace(user_config)

        if not active_ws:
            return local_categories

        ws_categories = active_ws.get("categories", [])
        merged = list(local_categories)

        for ws_cat in ws_categories:
            ws_cat_name = f"[{active_ws.get('name')}] {ws_cat.get('name')}"
            cat_copy = {
                "name": ws_cat_name,
                "workspace_id": active_ws.get("id"),
                "workspace_name": active_ws.get("name"),
                "commands": []
            }
            for cmd in ws_cat.get("commands", []):
                cmd_copy = dict(cmd)
                cmd_copy["workspace_id"] = active_ws.get("id")
                cmd_copy["is_shared"] = True
                cat_copy["commands"].append(cmd_copy)

            merged.append(cat_copy)

        return merged

    def record_command_execution(self, workspace_id: str, user_id: str, command_name: str, category: str = "General", status: str = "success", duration_ms: float = 0.0, metadata: dict = None) -> dict:
        """
        Logs command execution metrics for workspace usage analytics.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)

        # Check execution quota
        billing_status = self.get_billing_status(workspace_id)
        if billing_status["is_execution_quota_exceeded"]:
            raise ValueError(f"Workspace monthly execution limit reached ({billing_status['execution_quota']}) for plan '{ws.get('plan')}'. Upgrade plan to run more commands.")

        analytics = ws.setdefault("usage_analytics", {
            "total_executions": 0,
            "executions_by_user": {},
            "executions_by_command": {},
            "execution_logs": []
        })

        analytics["total_executions"] += 1

        clean_user = str(user_id).strip() if user_id else "anonymous"
        analytics["executions_by_user"][clean_user] = analytics["executions_by_user"].get(clean_user, 0) + 1

        clean_cmd = str(command_name).strip() if command_name else "Unknown"
        analytics["executions_by_command"][clean_cmd] = analytics["executions_by_command"].get(clean_cmd, 0) + 1

        log_entry = {
            "id": f"log_{uuid.uuid4().hex[:8]}",
            "timestamp": current_iso_timestamp(),
            "user_id": clean_user,
            "command_name": clean_cmd,
            "category": category,
            "status": status,
            "duration_ms": duration_ms,
            "metadata": metadata or {}
        }

        logs = analytics.setdefault("execution_logs", [])
        logs.append(log_entry)
        # Keep last 500 execution logs to prevent unbounded growth
        if len(logs) > 500:
            analytics["execution_logs"] = logs[-500:]

        ws["updated_at"] = current_iso_timestamp()
        self.save_state()

        # Trigger Slack notification
        self.send_slack_notification(
            workspace_id,
            "command_execution",
            f"User '{clean_user}' executed command '{clean_cmd}' ({status}) in workspace '{ws.get('name')}'",
            {"user": clean_user, "command": clean_cmd, "status": status, "duration_ms": duration_ms}
        )

        return log_entry

    def get_usage_analytics(self, workspace_id: str, requesting_user_id: str = None, timeframe: str = "all") -> dict:
        """
        Returns aggregate usage analytics and metrics for a workspace.
        :visibility: public
        """
        if requesting_user_id and not self.check_permission(workspace_id, requesting_user_id, "view_analytics"):
            raise PermissionError("Requesting user does not have permission to view analytics.")

        ws = self.get_workspace(workspace_id)
        analytics = ws.get("usage_analytics", {})
        logs = analytics.get("execution_logs", [])

        success_count = sum(1 for log in logs if log.get("status") == "success")
        failure_count = sum(1 for log in logs if log.get("status") != "success")
        total_logs = len(logs)
        success_rate = (success_count / total_logs * 100.0) if total_logs > 0 else 100.0

        top_commands = sorted(
            analytics.get("executions_by_command", {}).items(),
            key=lambda x: x[1],
            reverse=True
        )[:10]

        top_users = sorted(
            analytics.get("executions_by_user", {}).items(),
            key=lambda x: x[1],
            reverse=True
        )[:10]

        return {
            "workspace_id": workspace_id,
            "workspace_name": ws.get("name"),
            "total_executions": analytics.get("total_executions", 0),
            "success_rate": round(success_rate, 2),
            "total_logged_events": total_logs,
            "success_count": success_count,
            "failure_count": failure_count,
            "top_commands": dict(top_commands),
            "top_users": dict(top_users),
            "recent_logs": logs[-20:]
        }

    def get_billing_status(self, workspace_id: str) -> dict:
        """
        Returns workspace billing status, quotas, and utilization metrics.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        plan_name = ws.get("plan", "free")
        limits = BILLING_PLANS.get(plan_name, BILLING_PLANS["free"])

        current_members = len(ws.get("members", []))
        max_members = limits["max_members"]

        # Count total commands in workspace shared categories
        current_commands = 0
        for cat in ws.get("categories", []):
            current_commands += len(cat.get("commands", []))
        max_commands = limits["max_commands"]

        current_executions = ws.get("usage_analytics", {}).get("total_executions", 0)
        max_executions = limits["max_monthly_executions"]

        is_member_quota_exceeded = (max_members != -1) and (current_members >= max_members)
        is_command_quota_exceeded = (max_commands != -1) and (current_commands >= max_commands)
        is_execution_quota_exceeded = (max_executions != -1) and (current_executions >= max_executions)

        return {
            "workspace_id": workspace_id,
            "plan": plan_name,
            "member_count": current_members,
            "max_members": max_members,
            "command_count": current_commands,
            "max_commands": max_commands,
            "monthly_executions": current_executions,
            "execution_quota": max_executions,
            "is_member_quota_exceeded": is_member_quota_exceeded,
            "is_command_quota_exceeded": is_command_quota_exceeded,
            "is_execution_quota_exceeded": is_execution_quota_exceeded
        }

    def update_billing_plan(self, workspace_id: str, new_plan: str, requesting_user_id: str = None) -> dict:
        """
        Updates workspace billing plan (e.g. free -> pro -> enterprise).
        :visibility: public
        """
        if requesting_user_id and not self.check_permission(workspace_id, requesting_user_id, "manage_billing"):
            raise PermissionError("Requesting user does not have permission to manage billing.")

        if new_plan not in BILLING_PLANS:
            raise ValueError(f"Invalid plan '{new_plan}'. Must be one of: {list(BILLING_PLANS.keys())}")

        ws = self.get_workspace(workspace_id)
        ws["plan"] = new_plan
        ws["updated_at"] = current_iso_timestamp()
        self.save_state()

        self.send_slack_notification(
            workspace_id,
            "workspace_update",
            f"Workspace '{ws.get('name')}' billing plan upgraded to '{new_plan}'",
            {"plan": new_plan, "user": requesting_user_id}
        )

        return self.get_billing_status(workspace_id)

    def check_billing_quota(self, workspace_id: str, metric: str = "executions") -> bool:
        """
        Checks if workspace is within billing quota for specified metric.
        :visibility: public
        """
        status = self.get_billing_status(workspace_id)
        if metric == "members" and status["is_member_quota_exceeded"]:
            raise ValueError(f"Member quota exceeded ({status['member_count']}/{status['max_members']})")
        if metric == "commands" and status["is_command_quota_exceeded"]:
            raise ValueError(f"Command quota exceeded ({status['command_count']}/{status['max_commands']})")
        if metric == "executions" and status["is_execution_quota_exceeded"]:
            raise ValueError(f"Execution quota exceeded ({status['monthly_executions']}/{status['execution_quota']})")
        return True

    def publish_to_registry(self, workspace_id: str, package_id: str, name: str, version: str, commands: list, requesting_user_id: str = None, description: str = "") -> dict:
        """
        Publishes a command package to the workspace private registry.
        :visibility: public
        """
        if requesting_user_id and not self.check_permission(workspace_id, requesting_user_id, "manage_registry"):
            raise PermissionError("Requesting user does not have permission to publish to private registry.")

        if not package_id or not str(package_id).strip():
            raise ValueError("Package ID cannot be empty.")
        if not commands or not isinstance(commands, list):
            raise ValueError("Package must include a non-empty list of commands.")

        ws = self.get_workspace(workspace_id)
        registry = ws.setdefault("private_registry", [])

        pkg_entry = {
            "package_id": str(package_id).strip(),
            "name": str(name).strip(),
            "version": str(version).strip(),
            "description": str(description).strip(),
            "publisher": requesting_user_id or "admin",
            "commands": commands,
            "published_at": current_iso_timestamp()
        }

        # Update or add
        existing_idx = -1
        for idx, pkg in enumerate(registry):
            if pkg.get("package_id") == pkg_entry["package_id"]:
                existing_idx = idx
                break

        if existing_idx >= 0:
            registry[existing_idx] = pkg_entry
        else:
            registry.append(pkg_entry)

        ws["updated_at"] = current_iso_timestamp()
        self.save_state()

        self.send_slack_notification(
            workspace_id,
            "registry_publish",
            f"Package '{name}' (v{version}) published to workspace private registry",
            {"package_id": package_id, "version": version, "publisher": requesting_user_id}
        )

        return pkg_entry

    def search_registry(self, workspace_id: str, query: str = "") -> list:
        """
        Searches published packages in the workspace private registry.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        registry = ws.get("private_registry", [])

        if not query or not str(query).strip():
            return registry

        q = str(query).strip().lower()
        results = []
        for pkg in registry:
            if (q in pkg.get("package_id", "").lower() or
                q in pkg.get("name", "").lower() or
                q in pkg.get("description", "").lower()):
                results.append(pkg)
        return results

    def install_from_registry(self, workspace_id: str, package_id: str, user_config: dict, requesting_user_id: str = None) -> list:
        """
        Installs package commands from private registry into user configuration.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        registry = ws.get("private_registry", [])

        pkg = None
        for p in registry:
            if p.get("package_id") == package_id:
                pkg = p
                break

        if not pkg:
            raise KeyError(f"Package '{package_id}' not found in private registry.")

        pkg_category = {
            "name": f"Registry: {pkg.get('name')}",
            "commands": pkg.get("commands", [])
        }

        user_categories = user_config.setdefault("categories", [])
        user_categories.append(pkg_category)
        return user_config

    def configure_slack(self, workspace_id: str, webhook_url: str, channel: str = "#general", enabled: bool = True, events: list = None, requesting_user_id: str = None) -> dict:
        """
        Configures Slack webhook integration settings for workspace notifications.
        :visibility: public
        """
        if requesting_user_id and not self.check_permission(workspace_id, requesting_user_id, "manage_slack"):
            raise PermissionError("Requesting user does not have permission to manage Slack settings.")

        ws = self.get_workspace(workspace_id)
        slack_config = {
            "webhook_url": str(webhook_url).strip() if webhook_url else "",
            "channel": str(channel).strip() if channel else "#general",
            "enabled": bool(enabled),
            "events": events if isinstance(events, list) else ["command_execution", "workspace_update", "registry_publish"]
        }

        ws["slack_config"] = slack_config
        ws["updated_at"] = current_iso_timestamp()
        self.save_state()
        return slack_config

    def format_slack_payload(self, workspace_id: str, event_type: str, message: str, details: dict = None) -> dict:
        """
        Formats standard Slack Incoming Webhook Block Kit payload.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        channel = ws.get("slack_config", {}).get("channel", "#general")

        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": f"CmdBar Workspace: {ws.get('name')}",
                    "emoji": True
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*{event_type.replace('_', ' ').title()}*\n{message}"
                }
            }
        ]

        if details:
            fields = []
            for k, v in details.items():
                fields.append({
                    "type": "mrkdwn",
                    "text": f"*{k.replace('_', ' ').title()}:*\n`{v}`"
                })
            blocks.append({
                "type": "section",
                "fields": fields[:10]  # Slack limit
            })

        return {
            "channel": channel,
            "text": f"[{ws.get('name')}] {message}",
            "blocks": blocks
        }

    def send_slack_notification(self, workspace_id: str, event_type: str, message: str, details: dict = None) -> bool:
        """
        Sends a Slack webhook notification for workspace events.
        :visibility: public
        """
        ws = self.get_workspace(workspace_id)
        slack = ws.get("slack_config", {})

        if not slack.get("enabled") or not slack.get("webhook_url"):
            return False

        configured_events = slack.get("events", [])
        if configured_events and event_type not in configured_events:
            return False

        payload = self.format_slack_payload(workspace_id, event_type, message, details)

        try:
            req = urllib.request.Request(
                slack["webhook_url"],
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                return resp.status in (200, 204)
        except Exception:
            return False
