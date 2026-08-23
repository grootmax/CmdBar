#!/usr/bin/env python3
"""
CmdBar CI/CD Integration Pipeline Companion Module
Provides Python-based unified status monitoring, deployment triggering, rollback execution,
and secret masking across GitHub Actions, GitLab CI, and Jenkins.
"""

import os
import json
import re
import urllib.request
import urllib.parse
import urllib.error

PROVIDER_ENV_MAP = {
    "github": {
        "token_env": "GITHUB_TOKEN",
        "repo_env": "GITHUB_REPOSITORY",
        "base_url": "https://api.github.com",
    },
    "gitlab": {
        "token_env": "GITLAB_TOKEN",
        "project_env": "GITLAB_PROJECT_ID",
        "base_url": "https://gitlab.com/api/v4",
    },
    "jenkins": {
        "token_env": "JENKINS_API_TOKEN",
        "user_env": "JENKINS_USER",
        "url_env": "JENKINS_URL",
        "base_url": "http://localhost:8080",
    },
}


def normalize_config(provider, options=None):
    """
    Normalizes CI/CD configuration options by merging user parameters with environment variable defaults.
    :visibility: public
    """
    options = options or {}
    norm_provider = str(provider or "github").lower().strip()
    mapping = PROVIDER_ENV_MAP.get(norm_provider, PROVIDER_ENV_MAP["github"])

    token = options.get("token") or os.environ.get(mapping.get("token_env", "")) or ""
    base_url = (
        options.get("base_url")
        or options.get("url")
        or os.environ.get(mapping.get("url_env", ""), "")
        or mapping["base_url"]
    ).rstrip("/")
    repo = options.get("repo") or os.environ.get(mapping.get("repo_env", ""), "") or ""
    project_id = options.get("project_id") or options.get("project") or os.environ.get(mapping.get("project_env", ""), "") or repo
    job = options.get("job") or options.get("job_name") or options.get("workflow") or ""
    branch = options.get("branch") or options.get("ref") or "main"
    user = options.get("user") or options.get("username") or os.environ.get(mapping.get("user_env", ""), "") or ""

    return {
        "provider": norm_provider,
        "token": token,
        "base_url": base_url,
        "repo": repo,
        "project_id": project_id,
        "job": job,
        "branch": branch,
        "user": user,
    }


def mask_secrets(text, additional_secrets=None):
    """
    Masks sensitive tokens, credentials, and API keys in strings or logs.
    :visibility: public
    """
    if text is None:
        return ""
    result = str(text)

    patterns = [
        r"ghp_[a-zA-Z0-9]{36,}",
        r"glpat-[a-zA-Z0-9_-]{20,}",
        r"Bearer\s+[a-zA-Z0-9._-]+",
        r"token\s+[a-zA-Z0-9._-]+",
        r"Basic\s+[a-zA-Z0-9+/=]+",
    ]

    for pattern in patterns:
        result = re.sub(pattern, "[REDACTED]", result, flags=re.IGNORECASE)

    secrets = list(additional_secrets) if additional_secrets else []
    for secret in secrets:
        if secret and isinstance(secret, str) and len(secret.strip()) > 2:
            result = result.replace(secret.strip(), "[REDACTED]")

    env_keys = ["GITHUB_TOKEN", "GITLAB_TOKEN", "JENKINS_API_TOKEN", "AWS_SECRET_ACCESS_KEY"]
    for key in env_keys:
        val = os.environ.get(key)
        if val and len(val.strip()) > 2:
            result = result.replace(val.strip(), "[REDACTED]")

    return result


def parse_pipeline_status(provider, raw_data):
    """
    Parses raw CI/CD API responses into a standardized dictionary format.
    :visibility: public
    """
    norm_provider = str(provider or "github").lower().strip()
    raw = raw_data or {}

    pipeline_id = "N/A"
    status = "unknown"
    outcome = "unknown"
    branch = "unknown"
    commit = "unknown"
    author = "unknown"
    url = ""
    duration = "0s"
    stages = []

    if norm_provider == "github":
        runs = raw.get("workflow_runs") if isinstance(raw, dict) and "workflow_runs" in raw else [raw]
        run = runs[0] if isinstance(runs, list) and runs else {}
        pipeline_id = str(run.get("id", "N/A"))
        branch = run.get("head_branch") or "main"
        commit = (run.get("head_sha") or "unknown")[:7]
        author = (
            (run.get("head_commit") or {}).get("author", {}).get("name")
            or (run.get("actor") or {}).get("login")
            or "unknown"
        )
        url = run.get("html_url", "")

        raw_status = str(run.get("status") or "").lower()
        raw_conclusion = str(run.get("conclusion") or "").lower()

        if raw_status == "completed":
            if raw_conclusion == "success":
                status = "success"
                outcome = "success"
            elif raw_conclusion in ["failure", "timed_out", "action_required"]:
                status = "failed"
                outcome = raw_conclusion
            elif raw_conclusion in ["cancelled", "skipped"]:
                status = "cancelled"
                outcome = raw_conclusion
            else:
                status = raw_conclusion or "completed"
                outcome = raw_conclusion
        elif raw_status in ["in_progress", "queued", "requested", "waiting"]:
            status = "running" if raw_status == "in_progress" else "queued"
            outcome = "pending"

    elif norm_provider == "gitlab":
        pipes = raw if isinstance(raw, list) else [raw]
        pipe = pipes[0] if isinstance(pipes, list) and pipes else {}
        pipeline_id = str(pipe.get("id", "N/A"))
        branch = pipe.get("ref") or "main"
        commit = (pipe.get("sha") or "unknown")[:7]
        author = (pipe.get("user") or {}).get("name", "unknown")
        url = pipe.get("web_url", "")

        raw_status = str(pipe.get("status") or "").lower()
        if raw_status in ["success", "passed"]:
            status = "success"
            outcome = "success"
        elif raw_status == "failed":
            status = "failed"
            outcome = "failed"
        elif raw_status in ["canceled", "skipped"]:
            status = "cancelled"
            outcome = raw_status
        elif raw_status in ["running", "pending", "created", "waiting_for_resource"]:
            status = "running" if raw_status == "running" else "queued"
            outcome = "pending"

        if pipe.get("duration"):
            duration = f"{pipe['duration']}s"

    elif norm_provider == "jenkins":
        pipeline_id = str(raw.get("number") or raw.get("id") or "N/A")
        branch = "main"
        url = raw.get("url", "")

        actions = raw.get("actions", [])
        if isinstance(actions, list):
            for act in actions:
                if isinstance(act, dict):
                    rev = act.get("lastBuiltRevision", {})
                    if rev.get("SHA1"):
                        commit = rev["SHA1"][:7]
                    branches = rev.get("branch", [])
                    if branches and isinstance(branches, list) and isinstance(branches[0], dict):
                        branch = branches[0].get("name", branch)
                    causes = act.get("causes", [])
                    if causes and isinstance(causes, list) and isinstance(causes[0], dict):
                        author = causes[0].get("userName", author)

        if raw.get("building"):
            status = "running"
            outcome = "pending"
        else:
            res = str(raw.get("result") or "").upper()
            if res == "SUCCESS":
                status = "success"
                outcome = "success"
            elif res in ["FAILURE", "UNSTABLE"]:
                status = "failed"
                outcome = res.lower()
            elif res == "ABORTED":
                status = "cancelled"
                outcome = "aborted"

        if raw.get("duration"):
            duration = f"{round(raw['duration'] / 1000)}s"

    return {
        "provider": norm_provider,
        "id": pipeline_id,
        "status": status,
        "outcome": outcome,
        "branch": branch,
        "commit": commit,
        "author": author,
        "url": url,
        "duration": duration,
        "stages": stages,
    }


def format_pipeline_status_output(status_obj):
    """
    Formats a pipeline status object into a human-readable display string.
    :visibility: public
    """
    if not status_obj or not isinstance(status_obj, dict):
        return "No pipeline status available."

    icon_map = {
        "success": "✅ SUCCESS",
        "failed": "❌ FAILED",
        "running": "🔄 RUNNING",
        "queued": "⏳ QUEUED",
        "cancelled": "🚫 CANCELLED",
        "unknown": "❓ UNKNOWN",
    }

    status_tag = icon_map.get(status_obj.get("status"), f"[{str(status_obj.get('status')).upper()}]")
    provider_tag = str(status_obj.get("provider") or "ci").upper()

    output = f"[{provider_tag}] Pipeline #{status_obj.get('id', 'N/A')}: {status_tag}\n"
    output += f"• Branch: {status_obj.get('branch')} ({status_obj.get('commit')})\n"
    output += f"• Author: {status_obj.get('author')}\n"
    output += f"• Duration: {status_obj.get('duration')}\n"

    if status_obj.get("url"):
        output += f"• URL: {mask_secrets(status_obj['url'])}"

    return output.strip()


def get_trigger_command(provider, options=None):
    """
    Generates a shell command string to trigger a deployment pipeline.
    :visibility: public
    """
    options = options or {}
    cfg = normalize_config(provider, options)
    ref = cfg["branch"]
    env = options.get("environment", "production")
    inputs = options.get("inputs", {})

    if cfg["provider"] == "github":
        payload = json.dumps({"ref": ref, "inputs": {"environment": env, **inputs}})
        workflow = cfg["job"] or "deploy.yml"
        cmd = (
            f'curl -s -X POST -H "Authorization: Bearer {cfg["token"] or "$GITHUB_TOKEN"}" '
            f'-H "Accept: application/vnd.github.v3+json" '
            f'"{cfg["base_url"]}/repos/{cfg["repo"]}/actions/workflows/{workflow}/dispatches" '
            f"-d '{payload}'"
        )
        return mask_secrets(cmd, [cfg["token"]])

    elif cfg["provider"] == "gitlab":
        payload = json.dumps({
            "ref": ref,
            "variables": [
                {"key": "ENVIRONMENT", "value": env},
                *[{"key": k, "value": str(v)} for k, v in inputs.items()]
            ]
        })
        cmd = (
            f'curl -s -X POST -H "PRIVATE-TOKEN: {cfg["token"] or "$GITLAB_TOKEN"}" '
            f'-H "Content-Type: application/json" '
            f'"{cfg["base_url"]}/projects/{urllib.parse.quote_plus(cfg["project_id"])}/pipeline" '
            f"-d '{payload}'"
        )
        return mask_secrets(cmd, [cfg["token"]])

    elif cfg["provider"] == "jenkins":
        job = cfg["job"] or "build-job"
        auth = f'-u "{cfg["user"]}:{cfg["token"]}" ' if cfg["user"] and cfg["token"] else ""
        param_str = urllib.parse.urlencode({"ENVIRONMENT": env, **inputs})
        endpoint = f"buildWithParameters?{param_str}" if param_str else "build"
        cmd = f'curl -s -X POST {auth}"{cfg["base_url"]}/job/{urllib.parse.quote_plus(job)}/{endpoint}"'
        return mask_secrets(cmd, [cfg["token"]])

    return "echo 'Unsupported provider for trigger command'"


def get_rollback_command(provider, options=None):
    """
    Generates a shell command string to execute a deployment rollback.
    :visibility: public
    """
    options = options or {}
    target_version = options.get("targetVersion") or options.get("targetCommit") or "previous"
    rollback_opts = dict(options)
    rollback_opts["inputs"] = {
        "ACTION": "rollback",
        "TARGET_VERSION": target_version,
        **(options.get("inputs") or {}),
    }
    return get_trigger_command(provider, rollback_opts)
