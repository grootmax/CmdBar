"""
Team Command Sharing, Repository Management, Version Control, Role-Based Access Control (RBAC),
Approval Workflows, and Activity Feed Manager.
"""

import json
import time
import hashlib
import base64
import random
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs, urlencode, quote, unquote

from app.config_schema import canonical_json

ROLES = {
    "VIEWER": "viewer",
    "EDITOR": "editor",
    "APPROVER": "approver",
    "ADMIN": "admin",
}

ROLE_LEVELS = {
    "viewer": 1,
    "editor": 2,
    "approver": 3,
    "admin": 4,
}

PERMISSIONS = {
    "VIEW": "viewer",
    "EXECUTE": "viewer",
    "SHARE_URL": "viewer",
    "IMPORT_URL": "viewer",
    "CREATE_COMMAND": "editor",
    "EDIT_COMMAND": "editor",
    "PROPOSE_CHANGE": "editor",
    "REVIEW_PROPOSAL": "approver",
    "APPROVE_PROPOSAL": "approver",
    "REJECT_PROPOSAL": "approver",
    "MANAGE_REPOS": "admin",
    "MANAGE_ROLES": "admin",
    "ROLLBACK_VERSION": "admin",
}


def sha256_hex(text: str) -> str:
    """
    Computes SHA-256 hex string for given text.
    :visibility: public
    """
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def has_permission(user_role: str = "viewer", action: str = "VIEW") -> bool:
    """
    Returns True if user_role has sufficient authority for action.
    :visibility: public
    """
    norm_role = (user_role or "viewer").lower()
    req_role = PERMISSIONS.get(action, "admin")
    user_lvl = ROLE_LEVELS.get(norm_role, 1)
    req_lvl = ROLE_LEVELS.get(req_role, 4)
    return user_lvl >= req_lvl


def check_permission(user_role: str, action: str) -> bool:
    """
    Asserts user_role permission for action or raises PermissionError.
    :visibility: public
    """
    if not has_permission(user_role, action):
        req = PERMISSIONS.get(action, "admin")
        raise PermissionError(
            f"Permission denied: Action '{action}' requires '{req}' role or higher (provided: '{user_role}')"
        )
    return True


def encode_command_share_url(data: dict, options: dict = None) -> str:
    """
    Encodes command or category dictionary into a shareable URL string.
    :visibility: public
    """
    options = options or {}
    scheme = options.get("scheme", "cmdbar://share")
    secret_key = options.get("secretKey", "")
    expires_in = options.get("expiresInSeconds", 0)

    now_ms = int(time.time() * 1000)
    expires_at = now_ms + (expires_in * 1000) if expires_in != 0 else 0

    payload = {
        "version": 1,
        "type": "category" if "commands" in data else "command",
        "data": data,
        "timestamp": now_ms,
        "expiresAt": expires_at,
    }

    json_str = canonical_json(payload)
    base64_bytes = base64.urlsafe_b64encode(json_str.encode("utf-8"))
    base64_data = base64_bytes.decode("utf-8").rstrip("=")

    checksum = sha256_hex(json_str + secret_key)

    if scheme.startswith("http://") or scheme.startswith("https://"):
        params = urlencode({"data": base64_data, "sig": checksum})
        return f"{scheme}?{params}"

    return f"{scheme}?data={quote(base64_data)}&sig={checksum}"


def decode_command_share_url(share_url: str, options: dict = None) -> dict:
    """
    Decodes and validates a shared command URL.
    :visibility: public
    """
    options = options or {}
    if not share_url or not isinstance(share_url, str):
        return {"valid": False, "error": "Invalid or empty share URL string."}

    parsed = urlparse(share_url)
    qs = parse_qs(parsed.query)

    base64_data = qs.get("data", [""])[0]
    sig = qs.get("sig", [""])[0]

    if not base64_data:
        return {"valid": False, "error": "Missing 'data' parameter in share URL."}

    try:
        raw_b64 = unquote(base64_data)
        # Add padding if needed
        padding = 4 - (len(raw_b64) % 4)
        if padding < 4:
            raw_b64 += "=" * padding
        decoded_bytes = base64.urlsafe_b64decode(raw_b64)
        json_str = decoded_bytes.decode("utf-8")
        payload = json.loads(json_str)

        if not isinstance(payload, dict) or "data" not in payload:
            return {"valid": False, "error": "Malformed payload structure."}

        expires_at = payload.get("expiresAt", 0)
        now_ms = int(time.time() * 1000)
        if expires_at and expires_at != 0 and now_ms > expires_at:
            return {"valid": False, "error": "Share URL has expired."}

        secret_key = options.get("secretKey", "")
        expected_sig = sha256_hex(canonical_json(payload) + secret_key)

        if sig and sig != expected_sig and options.get("requireSignature"):
            return {"valid": False, "error": "Signature verification failed."}

        return {
            "valid": True,
            "type": payload.get("type"),
            "data": payload.get("data"),
            "timestamp": payload.get("timestamp"),
            "expiresAt": expires_at,
        }
    except Exception as e:
        return {"valid": False, "error": f"Failed to decode share URL: {str(e)}"}


def import_from_share_url(
    share_url: str,
    target_category: str = "Shared Commands",
    config: dict = None,
    user_role: str = "viewer",
) -> dict:
    """
    Imports command/category payload from share URL into local configuration.
    :visibility: public
    """
    check_permission(user_role, "IMPORT_URL")

    decode_res = decode_command_share_url(share_url)
    if not decode_res.get("valid"):
        raise ValueError(decode_res.get("error"))

    updated_config = json.loads(json.dumps(config or {"categories": []}))
    if "categories" not in updated_config or not isinstance(updated_config["categories"], list):
        updated_config["categories"] = []

    payload_data = decode_res["data"]
    imported_count = 0

    if decode_res.get("type") == "category" and "commands" in payload_data:
        cat_name = target_category or payload_data.get("name", "Shared Commands")
        cat = next((c for c in updated_config["categories"] if c.get("name") == cat_name), None)
        if not cat:
            cat = {"name": cat_name, "commands": []}
            updated_config["categories"].append(cat)
        for cmd in payload_data.get("commands", []):
            cat["commands"].append(cmd)
            imported_count += 1
    else:
        cat = next((c for c in updated_config["categories"] if c.get("name") == target_category), None)
        if not cat:
            cat = {"name": target_category, "commands": []}
            updated_config["categories"].append(cat)
        cat["commands"].append(payload_data)
        imported_count = 1

    log_activity(
        updated_config,
        actor="User",
        actor_role=user_role,
        action="IMPORT_SHARE_URL",
        target=target_category,
        details=f"Imported {imported_count} command(s) via URL",
    )

    return {
        "config": updated_config,
        "importedCount": imported_count,
        "category": target_category,
    }


def add_team_repository(repo_data: dict, config: dict, user_role: str = "admin") -> dict:
    """
    Registers a new team repository.
    :visibility: public
    """
    check_permission(user_role, "MANAGE_REPOS")

    updated_config = json.loads(json.dumps(config or {}))
    if "teamRepositories" not in updated_config or not isinstance(updated_config["teamRepositories"], list):
        updated_config["teamRepositories"] = []

    if not repo_data or not repo_data.get("id") or not repo_data.get("name"):
        raise ValueError("Repository data must include 'id' and 'name'.")

    repo_id = repo_data["id"]
    existing_idx = next((i for i, r in enumerate(updated_config["teamRepositories"]) if r.get("id") == repo_id), -1)

    new_repo = {
        "id": repo_id,
        "name": repo_data["name"],
        "url": repo_data.get("url", ""),
        "branch": repo_data.get("branch", "main"),
        "role": repo_data.get("role", "viewer"),
        "syncInterval": repo_data.get("syncInterval", 3600),
        "enabled": repo_data.get("enabled", True),
        "autoApprove": repo_data.get("autoApprove", False),
        "lastSynced": None,
        "commandsCount": 0,
    }

    if existing_idx >= 0:
        updated_config["teamRepositories"][existing_idx].update(new_repo)
    else:
        updated_config["teamRepositories"].append(new_repo)

    log_activity(
        updated_config,
        actor="User",
        actor_role=user_role,
        action="ADD_TEAM_REPO",
        target=repo_data["name"],
        details=f"Registered team repository '{repo_data['name']}' ({repo_data.get('url', '')})",
        repo_id=repo_id,
    )

    return updated_config


def remove_team_repository(repo_id: str, config: dict, user_role: str = "admin") -> dict:
    """
    Removes / disconnects a team repository.
    :visibility: public
    """
    check_permission(user_role, "MANAGE_REPOS")

    updated_config = json.loads(json.dumps(config or {}))
    if "teamRepositories" not in updated_config or not isinstance(updated_config["teamRepositories"], list):
        return updated_config

    repo = next((r for r in updated_config["teamRepositories"] if r.get("id") == repo_id), None)
    updated_config["teamRepositories"] = [r for r in updated_config["teamRepositories"] if r.get("id") != repo_id]

    if repo and "categories" in updated_config and isinstance(updated_config["categories"], list):
        team_cat_name = f"Team: {repo.get('name')}"
        updated_config["categories"] = [c for c in updated_config["categories"] if c.get("name") != team_cat_name]

    log_activity(
        updated_config,
        actor="User",
        actor_role=user_role,
        action="REMOVE_TEAM_REPO",
        target=repo_id,
        details=f"Removed team repository '{repo_id}'",
        repo_id=repo_id,
    )

    return updated_config


def list_team_repositories(config: dict) -> list:
    """
    Returns list of configured team repositories.
    :visibility: public
    """
    return config.get("teamRepositories", []) if config else []


def sync_team_repository(
    repo_id: str,
    config: dict,
    remote_fetcher=None,
    user_role: str = "viewer",
) -> dict:
    """
    Syncs commands from a team repository into active configuration.
    :visibility: public
    """
    check_permission(user_role, "VIEW")

    updated_config = json.loads(json.dumps(config or {}))
    repos = list_team_repositories(updated_config)
    repo = next((r for r in repos if r.get("id") == repo_id), None)

    if not repo:
        raise ValueError(f"Team repository with ID '{repo_id}' not found.")

    if callable(remote_fetcher):
        remote_data = remote_fetcher(repo)
    else:
        remote_data = [
            {
                "name": f"[{repo['name']}] Health Check",
                "command": "curl -s http://localhost:8080/health",
                "teamRepoId": repo_id,
            },
            {
                "name": f"[{repo['name']}] Deploy Status",
                "command": "git status",
                "teamRepoId": repo_id,
            },
        ]

    team_cat_name = f"Team: {repo['name']}"
    if "categories" not in updated_config or not isinstance(updated_config["categories"], list):
        updated_config["categories"] = []

    cat = next((c for c in updated_config["categories"] if c.get("name") == team_cat_name), None)
    if not cat:
        cat = {"name": team_cat_name, "commands": []}
        updated_config["categories"].append(cat)
    else:
        cat["commands"] = [cmd for cmd in cat.get("commands", []) if cmd.get("teamRepoId") != repo_id]

    commands_list = remote_data if isinstance(remote_data, list) else remote_data.get("commands", [])

    for cmd in commands_list:
        cmd_copy = dict(cmd)
        cmd_copy["teamRepoId"] = repo_id
        cmd_copy["teamRepoName"] = repo["name"]
        cat["commands"].append(cmd_copy)

    repo["lastSynced"] = datetime.now(timezone.utc).isoformat()
    repo["commandsCount"] = len(cat["commands"])

    log_activity(
        updated_config,
        actor="User",
        actor_role=user_role,
        action="SYNC_TEAM_REPO",
        target=repo["name"],
        details=f"Synced {len(cat['commands'])} command(s) from team repository '{repo['name']}'",
        repo_id=repo_id,
    )

    return {
        "config": updated_config,
        "syncedCount": len(cat["commands"]),
        "repo": repo,
    }


def create_config_revision(config: dict, author: str = "system", message: str = "Updated configuration") -> dict:
    """
    Creates a new revision record in configuration version control.
    :visibility: public
    """
    updated_config = json.loads(json.dumps(config or {}))
    if "versionControl" not in updated_config:
        updated_config["versionControl"] = {"currentRevision": 0, "revisions": []}

    rev_num = updated_config["versionControl"]["currentRevision"] + 1
    timestamp = datetime.now(timezone.utc).isoformat()

    categories_snapshot = json.loads(json.dumps(updated_config.get("categories", [])))
    commit_hash = sha256_hex(canonical_json(categories_snapshot) + timestamp + author)

    revisions = updated_config["versionControl"].get("revisions", [])
    prev_rev = revisions[-1] if revisions else None

    diff_summary = (
        diff_config_revisions(prev_rev.get("categories", []), categories_snapshot)
        if prev_rev
        else {"addedCommands": sum(len(c.get("commands", [])) for c in categories_snapshot), "removedCommands": 0, "modifiedCommands": 0}
    )

    new_revision = {
        "revision": rev_num,
        "commitHash": commit_hash,
        "timestamp": timestamp,
        "author": author,
        "message": message,
        "diffSummary": diff_summary,
        "categories": categories_snapshot,
    }

    updated_config["versionControl"]["currentRevision"] = rev_num
    updated_config["versionControl"]["revisions"].append(new_revision)

    log_activity(
        updated_config,
        actor=author,
        actor_role="user",
        action="CREATE_REVISION",
        target=f"Rev #{rev_num}",
        details=f"Created revision #{rev_num}: {message}",
    )

    return updated_config


def get_revision_history(config: dict) -> list:
    """
    Returns list of configuration revision records.
    :visibility: public
    """
    return config.get("versionControl", {}).get("revisions", []) if config else []


def diff_config_revisions(snapshot_a: list = None, snapshot_b: list = None) -> dict:
    """
    Compares two category/command snapshots and returns diff summary.
    :visibility: public
    """
    snapshot_a = snapshot_a or []
    snapshot_b = snapshot_b or []

    map_a = {}
    map_b = {}

    for cat in snapshot_a:
        for cmd in cat.get("commands", []):
            map_a[f"{cat.get('name')}::{cmd.get('name')}"] = cmd

    for cat in snapshot_b:
        for cmd in cat.get("commands", []):
            map_b[f"{cat.get('name')}::{cmd.get('name')}"] = cmd

    added = 0
    removed = 0
    modified = 0

    for key, cmd_b in map_b.items():
        if key not in map_a:
            added += 1
        else:
            cmd_a = map_a[key]
            if cmd_a.get("command") != cmd_b.get("command") or canonical_json(cmd_a) != canonical_json(cmd_b):
                modified += 1

    for key in map_a:
        if key not in map_b:
            removed += 1

    return {"addedCommands": added, "removedCommands": removed, "modifiedCommands": modified}


def rollback_to_revision(config: dict, revision_id: int, user_role: str = "admin") -> dict:
    """
    Restores configuration to a previous revision.
    :visibility: public
    """
    check_permission(user_role, "ROLLBACK_VERSION")

    updated_config = json.loads(json.dumps(config or {}))
    history = get_revision_history(updated_config)
    target_rev = next((r for r in history if r.get("revision") == int(revision_id)), None)

    if not target_rev:
        raise ValueError(f"Revision #{revision_id} not found in history.")

    updated_config["categories"] = json.loads(json.dumps(target_rev["categories"]))

    return create_config_revision(
        updated_config,
        author="admin",
        message=f"Rollback to revision #{revision_id} ({target_rev['commitHash'][:7]})",
    )


def create_proposal(
    config: dict,
    repo_id: str,
    command_data: dict,
    author: str = "editor",
    description: str = "",
    user_role: str = "editor",
) -> dict:
    """
    Submits a new command proposal for a team repository.
    :visibility: public
    """
    check_permission(user_role, "PROPOSE_CHANGE")

    updated_config = json.loads(json.dumps(config or {}))
    if "approvalWorkflows" not in updated_config:
        updated_config["approvalWorkflows"] = {"proposals": []}
    if not isinstance(updated_config["approvalWorkflows"].get("proposals"), list):
        updated_config["approvalWorkflows"]["proposals"] = []

    proposal_id = f"prop-{int(time.time() * 1000)}-{random.randint(100, 999)}"
    proposal = {
        "id": proposal_id,
        "repoId": repo_id,
        "commandData": command_data,
        "author": author,
        "description": description,
        "status": "pending",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "reviews": [],
    }

    updated_config["approvalWorkflows"]["proposals"].append(proposal)

    log_activity(
        updated_config,
        actor=author,
        actor_role=user_role,
        action="CREATE_PROPOSAL",
        target=command_data.get("name", "Command Proposal"),
        details=f"Submitted proposal '{proposal_id}': {description}",
        repo_id=repo_id,
    )

    return {"config": updated_config, "proposal": proposal}


def review_proposal(
    config: dict,
    proposal_id: str,
    status: str,
    reviewer: str = "approver",
    comment: str = "",
    reviewer_role: str = "approver",
) -> dict:
    """
    Reviews (approves or rejects) a pending proposal.
    :visibility: public
    """
    check_permission(reviewer_role, "REVIEW_PROPOSAL")

    if status not in ("approved", "rejected"):
        raise ValueError("Review status must be either 'approved' or 'rejected'.")

    updated_config = json.loads(json.dumps(config or {}))
    proposals = updated_config.get("approvalWorkflows", {}).get("proposals", [])
    proposal = next((p for p in proposals if p.get("id") == proposal_id), None)

    if not proposal:
        raise ValueError(f"Proposal '{proposal_id}' not found.")

    proposal["status"] = status
    proposal["updatedAt"] = datetime.now(timezone.utc).isoformat()
    proposal["reviews"].append(
        {
            "reviewer": reviewer,
            "role": reviewer_role,
            "status": status,
            "comment": comment,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )

    log_activity(
        updated_config,
        actor=reviewer,
        actor_role=reviewer_role,
        action="APPROVE_PROPOSAL" if status == "approved" else "REJECT_PROPOSAL",
        target=proposal_id,
        details=f"{status.upper()} proposal '{proposal_id}': {comment}",
        repo_id=proposal.get("repoId"),
    )

    return {"config": updated_config, "proposal": proposal}


def merge_proposal(config: dict, proposal_id: str, user_role: str = "approver") -> dict:
    """
    Merges an approved proposal into active team commands.
    :visibility: public
    """
    check_permission(user_role, "APPROVE_PROPOSAL")

    updated_config = json.loads(json.dumps(config or {}))
    proposals = updated_config.get("approvalWorkflows", {}).get("proposals", [])
    proposal = next((p for p in proposals if p.get("id") == proposal_id), None)

    if not proposal:
        raise ValueError(f"Proposal '{proposal_id}' not found.")

    if proposal.get("status") != "approved":
        raise ValueError(f"Proposal '{proposal_id}' must be approved before merging (status: '{proposal.get('status')}').")

    repo = next((r for r in list_team_repositories(updated_config) if r.get("id") == proposal.get("repoId")), None)
    team_cat_name = f"Team: {repo.get('name')}" if repo else "Team Shared Commands"

    if "categories" not in updated_config or not isinstance(updated_config["categories"], list):
        updated_config["categories"] = []

    cat = next((c for c in updated_config["categories"] if c.get("name") == team_cat_name), None)
    if not cat:
        cat = {"name": team_cat_name, "commands": []}
        updated_config["categories"].append(cat)

    cmd_copy = dict(proposal.get("commandData", {}))
    cmd_copy["teamRepoId"] = proposal.get("repoId")
    cat["commands"].append(cmd_copy)

    proposal["status"] = "merged"
    proposal["updatedAt"] = datetime.now(timezone.utc).isoformat()

    log_activity(
        updated_config,
        actor="System",
        actor_role=user_role,
        action="MERGE_PROPOSAL",
        target=proposal_id,
        details=f"Merged proposal '{proposal_id}' into category '{team_cat_name}'",
        repo_id=proposal.get("repoId"),
    )

    return create_config_revision(
        updated_config,
        author=proposal.get("author", "user"),
        message=f"Merged team proposal: {proposal.get('commandData', {}).get('name', proposal_id)}",
    )


def list_proposals(config: dict, filters: dict = None) -> list:
    """
    Returns list of proposals filtered by status, repo, or author.
    :visibility: public
    """
    filters = filters or {}
    proposals = config.get("approvalWorkflows", {}).get("proposals", []) if config else []
    result = []
    for p in proposals:
        if filters.get("status") and p.get("status") != filters.get("status"):
            continue
        if filters.get("repoId") and p.get("repoId") != filters.get("repoId"):
            continue
        if filters.get("author") and p.get("author") != filters.get("author"):
            continue
        result.append(p)
    return result


def get_proposal_by_id(config: dict, proposal_id: str) -> dict:
    """
    Returns proposal dict by ID or None.
    :visibility: public
    """
    proposals = list_proposals(config)
    return next((p for p in proposals if p.get("id") == proposal_id), None)


def log_activity(
    config: dict,
    actor: str = "system",
    actor_role: str = "viewer",
    action: str = "",
    target: str = "",
    details: str = "",
    repo_id: str = None,
) -> dict:
    """
    Appends an event entry to the activity feed log.
    :visibility: public
    """
    if config is None:
        return None

    if "activityFeed" not in config or not isinstance(config["activityFeed"], list):
        config["activityFeed"] = []

    entry = {
        "id": f"act-{int(time.time() * 1000)}-{random.randint(100, 999)}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "actor": actor,
        "actorRole": actor_role,
        "action": action,
        "target": target,
        "details": details,
        "repoId": repo_id,
    }

    config["activityFeed"].insert(0, entry)

    if len(config["activityFeed"]) > 1000:
        config["activityFeed"] = config["activityFeed"][:1000]

    return entry


def get_activity_feed(config: dict, filters: dict = None) -> dict:
    """
    Returns filtered and paginated activity feed log.
    :visibility: public
    """
    filters = filters or {}
    feed = config.get("activityFeed", []) if config else []

    filtered = []
    for entry in feed:
        if filters.get("repoId") and entry.get("repoId") != filters.get("repoId"):
            continue
        if filters.get("actor") and entry.get("actor") != filters.get("actor"):
            continue
        if filters.get("action") and entry.get("action") != filters.get("action"):
            continue
        filtered.append(entry)

    offset = int(filters.get("offset", 0))
    limit = int(filters.get("limit", 100))
    items = filtered[offset : offset + limit]

    return {"items": items, "total": len(filtered)}


def clear_activity_feed(config: dict, user_role: str = "admin") -> dict:
    """
    Clears activity log entries.
    :visibility: public
    """
    check_permission(user_role, "MANAGE_REPOS")

    updated_config = json.loads(json.dumps(config or {}))
    updated_config["activityFeed"] = []
    return updated_config
