#!/usr/bin/env python3
"""
Pytest unit and integration tests for companion.event_triggers.
"""

import os
import sys
import time
import json
import tempfile
import shutil
import urllib.request
import urllib.error
import pytest

from companion.event_triggers import (
    resolve_field_value,
    interpolate_parameters,
    ConditionEvaluator,
    FileWatcher,
    GitHookHandler,
    WebhookServer,
    SystemEventListener,
    EventTriggerEngine,
)
from companion.dbus_service import CmdBarDBusService
from companion.dbus_client import CmdBarDBusClient


@pytest.fixture
def tmp_dir():
    d = tempfile.mkdtemp(prefix="cmdbar_triggers_py_test_")
    yield d
    shutil.rmtree(d, ignore_errors=True)


class TestFieldResolutionAndInterpolation:
    def test_resolve_field_value(self):
        ctx = {
            "name": "build_task",
            "payload": {
                "branch": "main",
                "commit": {"id": "12345"},
                "tags": ["ci", "prod"]
            }
        }
        assert resolve_field_value("name", ctx) == "build_task"
        assert resolve_field_value("payload.branch", ctx) == "main"
        assert resolve_field_value("payload.commit.id", ctx) == "12345"
        assert resolve_field_value("payload.tags.0", ctx) == "ci"
        assert resolve_field_value("non_existent", ctx) is None

    def test_interpolate_parameters(self):
        ctx = {
            "file": "/app/src/index.py",
            "payload": {"branch": "release/1.0"}
        }
        tpl1 = "echo File: {file} on <payload.branch>"
        assert interpolate_parameters(tpl1, ctx) == "echo File: /app/src/index.py on release/1.0"

        tpl2 = "deploy {{payload.branch}}"
        assert interpolate_parameters(tpl2, ctx) == "deploy release/1.0"


class TestConditionEvaluator:
    def test_equals_and_not_equals(self):
        ctx = {"status": "success", "code": 200}
        assert ConditionEvaluator.evaluate_rule({"field": "status", "operator": "equals", "value": "success"}, ctx) is True
        assert ConditionEvaluator.evaluate_rule({"field": "status", "operator": "not_equals", "value": "failed"}, ctx) is True
        assert ConditionEvaluator.evaluate_rule({"field": "code", "operator": "eq", "value": "200"}, ctx) is True

    def test_containment_and_regex(self):
        ctx = {"file": "test_app.py", "tags": ["backend", "python"]}
        assert ConditionEvaluator.evaluate_rule({"field": "file", "operator": "contains", "value": "app"}, ctx) is True
        assert ConditionEvaluator.evaluate_rule({"field": "file", "operator": "not_contains", "value": "js"}, ctx) is True
        assert ConditionEvaluator.evaluate_rule({"field": "tags", "operator": "contains", "value": "python"}, ctx) is True
        assert ConditionEvaluator.evaluate_rule({"field": "file", "operator": "regex", "value": r"^test_.*\.py$"}, ctx) is True

    def test_comparisons_and_in_operators(self):
        ctx = {"score": 95.5, "env": "staging"}
        assert ConditionEvaluator.evaluate_rule({"field": "score", "operator": "greater_than", "value": 90}, ctx) is True
        assert ConditionEvaluator.evaluate_rule({"field": "score", "operator": "less_than", "value": 100}, ctx) is True
        assert ConditionEvaluator.evaluate_rule({"field": "env", "operator": "in", "value": ["staging", "production"]}, ctx) is True

    def test_is_empty_and_is_not_empty(self):
        ctx = {"empty_list": [], "active": "yes"}
        assert ConditionEvaluator.evaluate_rule({"field": "empty_list", "operator": "is_empty"}, ctx) is True
        assert ConditionEvaluator.evaluate_rule({"field": "active", "operator": "is_not_empty"}, ctx) is True

    def test_nested_boolean_logic(self):
        ctx = {"branch": "main", "status": "success", "attempts": 1}
        rule_all = {
            "all": [
                {"field": "branch", "operator": "equals", "value": "main"},
                {"field": "status", "operator": "equals", "value": "success"}
            ]
        }
        assert ConditionEvaluator.evaluate_rule(rule_all, ctx) is True

        rule_any = {
            "any": [
                {"field": "branch", "operator": "equals", "value": "dev"},
                {"field": "status", "operator": "equals", "value": "success"}
            ]
        }
        assert ConditionEvaluator.evaluate_rule(rule_any, ctx) is True

        rule_not = {
            "not": {"field": "branch", "operator": "equals", "value": "feature"}
        }
        assert ConditionEvaluator.evaluate_rule(rule_not, ctx) is True


class TestFileWatcher:
    def test_file_watcher_detects_changes(self, tmp_dir):
        target_file = os.path.join(tmp_dir, "sample.txt")
        with open(target_file, "w") as f:
            f.write("v1")

        events_received = []

        def on_event(ctx):
            events_received.append(ctx)

        watcher = FileWatcher(path=tmp_dir, callback=on_event, events=["modify", "create"], debounce_ms=50)
        watcher.start()

        time.sleep(0.1)
        with open(target_file, "a") as f:
            f.write("\nv2")

        time.sleep(0.3)
        watcher.stop()

        assert len(events_received) >= 1
        assert events_received[-1]["event_type"] == "file_change"


class TestGitHookHandler:
    def test_install_uninstall_git_hook(self, tmp_dir):
        git_dir = os.path.join(tmp_dir, ".git", "hooks")
        os.makedirs(git_dir, exist_ok=True)

        res_install = GitHookHandler.install_git_hook(tmp_dir, "pre-commit", "trig_py")
        assert res_install is True
        hook_path = os.path.join(git_dir, "pre-commit")
        assert os.path.exists(hook_path)

        res_uninstall = GitHookHandler.uninstall_git_hook(tmp_dir, "pre-commit")
        assert res_uninstall is True
        assert not os.path.exists(hook_path)

    def test_build_event_context(self, tmp_dir):
        ctx = GitHookHandler.build_event_context(tmp_dir, "pre-push", ["origin", "main"])
        assert ctx["event_type"] == "git_hook"
        assert ctx["hook_type"] == "pre-push"
        assert ctx["payload"]["args"] == ["origin", "main"]


class TestWebhookServer:
    def test_webhook_server_post_handling(self):
        port = 19123
        secret = "secret-pass"

        fired_events = []
        engine = EventTriggerEngine(action_executor=lambda cmd, ctx: fired_events.append((cmd, ctx)))

        engine.register_trigger({
            "id": "wh_trig",
            "type": "webhook",
            "config": {"port": port, "secret": secret},
            "action": "echo Webhook Triggered for {payload.service}"
        })

        time.sleep(0.1)
        req_data = json.dumps({"service": "auth-service", "status": "deployed"}).encode("utf-8")
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/webhook",
            data=req_data,
            headers={
                "Content-Type": "application/json",
                "X-Secret-Token": secret
            },
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=3) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                assert resp.status == 200
                assert body["status"] == "ok"
        finally:
            engine.stop_all_services()

        assert len(fired_events) == 1
        assert fired_events[0][1]["payload"]["service"] == "auth-service"


class TestEventTriggerEngineAndDBus:
    def test_engine_register_unregister_enable_disable(self):
        engine = EventTriggerEngine()
        reg_ok = engine.register_trigger({
            "id": "t1",
            "type": "file_change",
            "action": "echo Changed"
        })
        assert reg_ok is True
        assert len(engine.get_triggers()) == 1

        engine.disable_trigger("t1")
        assert engine.get_trigger("t1")["enabled"] is False

        engine.enable_trigger("t1")
        assert engine.get_trigger("t1")["enabled"] is True

        engine.unregister_trigger("t1")
        assert len(engine.get_triggers()) == 0

    def test_engine_fire_event_with_conditions(self):
        executed = []
        engine = EventTriggerEngine(action_executor=lambda cmd, ctx: executed.append((cmd, ctx)))

        engine.register_trigger({
            "id": "py_trig",
            "type": "file_change",
            "action": "pytest {file_name}",
            "condition": {"field": "file_ext", "operator": "equals", "value": "py"}
        })

        engine.fire_event("file_change", {"file_name": "test.js", "file_ext": "js"})
        assert len(executed) == 0

        engine.fire_event("file_change", {"file_name": "test_app.py", "file_ext": "py"})
        assert len(executed) == 1
        assert executed[0][0] == "pytest test_app.py"

    def test_dbus_service_and_client_triggers(self, tmp_dir):
        cfg_path = os.path.join(tmp_dir, "config.json")
        service = CmdBarDBusService(config_path=cfg_path)
        client = CmdBarDBusClient(service=service)

        trig = {
            "id": "dbus_trig_1",
            "type": "system_event",
            "action": "echo System Event Fired"
        }

        reg_ok = client.register_trigger(trig)
        assert reg_ok is True

        trigs = client.get_triggers()
        assert len(trigs) >= 1
        assert trigs[0]["id"] == "dbus_trig_1"

        res = client.fire_event("system_event", {"event_name": "startup"})
        assert isinstance(res, list)

        unreg_ok = client.unregister_trigger("dbus_trig_1")
        assert unreg_ok is True


class TestPerformanceBenchmark:
    def test_condition_evaluator_benchmark(self):
        ctx = {
            "status": "success",
            "meta": {"environment": "production", "region": "us-east-1"},
            "flags": ["audit", "security", "monitored"]
        }
        rule = {
            "all": [
                {"field": "status", "operator": "equals", "value": "success"},
                {"field": "meta.environment", "operator": "equals", "value": "production"},
                {"field": "flags", "operator": "contains", "value": "security"}
            ]
        }

        iterations = 5000
        start = time.time()
        for _ in range(iterations):
            ConditionEvaluator.evaluate_rule(rule, ctx)
        elapsed = time.time() - start

        ops_per_sec = iterations / elapsed if elapsed > 0 else 100000
        assert elapsed < 1.0
        assert ops_per_sec > 10000
