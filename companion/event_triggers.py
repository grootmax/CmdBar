"""
Event-Based Triggers Engine for CmdBar (Python Companion Service)
Supports File Watchers, Git Hooks, Webhooks (HTTP Listeners), System Events, and Conditional Logic.
"""

import os
import re
import json
import time
import hmac
import hashlib
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

def get_nested_value(obj, path):
    """
    Gets a nested property value from a dictionary using dot notation.
    """
    if not obj or not isinstance(obj, dict) or not path or not isinstance(path, str):
        return None
    parts = path.split('.')
    current = obj
    for part in parts:
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def evaluate_condition(condition, context):
    """
    Evaluates a single condition dictionary against an event context.
    Supported operators: equals, not_equals, contains, not_contains, starts_with, ends_with,
    regex, gt, lt, gte, lte, in, not_in, exists, not_exists.
    :visibility: public
    """
    if not condition or not isinstance(condition, dict):
        return True

    if "conditions" in condition and isinstance(condition["conditions"], list):
        logical_op = condition.get("logical_operator", "and").lower()
        if logical_op == "or":
            return any(evaluate_condition(c, context) for c in condition["conditions"])
        return all(evaluate_condition(c, context) for c in condition["conditions"])

    field = condition.get("field")
    if not field:
        return True

    actual_value = get_nested_value(context, field)
    target_value = condition.get("value")
    operator = condition.get("operator", "equals").lower()

    if operator in ("equals", "==", "eq"):
        return str(actual_value) == str(target_value)

    elif operator in ("not_equals", "!=", "ne"):
        return str(actual_value) != str(target_value)

    elif operator in ("contains", "includes"):
        if isinstance(actual_value, list):
            return target_value in actual_value
        return str(target_value or "") in str(actual_value or "")

    elif operator == "not_contains":
        if isinstance(actual_value, list):
            return target_value not in actual_value
        return str(target_value or "") not in str(actual_value or "")

    elif operator == "starts_with":
        return str(actual_value or "").startswith(str(target_value or ""))

    elif operator == "ends_with":
        return str(actual_value or "").endswith(str(target_value or ""))

    elif operator in ("regex", "matches"):
        try:
            flags = re.IGNORECASE if condition.get("ignore_case", True) else 0
            return bool(re.search(str(target_value), str(actual_value or ""), flags))
        except Exception:
            return False

    elif operator in ("gt", "greater_than"):
        try:
            return float(actual_value) > float(target_value)
        except (ValueError, TypeError):
            return False

    elif operator in ("lt", "less_than"):
        try:
            return float(actual_value) < float(target_value)
        except (ValueError, TypeError):
            return False

    elif operator in ("gte", "greater_than_or_equal"):
        try:
            return float(actual_value) >= float(target_value)
        except (ValueError, TypeError):
            return False

    elif operator in ("lte", "less_than_or_equal"):
        try:
            return float(actual_value) <= float(target_value)
        except (ValueError, TypeError):
            return False

    elif operator == "in":
        if isinstance(target_value, list):
            return actual_value in target_value
        return str(actual_value or "") in str(target_value or "")

    elif operator == "not_in":
        if isinstance(target_value, list):
            return actual_value not in target_value
        return str(actual_value or "") not in str(target_value or "")

    elif operator == "exists":
        return actual_value is not None

    elif operator == "not_exists":
        return actual_value is None

    return str(actual_value) == str(target_value)


def evaluate_conditions(conditions, context, logical_operator="and"):
    """
    Evaluates a list of condition dictionaries against an event context.
    :visibility: public
    """
    if not conditions or not isinstance(conditions, list):
        return True
    op = (logical_operator or "and").lower()
    if op == "or":
        return any(evaluate_condition(c, context) for c in conditions)
    return all(evaluate_condition(c, context) for c in conditions)


def substitute_context(template, context):
    """
    Substitutes placeholders like {{field}} or <field> in string/dict template using context.
    :visibility: public
    """
    if not context or not isinstance(context, dict):
        return template

    if isinstance(template, dict):
        return {k: substitute_context(v, context) for k, v in template.items()}

    if isinstance(template, list):
        return [substitute_context(item, context) for item in template]

    if not isinstance(template, str):
        return template

    def replacer(match):
        key = (match.group(1) or match.group(2)).strip()
        val = get_nested_value(context, key)
        if val is None:
            return match.group(0)
        if isinstance(val, (dict, list)):
            return json.dumps(val)
        return str(val)

    pattern = r'\{\{([^}]+)\}\}|<([^>]+)>'
    return re.sub(pattern, replacer, template)


def compute_hmac_sha256(payload, secret):
    """
    Computes HMAC-SHA256 signature for payload using secret key.
    :visibility: public
    """
    if not secret:
        return ""
    if isinstance(payload, str):
        payload_bytes = payload.encode('utf-8')
    else:
        payload_bytes = payload
    secret_bytes = secret.encode('utf-8') if isinstance(secret, str) else secret
    return hmac.new(secret_bytes, payload_bytes, hashlib.sha256).hexdigest()


class FileWatcher:
    """
    Monitors file and directory events.
    """
    def __init__(self):
        self.watchers = {}

    def add_watch(self, trigger):
        if not trigger or "id" not in trigger:
            return False
        self.watchers[trigger["id"]] = trigger
        return True

    def remove_watch(self, trigger_id):
        return self.watchers.pop(trigger_id, None) is not None

    def process_file_event(self, file_path, event_type="modify"):
        matched = []
        file_name = os.path.basename(file_path) if file_path else ""
        dir_path = os.path.dirname(file_path) if file_path else ""

        context = {
            "event_type": "file_watcher",
            "file_path": file_path,
            "file_name": file_name,
            "dir_path": dir_path,
            "file_event": event_type,
            "timestamp": time.time()
        }

        for trigger_id, trigger in self.watchers.items():
            if not trigger.get("enabled", True):
                continue
            config = trigger.get("config", {})
            target_path = config.get("path")

            if target_path:
                is_exact = file_path == target_path
                is_prefix = config.get("recursive", True) and file_path.startswith(target_path if target_path.endswith("/") else target_path + "/")
                if not is_exact and not is_prefix:
                    continue

            allowed_events = config.get("events")
            if allowed_events and isinstance(allowed_events, list):
                if event_type not in allowed_events:
                    continue

            if evaluate_conditions(trigger.get("conditions"), context, trigger.get("logical_operator", "and")):
                matched.append({"trigger": trigger, "context": context})

        return matched


class GitHookManager:
    """
    Manages Git Hook triggers.
    """
    def __init__(self):
        self.hooks = {}

    def add_hook(self, trigger):
        if not trigger or "id" not in trigger:
            return False
        self.hooks[trigger["id"]] = trigger
        return True

    def remove_hook(self, trigger_id):
        return self.hooks.pop(trigger_id, None) is not None

    def process_git_event(self, hook_name, details=None):
        details = details or {}
        matched = []
        context = {
            "event_type": "git_hook",
            "git_hook": hook_name,
            "git_event": hook_name,
            "git_repo": details.get("repo_path", ""),
            "git_branch": details.get("branch", "main"),
            "git_commit": details.get("commit", ""),
            "git_ref": details.get("ref", ""),
            "args": details.get("args", []),
            "timestamp": time.time()
        }

        for trigger_id, trigger in self.hooks.items():
            if not trigger.get("enabled", True):
                continue
            config = trigger.get("config", {})

            if config.get("hook") and config.get("hook") != hook_name:
                continue
            if config.get("repo_path") and details.get("repo_path") and config.get("repo_path") != details.get("repo_path"):
                continue
            if config.get("branch") and details.get("branch") and config.get("branch") != details.get("branch"):
                continue

            if evaluate_conditions(trigger.get("conditions"), context, trigger.get("logical_operator", "and")):
                matched.append({"trigger": trigger, "context": context})

        return matched

    def generate_hook_script(self, hook_name, cli_command="cmdbar-cli"):
        """
        Generates shell script string for git hooks.
        :visibility: public
        """
        return f"""#!/bin/sh
# CmdBar Git Hook Trigger: {hook_name}
REPO_PATH="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
COMMIT="$(git rev-parse HEAD 2>/dev/null || echo '')"

{cli_command} trigger-git-event "{hook_name}" --repo "$REPO_PATH" --branch "$BRANCH" --commit "$COMMIT" -- "$@"
"""


class WebhookListener:
    """
    Manages Webhook / HTTP triggers.
    """
    def __init__(self):
        self.endpoints = {}

    def add_endpoint(self, trigger):
        if not trigger or "id" not in trigger:
            return False
        self.endpoints[trigger["id"]] = trigger
        return True

    def remove_endpoint(self, trigger_id):
        return self.endpoints.pop(trigger_id, None) is not None

    def process_http_request(self, method, path, headers=None, body=None, query=None):
        headers = headers or {}
        body = body or {}
        query = query or {}

        if isinstance(body, bytes):
            raw_body = body.decode('utf-8', errors='ignore')
        elif isinstance(body, str):
            raw_body = body
        else:
            raw_body = json.dumps(body)

        parsed_body = body
        if isinstance(body, (str, bytes)):
            try:
                parsed_body = json.loads(raw_body)
            except Exception:
                parsed_body = raw_body

        context = {
            "event_type": "webhook",
            "http_method": method.upper(),
            "http_path": path,
            "http_headers": headers,
            "http_body": parsed_body,
            "http_query": query,
            "timestamp": time.time()
        }

        matched = []
        for trigger_id, trigger in self.endpoints.items():
            if not trigger.get("enabled", True):
                continue
            config = trigger.get("config", {})

            # Path check
            path_pattern = config.get("path_pattern")
            if path_pattern:
                try:
                    if not re.search(path_pattern, path):
                        continue
                except Exception:
                    if path_pattern != path:
                        continue
            elif config.get("path") and config.get("path") != path:
                continue

            # Method check
            if config.get("method") and config.get("method").upper() != method.upper():
                continue

            # Secret check
            secret = config.get("secret")
            if secret:
                sig_header = headers.get("x-hub-signature-256") or headers.get("x-signature") or headers.get("x-webhook-signature")
                token_header = headers.get("x-webhook-token") or headers.get("authorization")
                valid = False

                if token_header and (token_header == secret or token_header == f"Bearer {secret}"):
                    valid = True
                elif sigHeader := sig_header:
                    expected_sig = compute_hmac_sha256(raw_body, secret)
                    clean_sig = sigHeader.replace("sha256=", "")
                    if clean_sig == expected_sig:
                        valid = True
                elif query and query.get("secret") == secret:
                    valid = True

                if not valid:
                    continue

            if evaluate_conditions(trigger.get("conditions"), context, trigger.get("logical_operator", "and")):
                matched.append({"trigger": trigger, "context": context})

        return matched


class SystemEventManager:
    """
    Manages System Event triggers.
    """
    def __init__(self):
        self.triggers = {}

    def add_trigger(self, trigger):
        if not trigger or "id" not in trigger:
            return False
        self.triggers[trigger["id"]] = trigger
        return True

    def remove_trigger(self, trigger_id):
        return self.triggers.pop(trigger_id, None) is not None

    def process_system_event(self, event_name, details=None):
        details = details or {}
        matched = []
        context = {
            "event_type": "system_event",
            "event_name": event_name,
            "system_event": event_name,
            "details": details,
            "timestamp": time.time()
        }

        for trigger_id, trigger in self.triggers.items():
            if not trigger.get("enabled", True):
                continue
            config = trigger.get("config", {})

            if config.get("event_name") and config.get("event_name") != event_name:
                continue

            if evaluate_conditions(trigger.get("conditions"), context, trigger.get("logical_operator", "and")):
                matched.append({"trigger": trigger, "context": context})

        return matched


class EventTriggerEngine:
    """
    Main Event Trigger Engine orchestrating File Watchers, Git Hooks, Webhooks, System Events, and Condition Evaluations.
    :visibility: public
    """
    def __init__(self):
        self.triggers = {}
        self.file_watchers = FileWatcher()
        self.git_hooks = GitHookManager()
        self.webhooks = WebhookListener()
        self.system_events = SystemEventManager()
        self.history = []
        self.max_history_size = 100

    def load_triggers(self, triggers_list):
        """
        Loads a list of trigger configuration dictionaries into the engine.
        :visibility: public
        """
        self.clear_all()
        if not isinstance(triggers_list, list):
            return
        for trigger in triggers_list:
            self.add_trigger(trigger)

    def add_trigger(self, trigger):
        """
        Adds or updates a trigger definition.
        :visibility: public
        """
        if not trigger or not isinstance(trigger, dict):
            return False
        trigger_id = trigger.get("id") or f"trigger_{int(time.time()*1000)}"
        full_trigger = {
            "id": trigger_id,
            "name": trigger.get("name", "Unnamed Trigger"),
            "type": trigger.get("type", "system_event"),
            "enabled": trigger.get("enabled", True),
            "target_command": trigger.get("target_command", ""),
            "config": trigger.get("config", {}),
            "conditions": trigger.get("conditions", []),
            "parameters": trigger.get("parameters", {}),
            "logical_operator": trigger.get("logical_operator", "and")
        }

        self.triggers[trigger_id] = full_trigger
        ttype = full_trigger["type"]

        if ttype in ("file_watcher", "file_change"):
            self.file_watchers.add_watch(full_trigger)
        elif ttype == "git_hook":
            self.git_hooks.add_hook(full_trigger)
        elif ttype in ("webhook", "http_request"):
            self.webhooks.add_endpoint(full_trigger)
        else:
            self.system_events.add_trigger(full_trigger)

        return True

    def remove_trigger(self, trigger_id):
        """
        Removes a trigger by ID.
        :visibility: public
        """
        if trigger_id not in self.triggers:
            return False
        del self.triggers[trigger_id]
        self.file_watchers.remove_watch(trigger_id)
        self.git_hooks.remove_hook(trigger_id)
        self.webhooks.remove_endpoint(trigger_id)
        self.system_events.remove_trigger(trigger_id)
        return True

    def enable_trigger(self, trigger_id, enabled):
        """
        Enables or disables a trigger by ID.
        :visibility: public
        """
        if trigger_id not in self.triggers:
            return False
        self.triggers[trigger_id]["enabled"] = bool(enabled)
        return True

    def get_triggers(self):
        """
        Returns a list of registered trigger definitions.
        :visibility: public
        """
        return list(self.triggers.values())

    def get_trigger(self, trigger_id):
        """
        Gets a trigger definition by ID.
        :visibility: public
        """
        return self.triggers.get(trigger_id)

    def clear_all(self):
        """
        Clears all triggers from the engine.
        :visibility: public
        """
        self.triggers.clear()
        self.file_watchers = FileWatcher()
        self.git_hooks = GitHookManager()
        self.webhooks = WebhookListener()
        self.system_events = SystemEventManager()

    def process_event(self, event_type, event_details=None, command_executor=None):
        """
        Dispatches an event to matching triggers and invokes target command callback.
        :visibility: public
        """
        event_details = event_details or {}
        matches = []

        if event_type in ("file_watcher", "file_change"):
            matches = self.file_watchers.process_file_event(event_details.get("file_path"), event_details.get("file_event", "modify"))
        elif event_type == "git_hook":
            matches = self.git_hooks.process_git_event(event_details.get("git_hook") or event_details.get("hook"), event_details)
        elif event_type in ("webhook", "http_request"):
            matches = self.webhooks.process_http_request(
                event_details.get("http_method") or event_details.get("method", "POST"),
                event_details.get("http_path") or event_details.get("path", "/"),
                event_details.get("http_headers") or event_details.get("headers", {}),
                event_details.get("http_body") or event_details.get("body", {}),
                event_details.get("http_query") or event_details.get("query", {})
            )
        else:
            matches = self.system_events.process_system_event(event_details.get("event_name") or event_details.get("name") or event_type, event_details)

        results = []
        for match in matches:
            trigger = match["trigger"]
            context = match["context"]

            resolved_command = substitute_context(trigger.get("target_command", ""), context)
            resolved_params = substitute_context(trigger.get("parameters", {}), context)

            success = True
            error = None
            output = None

            if callable(command_executor):
                try:
                    output = command_executor(resolved_command, resolved_params, context)
                except Exception as e:
                    success = False
                    error = str(e)

            record = {
                "trigger_id": trigger["id"],
                "trigger_name": trigger.get("name"),
                "event_type": event_type,
                "timestamp": time.time(),
                "command": resolved_command,
                "parameters": resolved_params,
                "context": context,
                "success": success,
                "error": error,
                "output": output
            }

            self.record_history(record)
            results.append(record)

        return results

    def record_history(self, record):
        """
        Records an event execution in the history list.
        """
        self.history.insert(0, record)
        if len(self.history) > self.max_history_size:
            self.history.pop()

    def get_history(self):
        """
        Returns recent event execution history.
        :visibility: public
        """
        return list(self.history)

    def clear_history(self):
        """
        Clears execution history.
        :visibility: public
        """
        self.history.clear()

    def benchmark_performance(self, count=1000):
        """
        Runs a benchmark test measuring condition evaluations per second.
        :visibility: public
        """
        test_condition = {
            "conditions": [
                {"field": "file_path", "operator": "ends_with", "value": ".py"},
                {"field": "file_event", "operator": "equals", "value": "modify"}
            ],
            "logical_operator": "and"
        }
        test_context = {
            "file_path": "/app/src/main.py",
            "file_event": "modify",
            "file_name": "main.py"
        }

        start_time = time.time()
        for _ in range(count):
            evaluate_condition(test_condition, test_context)
            substitute_context("python3 test.py --file={{file_name}}", test_context)
        total_time = max(0.0001, time.time() - start_time)
        ops_per_sec = int(count / total_time)

        return {
            "count": count,
            "total_time_sec": total_time,
            "ops_per_sec": ops_per_sec
        }
