import os
import json
import pytest
from companion.event_triggers import (
    evaluate_condition,
    evaluate_conditions,
    substitute_context,
    compute_hmac_sha256,
    get_nested_value,
    FileWatcher,
    GitHookManager,
    WebhookListener,
    SystemEventManager,
    EventTriggerEngine,
)
from companion.dbus_service import CmdBarDBusService


def test_get_nested_value():
    obj = {"user": {"name": "Alice", "meta": {"role": "admin"}}}
    assert get_nested_value(obj, "user.name") == "Alice"
    assert get_nested_value(obj, "user.meta.role") == "admin"
    assert get_nested_value(obj, "user.nonexistent") is None
    assert get_nested_value(None, "user.name") is None


def test_evaluate_condition():
    context = {
        "file_path": "/app/src/index.py",
        "file_event": "modify",
        "git_branch": "main",
        "status_code": 200,
        "http_body": {"ref": "refs/heads/main", "action": "opened"},
        "tags": ["ci", "build"],
    }

    assert evaluate_condition({"field": "git_branch", "operator": "equals", "value": "main"}, context) is True
    assert evaluate_condition({"field": "git_branch", "operator": "not_equals", "value": "dev"}, context) is True
    assert evaluate_condition({"field": "file_path", "operator": "ends_with", "value": ".py"}, context) is True
    assert evaluate_condition({"field": "file_path", "operator": "starts_with", "value": "/app"}, context) is True
    assert evaluate_condition({"field": "file_path", "operator": "contains", "value": "src"}, context) is True
    assert evaluate_condition({"field": "file_path", "operator": "regex", "value": r"\.py$"}, context) is True

    assert evaluate_condition({"field": "status_code", "operator": "gt", "value": 199}, context) is True
    assert evaluate_condition({"field": "status_code", "operator": "lt", "value": 300}, context) is True
    assert evaluate_condition({"field": "status_code", "operator": "gte", "value": 200}, context) is True
    assert evaluate_condition({"field": "status_code", "operator": "lte", "value": 200}, context) is True

    assert evaluate_condition({"field": "tags", "operator": "contains", "value": "ci"}, context) is True
    assert evaluate_condition({"field": "git_branch", "operator": "in", "value": ["main", "master"]}, context) is True
    assert evaluate_condition({"field": "git_branch", "operator": "not_in", "value": ["feature", "dev"]}, context) is True

    assert evaluate_condition({"field": "file_path", "operator": "exists"}, context) is True
    assert evaluate_condition({"field": "nonexistent", "operator": "not_exists"}, context) is True

    assert evaluate_condition({"field": "http_body.ref", "operator": "contains", "value": "main"}, context) is True


def test_substitute_context():
    context = {
        "file_name": "app.py",
        "git_branch": "feature/login",
        "user": {"name": "Bob"},
    }
    template = "git checkout {{git_branch}} && python3 <file_name> --user={{user.name}}"
    result = substitute_context(template, context)
    assert result == "git checkout feature/login && python3 app.py --user=Bob"


def test_compute_hmac_sha256():
    payload = '{"ref":"refs/heads/main"}'
    secret = "secret123"
    sig = compute_hmac_sha256(payload, secret)
    assert isinstance(sig, str)
    assert len(sig) > 0


def test_file_watcher():
    fw = FileWatcher()
    trigger = {
        "id": "fw1",
        "enabled": True,
        "type": "file_watcher",
        "config": {"path": "/app/src", "events": ["modify", "create"], "recursive": True},
        "conditions": [{"field": "file_name", "operator": "ends_with", "value": ".py"}],
    }
    fw.add_watch(trigger)

    matches = fw.process_file_event("/app/src/main.py", "modify")
    assert len(matches) == 1
    assert matches[0]["context"]["file_name"] == "main.py"

    no_match_ext = fw.process_file_event("/app/src/styles.css", "modify")
    assert len(no_match_ext) == 0


def test_git_hook_manager():
    ghm = GitHookManager()
    trigger = {
        "id": "gh1",
        "enabled": True,
        "type": "git_hook",
        "config": {"hook": "pre-commit", "branch": "main"},
    }
    ghm.add_hook(trigger)

    matches = ghm.process_git_event("pre-commit", {"repo_path": "/app", "branch": "main"})
    assert len(matches) == 1

    script = ghm.generate_hook_script("pre-commit")
    assert "#!/bin/sh" in script
    assert "pre-commit" in script


def test_webhook_listener():
    wl = WebhookListener()
    secret = "my_secret_token"
    body = {"ref": "refs/heads/main"}
    raw_body = json.dumps(body)
    sig = compute_hmac_sha256(raw_body, secret)

    wl.add_endpoint({
        "id": "wh1",
        "enabled": True,
        "type": "webhook",
        "config": {"path": "/webhook/github", "method": "POST", "secret": secret},
    })

    matches = wl.process_http_request("POST", "/webhook/github", {"x-hub-signature-256": f"sha256={sig}"}, body)
    assert len(matches) == 1

    no_secret = wl.process_http_request("POST", "/webhook/github", {}, body)
    assert len(no_secret) == 0


def test_system_event_manager():
    sem = SystemEventManager()
    sem.add_trigger({
        "id": "sys1",
        "enabled": True,
        "type": "system_event",
        "config": {"event_name": "timer"},
        "conditions": [{"field": "details.interval", "operator": "equals", "value": 60}],
    })

    matches = sem.process_system_event("timer", {"interval": 60})
    assert len(matches) == 1


def test_event_trigger_engine():
    engine = EventTriggerEngine()
    triggers = [
        {
            "id": "trig1",
            "name": "Auto Build",
            "type": "file_watcher",
            "enabled": True,
            "target_command": "python3 build.py --file={{file_name}}",
            "config": {"path": "/app/src"},
            "conditions": [{"field": "file_event", "operator": "equals", "value": "modify"}],
        }
    ]

    engine.load_triggers(triggers)
    assert len(engine.get_triggers()) == 1

    executed = []
    def executor(cmd, params, context):
        executed.append(cmd)
        return "OK"

    results = engine.process_event("file_watcher", {"file_path": "/app/src/main.py", "file_event": "modify"}, executor)
    assert len(results) == 1
    assert results[0]["success"] is True
    assert results[0]["command"] == "python3 build.py --file=main.py"
    assert len(executed) == 1

    bench = engine.benchmark_performance(500)
    assert bench["count"] == 500
    assert bench["ops_per_sec"] > 100


def test_dbus_trigger_integration(tmp_path):
    cfg_file = tmp_path / "config.json"
    service = CmdBarDBusService(config_path=str(cfg_file))

    trigger_data = {
        "id": "dbus_trig1",
        "name": "DBus Trigger Test",
        "type": "system_event",
        "enabled": True,
        "target_command": "echo 'Triggered'",
        "config": {"event_name": "test_event"}
    }

    assert service.add_trigger(json.dumps(trigger_data)) is True
    triggers = service.get_triggers()
    assert len(triggers) == 1

    triggered_events = []
    def on_event(trig_id, event_type, command, success):
        triggered_events.append((trig_id, event_type, command, success))

    service.add_event_listener(on_event)
    service.trigger_event("system_event", json.dumps({"event_name": "test_event"}))

    assert len(triggered_events) == 1
    assert triggered_events[0][0] == "dbus_trig1"

    assert service.remove_trigger("dbus_trig1") is True
    assert len(service.get_triggers()) == 0
