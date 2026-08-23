"""
Command Security Policy Engine for CmdBar (Python Runtime).
Provides blacklist command blocking, whitelist enforcement, wildcard/glob/regex pattern matching,
user/group scoped policy rules, and approval override mechanisms.
"""

import os
import re
import getpass
import time
import secrets
from typing import Dict, List, Any, Optional, Tuple

DEFAULT_BLACKLIST_PATTERNS = [
    "rm -rf *",
    "rm -rf /",
    "mkfs*",
    "dd if=*",
    ":(){ :|:& };:",
    "chmod -R 777 *",
    "shutdown*",
    "reboot*",
    "> /dev/sd*",
    "wget * | sh",
    "curl * | sh",
    "wget * | bash",
    "curl * | bash",
]

DEFAULT_WHITELIST_PATTERNS = [
    "echo *",
    "make *",
    "git *",
    "aws *",
    "ping *",
    "docker *",
    "python*",
    "node *",
    "npm *",
    "notify-send *",
    "deploy *",
    "pkill *",
    "zenity *",
]


def glob_to_regex(pattern: str) -> re.Pattern:
    """Converts a glob pattern with * and ? into a compiled regular expression."""
    if not isinstance(pattern, str):
        return re.compile(r"^$")
    clean = pattern.strip()
    regex_str = ""
    for char in clean:
        if char == "*":
            regex_str += ".*"
        elif char == "?":
            regex_str += "."
        elif char in r"\^$.|()[]{}+":
            regex_str += r"\\" + char
        else:
            regex_str += char
    return re.compile(f"^{regex_str}$", re.IGNORECASE)


def match_pattern(command_str: str, pattern: Any) -> bool:
    """Evaluates whether command_str matches pattern (exact, glob, regex, or prefix)."""
    if not command_str or pattern is None:
        return False

    clean_cmd = str(command_str).strip()
    if not clean_cmd:
        return False

    if isinstance(pattern, re.Pattern):
        return bool(pattern.search(clean_cmd))

    str_pattern = str(pattern).strip()
    if not str_pattern:
        return False

    # 1. Regex prefix ("regex:...")
    if str_pattern.startswith("regex:"):
        raw_regex = str_pattern[6:].strip()
        try:
            return bool(re.search(raw_regex, clean_cmd, re.IGNORECASE))
        except Exception:
            return False

    # 2. Exact match
    if clean_cmd.lower() == str_pattern.lower():
        return True

    # 3. Glob match
    if "*" in str_pattern or "?" in str_pattern:
        rx = glob_to_regex(str_pattern)
        return bool(rx.match(clean_cmd))

    # 4. Token binary match or prefix
    cmd_tokens = clean_cmd.split()
    first_token = cmd_tokens[0] if cmd_tokens else ""
    pattern_tokens = str_pattern.split()

    if len(pattern_tokens) == 1:
        if (
            first_token.lower() == str_pattern.lower()
            or first_token.lower().endswith("/" + str_pattern.lower())
        ):
            return True

    if clean_cmd.lower().startswith(str_pattern.lower()):
        return True

    return False


def resolve_user_context(custom_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Resolves current user and group context."""
    ctx = custom_context or {}
    user = ctx.get("user") or ctx.get("username")
    group = ctx.get("group") or ctx.get("role") or "users"
    groups = list(ctx.get("groups", []))

    if not user:
        try:
            user = getpass.getuser()
        except Exception:
            user = os.environ.get("USER", "unknown")

    user_str = str(user).lower()
    group_str = str(group).lower()
    groups_lower = [str(g).lower() for g in groups]

    if group_str not in groups_lower:
        groups_lower.append(group_str)

    return {"user": user_str, "group": group_str, "groups": groups_lower}


def evaluate_command_policy(
    command_str: str,
    custom_context: Optional[Dict[str, Any]] = None,
    policy_config: Optional[Dict[str, Any]] = None,
    approval_token: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Evaluates command_str against the given policy configuration and user context.
    Returns dict with evaluation result.
    """
    if not command_str or not isinstance(command_str, str) or not command_str.strip():
        return {
            "allowed": False,
            "reason": "Empty or invalid command string",
            "blocked_by": "validation",
            "rule": None,
            "pattern": None,
            "approved": False,
        }

    clean_cmd = command_str.strip()
    context = resolve_user_context(custom_context)

    policy = policy_config or {
        "enabled": True,
        "mode": "blacklist",
        "blacklist": DEFAULT_BLACKLIST_PATTERNS,
        "whitelist": [],
        "rules": [],
        "overrides": [],
    }

    if not policy.get("enabled", True):
        return {
            "allowed": True,
            "reason": "Security policy is disabled",
            "blocked_by": None,
            "rule": None,
            "pattern": None,
            "approved": False,
        }

    # 1. Override Token Check
    overrides = policy.get("overrides", [])
    now = time.time() * 1000

    if approval_token and isinstance(overrides, list):
        for ov in overrides:
            if isinstance(ov, dict) and ov.get("token") == approval_token:
                cmd_pattern = ov.get("command", "*")
                exp = ov.get("expiresAt")
                if (cmd_pattern == "*" or match_pattern(clean_cmd, cmd_pattern)) and (
                    not exp or exp > now
                ):
                    return {
                        "allowed": True,
                        "reason": f"Allowed via active approval override (Token: {approval_token})",
                        "blocked_by": None,
                        "rule": None,
                        "pattern": cmd_pattern,
                        "approved": True,
                    }

    if isinstance(overrides, list):
        for ov in overrides:
            if isinstance(ov, dict) and ov.get("approved") is True:
                cmd_pattern = ov.get("command")
                exp = ov.get("expiresAt")
                if cmd_pattern and match_pattern(clean_cmd, cmd_pattern) and (
                    not exp or exp > now
                ):
                    return {
                        "allowed": True,
                        "reason": f"Allowed via direct approved command override for '{cmd_pattern}'",
                        "blocked_by": None,
                        "rule": None,
                        "pattern": cmd_pattern,
                        "approved": True,
                    }

    # 2. User / Group Specific Rules
    rules = policy.get("rules", [])
    if isinstance(rules, list):
        for rule in rules:
            if not isinstance(rule, dict) or not rule.get("pattern"):
                continue

            # User match
            user_matches = False
            r_user = rule.get("user")
            r_users = rule.get("users")
            if r_user:
                user_matches = str(r_user).lower() == context["user"]
            elif isinstance(r_users, list):
                user_matches = context["user"] in [str(u).lower() for u in r_users]
            else:
                user_matches = True

            # Group match
            group_matches = False
            r_group = rule.get("group")
            r_groups = rule.get("groups")
            if r_group:
                group_matches = str(r_group).lower() in context["groups"]
            elif isinstance(r_groups, list):
                r_groups_lower = [str(g).lower() for g in r_groups]
                group_matches = any(g in context["groups"] for g in r_groups_lower)
            else:
                group_matches = True

            if user_matches and group_matches:
                if match_pattern(clean_cmd, rule["pattern"]):
                    action = str(rule.get("action", "deny")).lower()
                    if action in ("deny", "block"):
                        return {
                            "allowed": False,
                            "reason": rule.get("reason")
                            or f"Blocked by user/group policy rule ({rule.get('id', rule['pattern'])})",
                            "blocked_by": "user_group_rule",
                            "rule": rule,
                            "pattern": rule["pattern"],
                            "approved": False,
                        }
                    elif action in ("allow", "permit"):
                        return {
                            "allowed": True,
                            "reason": rule.get("reason")
                            or f"Allowed by user/group policy rule ({rule.get('id', rule['pattern'])})",
                            "blocked_by": None,
                            "rule": rule,
                            "pattern": rule["pattern"],
                            "approved": False,
                        }

    mode = str(policy.get("mode", "blacklist")).lower()

    # 3. Blacklist Check
    blacklist = policy.get("blacklist", DEFAULT_BLACKLIST_PATTERNS)
    if mode in ("blacklist", "combined") and isinstance(blacklist, list):
        for pattern in blacklist:
            if match_pattern(clean_cmd, pattern):
                return {
                    "allowed": False,
                    "reason": f"Blocked by dangerous command blacklist pattern: '{pattern}'",
                    "blocked_by": "blacklist",
                    "rule": None,
                    "pattern": str(pattern),
                    "approved": False,
                }

    # 4. Whitelist Check
    whitelist = policy.get("whitelist", [])
    if (mode == "whitelist" or (mode == "combined" and whitelist)) and isinstance(
        whitelist, list
    ):
        matched_whitelist = False
        for pattern in whitelist:
            if match_pattern(clean_cmd, pattern):
                matched_whitelist = True
                break

        if not matched_whitelist:
            return {
                "allowed": False,
                "reason": "Command is not present in required command whitelist",
                "blocked_by": "whitelist",
                "rule": None,
                "pattern": None,
                "approved": False,
            }

    return {
        "allowed": True,
        "reason": "Command security policy check passed successfully",
        "blocked_by": None,
        "rule": None,
        "pattern": None,
        "approved": False,
    }


class CommandPolicyManager:
    """Command Security Policy Manager for Python applications."""

    def __init__(self, initial_policy: Optional[Dict[str, Any]] = None):
        self.policy = initial_policy or {
            "enabled": True,
            "mode": "blacklist",
            "blacklist": list(DEFAULT_BLACKLIST_PATTERNS),
            "whitelist": list(DEFAULT_WHITELIST_PATTERNS),
            "rules": [],
            "overrides": [],
        }
        self.pending_approvals = {}

    def set_policy(self, policy_config: Dict[str, Any]) -> None:
        if not isinstance(policy_config, dict):
            return
        self.policy = {
            "enabled": policy_config.get("enabled", True),
            "mode": policy_config.get("mode", "blacklist"),
            "blacklist": list(policy_config.get("blacklist", DEFAULT_BLACKLIST_PATTERNS)),
            "whitelist": list(policy_config.get("whitelist", DEFAULT_WHITELIST_PATTERNS)),
            "rules": list(policy_config.get("rules", [])),
            "overrides": list(policy_config.get("overrides", [])),
        }

    def get_policy(self) -> Dict[str, Any]:
        return json.loads(json.dumps(self.policy))

    def evaluate(
        self,
        command_str: str,
        context: Optional[Dict[str, Any]] = None,
        approval_token: Optional[str] = None,
    ) -> Dict[str, Any]:
        return evaluate_command_policy(
            command_str, context, self.policy, approval_token
        )

    def request_approval(
        self,
        command_str: str,
        requester_context: Optional[Dict[str, Any]] = None,
        reason: str = "",
    ) -> Dict[str, Any]:
        ctx = resolve_user_context(requester_context)
        req_id = f"req_{int(time.time() * 1000)}_{secrets.token_hex(4)}"
        request = {
            "id": req_id,
            "command": command_str,
            "user": ctx["user"],
            "groups": ctx["groups"],
            "reason": reason or "Requested command override approval",
            "status": "pending",
            "createdAt": int(time.time() * 1000),
            "approvedBy": None,
            "token": None,
        }
        self.pending_approvals[req_id] = request
        return dict(request)

    def approve_request(
        self,
        request_id: str,
        approver_context: Optional[Dict[str, Any]] = None,
        ttl_ms: int = 3600000,
    ) -> Dict[str, Any]:
        req = self.pending_approvals.get(request_id)
        if not req:
            raise ValueError(f"Approval request ID '{request_id}' not found")

        approver = resolve_user_context(approver_context)
        token = f"token_appr_{int(time.time() * 1000)}_{secrets.token_hex(6)}"
        expires_at = int(time.time() * 1000) + ttl_ms

        req["status"] = "approved"
        req["approvedBy"] = approver["user"]
        req["token"] = token
        req["expiresAt"] = expires_at

        override = {
            "id": f"ovr_{request_id}",
            "command": req["command"],
            "token": token,
            "approved": True,
            "approvedBy": approver["user"],
            "expiresAt": expires_at,
        }

        if "overrides" not in self.policy or not isinstance(self.policy["overrides"], list):
            self.policy["overrides"] = []
        self.policy["overrides"].append(override)

        return dict(req)

    def reject_request(
        self,
        request_id: str,
        approver_context: Optional[Dict[str, Any]] = None,
        reject_reason: str = "",
    ) -> Dict[str, Any]:
        req = self.pending_approvals.get(request_id)
        if not req:
            raise ValueError(f"Approval request ID '{request_id}' not found")

        approver = resolve_user_context(approver_context)
        req["status"] = "rejected"
        req["approvedBy"] = approver["user"]
        req["rejectReason"] = reject_reason or "Approval request denied by policy administrator"

        return dict(req)

    def grant_override(
        self,
        command_pattern: str,
        approver_context: Optional[Dict[str, Any]] = None,
        ttl_ms: int = 3600000,
    ) -> Dict[str, Any]:
        approver = resolve_user_context(approver_context)
        token = f"token_dir_{int(time.time() * 1000)}_{secrets.token_hex(6)}"
        expires_at = int(time.time() * 1000) + ttl_ms

        override = {
            "id": f"ovr_dir_{int(time.time() * 1000)}",
            "command": command_pattern,
            "token": token,
            "approved": True,
            "approvedBy": approver["user"],
            "expiresAt": expires_at,
        }

        if "overrides" not in self.policy or not isinstance(self.policy["overrides"], list):
            self.policy["overrides"] = []
        self.policy["overrides"].append(override)

        return {"token": token, "command": command_pattern, "expiresAt": expires_at}

    def revoke_override(self, token_or_id: str) -> bool:
        overrides = self.policy.get("overrides", [])
        if not isinstance(overrides, list):
            return False
        init_len = len(overrides)
        self.policy["overrides"] = [
            ov for ov in overrides
            if isinstance(ov, dict) and ov.get("token") != token_or_id and ov.get("id") != token_or_id
        ]
        return len(self.policy["overrides"]) < init_len

    def list_pending_approvals(self) -> List[Dict[str, Any]]:
        return [r for r in self.pending_approvals.values() if r.get("status") == "pending"]

    def list_overrides(self) -> List[Dict[str, Any]]:
        overrides = self.policy.get("overrides", [])
        if not isinstance(overrides, list):
            return []
        now = time.time() * 1000
        return [
            ov for ov in overrides
            if isinstance(ov, dict) and (not ov.get("expiresAt") or ov["expiresAt"] > now)
        ]
