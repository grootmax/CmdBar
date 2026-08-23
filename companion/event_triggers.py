#!/usr/bin/env python3
"""
CmdBar Event-Based Triggers Module
Handles file watchers, git hooks, webhooks/HTTP requests, system events,
and conditional evaluation for automated command triggering.
"""

import os
import sys
import re
import time
import json
import threading
import subprocess
import hmac
import hashlib
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse


def resolve_field_value(field_path: str, context: dict):
    """
    Resolves nested dictionary fields using dot notation (e.g. 'payload.branch').
    """
    if not field_path or not context:
        return None

    parts = field_path.split(".")
    curr = context
    for part in parts:
        if isinstance(curr, dict) and part in curr:
            curr = curr[part]
        elif isinstance(curr, (list, tuple)) and part.isdigit():
            idx = int(part)
            if 0 <= idx < len(curr):
                curr = curr[idx]
            else:
                return None
        else:
            return None
    return curr


def interpolate_parameters(template: str, context: dict) -> str:
    """
    Interpolates context values into command template placeholders like {key}, <key>, or {{key}}.
    Supports dot-notation keys (e.g. {payload.branch}).
    """
    if not template or not isinstance(template, str):
        return ""

    def replace_placeholder(match):
        raw_key = match.group(1) or match.group(2) or match.group(3)
        if not raw_key:
            return match.group(0)
        val = resolve_field_value(raw_key.strip(), context)
        if val is None:
            # Fallback check top level or string representation
            val = context.get(raw_key.strip(), "")
        if isinstance(val, (dict, list)):
            return json.dumps(val)
        return str(val)

    # Pattern matches {{key}}, <key>, or {key}
    pattern = r"\{\{([^}]+)\}\}|<([^>]+)>|\{([^}]+)\}"
    return re.sub(pattern, replace_placeholder, template)


class ConditionEvaluator:
    """
    Evaluates conditional logic rules against an event context.
    Supports equality, string/list containment, regex, comparisons, and nested boolean logic (all/any/not).
    """

    @staticmethod
    def evaluate_rule(rule: dict, context: dict) -> bool:
        if not rule or not isinstance(rule, dict):
            return True

        # Handle boolean combinators: 'all' (AND), 'any' (OR), 'not' (NOT)
        if "all" in rule and isinstance(rule["all"], list):
            return all(ConditionEvaluator.evaluate_rule(sub_rule, context) for sub_rule in rule["all"])

        if "any" in rule and isinstance(rule["any"], list):
            return any(ConditionEvaluator.evaluate_rule(sub_rule, context) for sub_rule in rule["any"])

        if "not" in rule:
            return not ConditionEvaluator.evaluate_rule(rule["not"], context)

        field = rule.get("field")
        if not field:
            return True

        op = str(rule.get("operator", "equals")).lower()
        target = rule.get("value")
        actual = resolve_field_value(field, context)

        if op in ("equals", "eq", "=="):
            return str(actual) == str(target) if target is not None else actual is None

        elif op in ("not_equals", "neq", "!="):
            return str(actual) != str(target) if target is not None else actual is not None

        elif op in ("contains", "includes"):
            if actual is None:
                return False
            if isinstance(actual, (list, tuple, set)):
                return target in actual or str(target) in [str(x) for x in actual]
            return str(target) in str(actual)

        elif op in ("not_contains", "not_includes"):
            if actual is None:
                return True
            if isinstance(actual, (list, tuple, set)):
                return target not in actual and str(target) not in [str(x) for x in actual]
            return str(target) not in str(actual)

        elif op in ("matches_regex", "regex"):
            if actual is None or target is None:
                return False
            try:
                return bool(re.search(str(target), str(actual)))
            except Exception:
                return False

        elif op in ("greater_than", "gt", ">"):
            try:
                return float(actual) > float(target)
            except (ValueError, TypeError):
                return False

        elif op in ("less_than", "lt", "<"):
            try:
                return float(actual) < float(target)
            except (ValueError, TypeError):
                return False

        elif op in ("greater_equal", "gte", ">="):
            try:
                return float(actual) >= float(target)
            except (ValueError, TypeError):
                return False

        elif op in ("less_equal", "lte", "<="):
            try:
                return float(actual) <= float(target)
            except (ValueError, TypeError):
                return False

        elif op in ("in",):
            if actual is None or target is None:
                return False
            if isinstance(target, (list, tuple, set)):
                return actual in target or str(actual) in [str(x) for x in target]
            return str(actual) in str(target)

        elif op in ("not_in",):
            if actual is None or target is None:
                return True
            if isinstance(target, (list, tuple, set)):
                return actual not in target and str(actual) not in [str(x) for x in target]
            return str(actual) not in str(target)

        elif op in ("is_empty",):
            if actual is None:
                return True
            if isinstance(actual, (list, tuple, dict, set, str)):
                return len(actual) == 0
            return False

        elif op in ("is_not_empty",):
            if actual is None:
                return False
            if isinstance(actual, (list, tuple, dict, set, str)):
                return len(actual) > 0
            return True

        return False


class FileWatcher:
    """
    Monitors files or directories for modification, creation, or deletion with debouncing.
    """

    def __init__(self, path: str, callback, events=None, recursive=False, debounce_ms=100):
        self.path = os.path.abspath(path)
        self.callback = callback
        self.events = events or ["create", "modify", "delete"]
        self.recursive = recursive
        self.debounce_ms = debounce_ms
        self._running = False
        self._thread = None
        self._lock = threading.Lock()
        self._last_state = {}
        self._debounce_timers = {}

    def _get_snapshot(self):
        snapshot = {}
        if not os.path.exists(self.path):
            return snapshot

        if os.path.isfile(self.path):
            try:
                st = os.stat(self.path)
                snapshot[self.path] = st.st_mtime
            except Exception:
                pass
            return snapshot

        for root, dirs, files in os.walk(self.path):
            for f in files:
                full_path = os.path.join(root, f)
                try:
                    st = os.stat(full_path)
                    snapshot[full_path] = st.st_mtime
                except Exception:
                    pass
            if not self.recursive:
                break
        return snapshot

    def start(self):
        if self._running:
            return
        self._running = True
        self._last_state = self._get_snapshot()
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.0)

    def _trigger_debounced(self, event_type, file_path):
        key = f"{event_type}:{file_path}"

        def emit():
            file_name = os.path.basename(file_path)
            _, ext = os.path.splitext(file_name)
            file_ext = ext.lstrip(".")
            context = {
                "event_type": "file_change",
                "action": event_type,
                "file_path": file_path,
                "file_name": file_name,
                "file_ext": file_ext,
                "path": file_path,
                "timestamp": time.time(),
            }
            try:
                self.callback(context)
            except Exception as e:
                sys.stderr.write(f"FileWatcher callback error: {e}\n")

        with self._lock:
            if key in self._debounce_timers:
                self._debounce_timers[key].cancel()
            t = threading.Timer(self.debounce_ms / 1000.0, emit)
            self._debounce_timers[key] = t
            t.start()

    def _poll_loop(self):
        while self._running:
            time.sleep(0.05)
            curr_state = self._get_snapshot()

            # Detect modifications and creations
            for file_path, mtime in curr_state.items():
                if file_path not in self._last_state:
                    if "create" in self.events or "*" in self.events:
                        self._trigger_debounced("create", file_path)
                elif self._last_state[file_path] != mtime:
                    if "modify" in self.events or "*" in self.events:
                        self._trigger_debounced("modify", file_path)

            # Detect deletions
            for file_path in self._last_state:
                if file_path not in curr_state:
                    if "delete" in self.events or "*" in self.events:
                        self._trigger_debounced("delete", file_path)

            self._last_state = curr_state


class GitHookHandler:
    """
    Manages Git hook scripts and hook event dispatches.
    """

    SUPPORTED_HOOKS = ["pre-commit", "post-commit", "pre-push", "post-merge", "post-checkout"]

    @staticmethod
    def get_hooks_dir(repo_path: str) -> str:
        git_dir = os.path.join(os.path.abspath(repo_path), ".git")
        if os.path.isfile(git_dir):  # Worktree or submodule file
            with open(git_dir, "r") as f:
                content = f.read().strip()
                if content.startswith("gitdir:"):
                    git_dir = content.replace("gitdir:", "").strip()
        return os.path.join(git_dir, "hooks")

    @classmethod
    def install_git_hook(cls, repo_path: str, hook_type: str, trigger_id: str = "cmdbar") -> bool:
        if hook_type not in cls.SUPPORTED_HOOKS:
            return False

        hooks_dir = cls.get_hooks_dir(repo_path)
        try:
            os.makedirs(hooks_dir, exist_ok=True)
            hook_file = os.path.join(hooks_dir, hook_type)

            script_content = (
                "#!/bin/sh\n"
                f"# CmdBar Git Hook Trigger [{trigger_id}]\n"
                f"python3 -c \"from companion.event_triggers import GitHookHandler; "
                f"GitHookHandler.fire_from_cli('{os.path.abspath(repo_path)}', '{hook_type}')\" \"$@\"\n"
            )

            with open(hook_file, "w") as f:
                f.write(script_content)

            os.chmod(hook_file, 0o755)
            return True
        except Exception as e:
            sys.stderr.write(f"Failed to install git hook: {e}\n")
            return False

    @classmethod
    def uninstall_git_hook(cls, repo_path: str, hook_type: str) -> bool:
        hooks_dir = cls.get_hooks_dir(repo_path)
        hook_file = os.path.join(hooks_dir, hook_type)
        if os.path.exists(hook_file):
            try:
                os.remove(hook_file)
                return True
            except Exception:
                return False
        return False

    @classmethod
    def build_event_context(cls, repo_path: str, hook_type: str, args=None) -> dict:
        repo_path = os.path.abspath(repo_path)
        branch = "unknown"
        commit = "unknown"

        try:
            res_branch = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                cwd=repo_path, capture_output=True, text=True, timeout=2
            )
            if res_branch.returncode == 0:
                branch = res_branch.stdout.strip()

            res_commit = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=repo_path, capture_output=True, text=True, timeout=2
            )
            if res_commit.returncode == 0:
                commit = res_commit.stdout.strip()
        except Exception:
            pass

        return {
            "event_type": "git_hook",
            "hook_type": hook_type,
            "repo_path": repo_path,
            "branch": branch,
            "commit": commit,
            "payload": {
                "branch": branch,
                "commit": commit,
                "hook_type": hook_type,
                "args": args or []
            },
            "timestamp": time.time()
        }

    @classmethod
    def fire_from_cli(cls, repo_path: str, hook_type: str):
        ctx = cls.build_event_context(repo_path, hook_type, sys.argv[1:])
        from companion.dbus_client import CmdBarDBusClient
        client = CmdBarDBusClient()
        client._call_method("FireEvent", "git_hook", json.dumps(ctx))


class WebhookHTTPHandler(BaseHTTPRequestHandler):
    """
    HTTP Request Handler for processing incoming webhooks.
    """

    server_engine = None  # Injected by WebhookServer

    def log_message(self, format, *args):
        pass  # Suppress default HTTP logging to stdout/stderr

    def _verify_secret(self, secret: str, body: bytes) -> bool:
        if not secret:
            return True
        auth_header = self.headers.get("Authorization", "")
        if auth_header.startswith("Bearer ") and auth_header[7:].strip() == secret:
            return True
        token_header = self.headers.get("X-Secret-Token", "")
        if token_header == secret:
            return True
        sig_header = self.headers.get("X-Hub-Signature-256", "")
        if sig_header.startswith("sha256="):
            sig = sig_header[7:]
            computed = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
            return hmac.compare_digest(sig, computed)
        return False

    def do_GET(self):
        self._handle_request("GET")

    def do_POST(self):
        self._handle_request("POST")

    def do_PUT(self):
        self._handle_request("PUT")

    def _handle_request(self, method: str):
        parsed_url = urlparse(self.path)
        content_length = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(content_length) if content_length > 0 else b""

        secret = getattr(self.server, "secret", None)
        if secret and not self._verify_secret(secret, body_bytes):
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Unauthorized"}).encode("utf-8"))
            return

        payload = {}
        if body_bytes:
            try:
                payload = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                payload = {"raw_body": body_bytes.decode("utf-8", errors="ignore")}

        query_params = {k: v[0] if len(v) == 1 else v for k, v in parse_qs(parsed_url.query).items()}
        headers_dict = {k.lower(): v for k, v in self.headers.items()}

        context = {
            "event_type": "webhook",
            "endpoint": parsed_url.path,
            "method": method,
            "payload": payload,
            "query": query_params,
            "headers": headers_dict,
            "timestamp": time.time()
        }

        engine = getattr(self.server, "engine", None)
        results = []
        if engine:
            results = engine.fire_event("webhook", context)

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"status": "ok", "executed_count": len(results)}).encode("utf-8"))


class WebhookServer:
    """
    Lightweight HTTP Webhook server listener.
    """

    def __init__(self, port=8080, endpoint="/webhook", secret=None, engine=None):
        self.port = port
        self.endpoint = endpoint
        self.secret = secret
        self.engine = engine
        self._httpd = None
        self._thread = None

    def start(self):
        if self._httpd:
            return
        handler_cls = WebhookHTTPHandler
        class ReusableHTTPServer(HTTPServer):
            allow_reuse_address = True

        self._httpd = ReusableHTTPServer(("0.0.0.0", self.port), handler_cls)
        self._httpd.secret = self.secret
        self._httpd.engine = self.engine
        self._httpd.endpoint = self.endpoint
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()

    def stop(self):
        if self._httpd:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None


class SystemEventListener:
    """
    Manages system-level events such as startup, idle state, power state, or D-Bus signals.
    """

    def __init__(self, engine=None):
        self.engine = engine

    def emit_event(self, event_name: str, payload: dict = None) -> list:
        context = {
            "event_type": "system_event",
            "event_name": event_name,
            "payload": payload or {},
            "timestamp": time.time()
        }
        if self.engine:
            return self.engine.fire_event("system_event", context)
        return []


class EventTriggerEngine:
    """
    Core engine managing event triggers, condition evaluations, and action executions.
    """

    def __init__(self, action_executor=None):
        self.triggers = {}
        self.action_executor = action_executor or self._default_executor
        self.file_watchers = {}
        self.webhook_servers = {}
        self.system_listener = SystemEventListener(self)

    def _default_executor(self, command: str, context: dict):
        cmd_str = interpolate_parameters(command, context)
        try:
            res = subprocess.run(cmd_str, shell=True, capture_output=True, text=True, timeout=10)
            return {
                "exit_code": res.returncode,
                "stdout": res.stdout,
                "stderr": res.stderr,
                "success": res.returncode == 0
            }
        except Exception as e:
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": str(e),
                "success": False
            }

    def register_trigger(self, trigger: dict) -> bool:
        if not trigger or not isinstance(trigger, dict):
            return False
        t_id = str(trigger.get("id", "")).strip()
        if not t_id:
            t_id = f"trig_{len(self.triggers) + 1}_{int(time.time()*1000)}"
            trigger["id"] = t_id

        trigger.setdefault("enabled", True)
        trigger.setdefault("name", t_id)
        trigger.setdefault("type", "file_change")
        trigger.setdefault("config", {})

        self.triggers[t_id] = trigger
        self._setup_trigger_services(trigger)
        return True

    def unregister_trigger(self, trigger_id: str) -> bool:
        t_id = str(trigger_id).strip()
        if t_id in self.triggers:
            self._cleanup_trigger_services(t_id)
            del self.triggers[t_id]
            return True
        return False

    def get_triggers(self) -> list:
        return list(self.triggers.values())

    def get_trigger(self, trigger_id: str) -> dict:
        return self.triggers.get(str(trigger_id).strip())

    def enable_trigger(self, trigger_id: str) -> bool:
        t = self.get_trigger(trigger_id)
        if t:
            t["enabled"] = True
            return True
        return False

    def disable_trigger(self, trigger_id: str) -> bool:
        t = self.get_trigger(trigger_id)
        if t:
            t["enabled"] = False
            return True
        return False

    def _setup_trigger_services(self, trigger: dict):
        t_id = trigger["id"]
        t_type = trigger["type"]
        cfg = trigger.get("config", {})

        if t_type in ("file_change", "file_watch"):
            path = cfg.get("path")
            if path:
                watcher = FileWatcher(
                    path=path,
                    callback=lambda ctx: self.fire_event(t_type, ctx),
                    events=cfg.get("events", ["create", "modify", "delete"]),
                    recursive=cfg.get("recursive", False),
                    debounce_ms=cfg.get("debounce_ms", cfg.get("debounceMs", 100))
                )
                watcher.start()
                self.file_watchers[t_id] = watcher

        elif t_type in ("webhook", "http_request"):
            port = cfg.get("port", 8080)
            if port not in self.webhook_servers:
                server = WebhookServer(
                    port=port,
                    endpoint=cfg.get("endpoint", "/webhook"),
                    secret=cfg.get("secret"),
                    engine=self
                )
                server.start()
                self.webhook_servers[port] = server

    def _cleanup_trigger_services(self, trigger_id: str):
        if trigger_id in self.file_watchers:
            self.file_watchers[trigger_id].stop()
            del self.file_watchers[trigger_id]

    def stop_all_services(self):
        for watcher in self.file_watchers.values():
            watcher.stop()
        self.file_watchers.clear()

        for server in self.webhook_servers.values():
            server.stop()
        self.webhook_servers.clear()

    def fire_event(self, event_type: str, context: dict) -> list:
        results = []
        if not context:
            context = {}

        for t_id, trigger in list(self.triggers.items()):
            if not trigger.get("enabled", True):
                continue

            target_type = trigger.get("type")
            if target_type != event_type and target_type != "*":
                # Check system event sub-type matching
                if event_type == "system_event" and target_type == trigger.get("config", {}).get("event_name"):
                    pass
                else:
                    continue

            # Evaluate conditional logic
            condition = trigger.get("condition") or trigger.get("conditionalLogic")
            if condition and not ConditionEvaluator.evaluate_rule(condition, context):
                continue

            # Resolve action
            action = trigger.get("action")
            action_cmd = ""
            if isinstance(action, str):
                action_cmd = action
            elif isinstance(action, dict):
                action_cmd = action.get("command") or action.get("template", "")

            if not action_cmd:
                continue

            interpolated_cmd = interpolate_parameters(action_cmd, context)

            # Execute action
            res = self.action_executor(interpolated_cmd, context)
            results.append({
                "trigger_id": t_id,
                "trigger_name": trigger.get("name", t_id),
                "action_command": interpolated_cmd,
                "context": context,
                "result": res
            })

        return results
