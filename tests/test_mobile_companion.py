#!/usr/bin/env python3
"""
Test Suite for CmdBar Mobile Companion App Module
=================================================
Covers:
  - Device pairing and token management (iOS & Android)
  - Biometric authentication challenge creation, verification, replay prevention
  - Quick action management and platform-specific formatters
  - Widget payload generation for iOS WidgetKit & Android RemoteViews
  - Push notification payload creation and dispatch (APNs & FCM)
  - Offline queue management, batch sync, retries, and execution tracking
  - Performance benchmarks and security review scenarios
  - D-Bus service integration
"""

import os
import sys
import tempfile
import time
import json
import pytest

from companion.mobile_companion import (
    DeviceManager,
    BiometricAuthManager,
    QuickActionManager,
    WidgetManager,
    PushNotificationManager,
    OfflineQueueManager,
    MobileCompanionService,
    get_mobile_config_path,
    get_mobile_queue_path
)
from companion.dbus_service import CmdBarDBusService


@pytest.fixture
def temp_mobile_env():
    """
    Sets up temporary configuration and queue file paths for testing.
    """
    tmp_config = tempfile.NamedTemporaryFile(suffix=".json", delete=False)
    tmp_queue = tempfile.NamedTemporaryFile(suffix=".json", delete=False)
    tmp_config.close()
    tmp_queue.close()

    os.environ["CMDBAR_MOBILE_CONFIG_PATH"] = tmp_config.name
    os.environ["CMDBAR_MOBILE_QUEUE_PATH"] = tmp_queue.name

    yield tmp_config.name, tmp_queue.name

    for path in (tmp_config.name, tmp_queue.name):
        if os.path.exists(path):
            os.remove(path)
        if os.path.exists(path + ".tmp"):
            os.remove(path + ".tmp")

    os.environ.pop("CMDBAR_MOBILE_CONFIG_PATH", None)
    os.environ.pop("CMDBAR_MOBILE_QUEUE_PATH", None)


# -------------------------------------------------------------------
# 1. Device Manager Tests
# -------------------------------------------------------------------

def test_device_registration_and_listing():
    mgr = DeviceManager()

    # Register iOS device
    dev_ios = mgr.register_device("dev-ios-1", "iPhone 15 Pro", "ios", push_token="apns_token_123")
    assert dev_ios["device_id"] == "dev-ios-1"
    assert dev_ios["platform"] == "ios"
    assert dev_ios["push_token"] == "apns_token_123"

    # Register Android device
    dev_and = mgr.register_device("dev-and-1", "Pixel 8 Pro", "android", push_token="fcm_token_456")
    assert dev_and["device_id"] == "dev-and-1"
    assert dev_and["platform"] == "android"

    # List devices
    devices = mgr.list_devices()
    assert len(devices) == 2

    # Get single device
    fetched = mgr.get_device("dev-ios-1")
    assert fetched["name"] == "iPhone 15 Pro"


def test_device_registration_validations():
    mgr = DeviceManager()

    with pytest.raises(ValueError, match="Device ID cannot be empty"):
        mgr.register_device("", "Name", "ios")

    with pytest.raises(ValueError, match="Device name cannot be empty"):
        mgr.register_device("dev-1", "", "ios")

    with pytest.raises(ValueError, match="Unsupported platform"):
        mgr.register_device("dev-1", "Name", "windows_phone")


def test_device_unregistration_and_token_update():
    mgr = DeviceManager()
    mgr.register_device("dev-1", "iPad Air", "ios", push_token="old_token")

    # Update token
    updated = mgr.update_push_token("dev-1", "new_token_789")
    assert updated is True
    assert mgr.get_device("dev-1")["push_token"] == "new_token_789"

    # Non-existent device update
    assert mgr.update_push_token("non-existent", "token") is False

    # Unregister
    removed = mgr.unregister_device("dev-1")
    assert removed is True
    assert mgr.get_device("dev-1") is None
    assert mgr.unregister_device("dev-1") is False


# -------------------------------------------------------------------
# 2. Biometric Auth Manager Tests
# -------------------------------------------------------------------

def test_biometric_challenge_creation_and_verification():
    bio = BiometricAuthManager(secret_key="test_secret_key_123")

    challenge = bio.create_challenge("dev-ios-1", "deploy_staging", ttl_seconds=300)
    assert "challenge_id" in challenge
    assert challenge["device_id"] == "dev-ios-1"
    assert challenge["action_id"] == "deploy_staging"

    cid = challenge["challenge_id"]
    sig = challenge["signature_token"]

    # Valid verification
    valid, msg = bio.verify_challenge(cid, sig, biometric_type="face_id")
    assert valid is True
    assert "verified successfully" in msg


def test_biometric_challenge_single_use_replay_prevention():
    bio = BiometricAuthManager(secret_key="test_secret_key")
    challenge = bio.create_challenge("dev-1", "act-1", ttl_seconds=300)

    cid = challenge["challenge_id"]
    sig = challenge["signature_token"]

    # First verification passes
    v1, _ = bio.verify_challenge(cid, sig, biometric_type="touch_id")
    assert v1 is True

    # Replay attack attempt fails
    v2, msg2 = bio.verify_challenge(cid, sig, biometric_type="touch_id")
    assert v2 is False
    assert "already been used" in msg2


def test_biometric_challenge_expiration():
    bio = BiometricAuthManager(secret_key="test_secret_key")
    # Expired challenge (ttl = -1 sec)
    challenge = bio.create_challenge("dev-1", "act-1", ttl_seconds=-1)

    cid = challenge["challenge_id"]
    sig = challenge["signature_token"]

    valid, msg = bio.verify_challenge(cid, sig, biometric_type="android_biometric")
    assert valid is False
    assert "expired" in msg


def test_biometric_invalid_signature_or_challenge():
    bio = BiometricAuthManager(secret_key="test_secret_key")
    challenge = bio.create_challenge("dev-1", "act-1", ttl_seconds=300)

    # Invalid challenge ID
    v1, msg1 = bio.verify_challenge("fake_challenge_id", "sig")
    assert v1 is False
    assert "not found" in msg1

    # Invalid signature
    v2, msg2 = bio.verify_challenge(challenge["challenge_id"], "invalid_signature")
    assert v2 is False
    assert "Invalid biometric signature" in msg2


# -------------------------------------------------------------------
# 3. Quick Action Manager Tests
# -------------------------------------------------------------------

def test_quick_action_crud_and_formatting():
    qa = QuickActionManager()

    act1 = qa.add_quick_action("act-1", "Deploy Staging", "make deploy", icon="rocket", category="Deploy", requires_biometric=True)
    assert act1["action_id"] == "act-1"
    assert act1["requires_biometric"] is True

    act2 = qa.add_quick_action("act-2", "Restart Server", "systemctl restart app", icon="refresh", category="Ops")

    # Format for iOS
    ios_actions = qa.get_quick_actions(platform="ios")
    assert len(ios_actions) == 2
    assert ios_actions[0]["type"] == "act-1"
    assert ios_actions[0]["title"] == "Deploy Staging"
    assert ios_actions[0]["subtitle"] == "Deploy"
    assert ios_actions[0]["requiresBiometric"] is True

    # Format for Android
    android_actions = qa.get_quick_actions(platform="android")
    assert len(android_actions) == 2
    assert android_actions[0]["id"] == "act-1"
    assert android_actions[0]["shortLabel"] == "Deploy Staging"
    assert android_actions[0]["longLabel"] == "Deploy: Deploy Staging"

    # Remove quick action
    assert qa.remove_quick_action("act-1") is True
    assert qa.get_quick_action("act-1") is None


def test_quick_action_validations():
    qa = QuickActionManager()
    with pytest.raises(ValueError, match="Action ID cannot be empty"):
        qa.add_quick_action("", "Name", "cmd")
    with pytest.raises(ValueError, match="Action name cannot be empty"):
        qa.add_quick_action("act-1", "", "cmd")
    with pytest.raises(ValueError, match="Command string cannot be empty"):
        qa.add_quick_action("act-1", "Name", "")


# -------------------------------------------------------------------
# 4. Widget Manager Tests
# -------------------------------------------------------------------

def test_widget_payload_generation():
    qa = QuickActionManager()
    qa.add_quick_action("q1", "Build Project", "make build", category="Dev")
    qa.add_quick_action("q2", "Run Tests", "npm test", category="Test")

    wm = WidgetManager(qa)

    # iOS Payload
    ios_payload = wm.get_widget_payload(platform="ios", widget_family="medium", system_status="online", queue_count=2)
    assert ios_payload["status"] == "online"
    assert len(ios_payload["quickActions"]) == 2
    assert ios_payload["systemMetrics"]["queueDepth"] == 2
    assert ios_payload["timeline"][0]["badgeCount"] == 2

    # Android Payload
    android_payload = wm.get_widget_payload(platform="android", widget_family="medium", system_status="online", queue_count=2)
    assert android_payload["widgetType"] == "remote_views"
    assert len(android_payload["shortcuts"]) == 2
    assert android_payload["queueCount"] == 2


# -------------------------------------------------------------------
# 5. Push Notification Manager Tests
# -------------------------------------------------------------------

def test_push_notification_building_and_dispatch():
    dm = DeviceManager()
    dm.register_device("dev-ios", "iPhone", "ios", push_token="apns_tok")
    dm.register_device("dev-and", "Pixel", "android", push_token="fcm_tok")

    pm = PushNotificationManager(dm)

    # APNs payload check
    apns = pm.build_apns_payload("Build Alert", "Build completed successfully", {"build_id": "99"})
    assert apns["aps"]["alert"]["title"] == "Build Alert"
    assert apns["data"]["build_id"] == "99"

    # FCM payload check
    fcm = pm.build_fcm_payload("fcm_tok", "Deployment", "Deploying v1.0", {"service": "api"})
    assert fcm["message"]["token"] == "fcm_tok"
    assert fcm["message"]["notification"]["title"] == "Deployment"

    # Single push sending
    res_ios = pm.send_push_notification("dev-ios", "Task Done", "Task #123 finished")
    assert res_ios["status"] == "delivered"
    assert res_ios["platform"] == "ios"

    # Broadcast push
    broadcast_results = pm.broadcast_push("Global Notice", "System maintenance in 10 mins")
    assert len(broadcast_results) == 2


# -------------------------------------------------------------------
# 6. Offline Queue Manager Tests
# -------------------------------------------------------------------

def test_offline_queue_enqueue_and_persistence(temp_mobile_env):
    q_mgr = OfflineQueueManager()

    item1 = q_mgr.enqueue_action("dev-1", "Deploy", "echo 'deploying'")
    assert item1["status"] == "queued"
    assert item1["command_name"] == "Deploy"

    item2 = q_mgr.enqueue_action("dev-1", "Sync", "echo 'syncing'")

    # Verify queue retrieval
    queued = q_mgr.get_queue(status="queued")
    assert len(queued) == 2

    # Reload from disk
    q_mgr_reloaded = OfflineQueueManager()
    assert len(q_mgr_reloaded.get_queue()) == 2


def test_offline_queue_batch_sync(temp_mobile_env):
    q_mgr = OfflineQueueManager()

    # Sync remote mobile batch
    batch = [
        {"queue_id": "q-100", "command_name": "Task 1", "command": "echo 1"},
        {"queue_id": "q-101", "command_name": "Task 2", "command": "echo 2"}
    ]
    res = q_mgr.sync_queue("dev-mobile", batch)
    assert res["added"] == 2
    assert res["total_queued"] == 2

    # Re-syncing existing batch should update, not duplicate
    res_dup = q_mgr.sync_queue("dev-mobile", batch)
    assert res_dup["added"] == 0
    assert res_dup["updated"] == 2


def test_offline_queue_processing_and_retries(temp_mobile_env):
    q_mgr = OfflineQueueManager()
    q_mgr.enqueue_action("dev-1", "Success Task", "echo 'ok'")
    q_mgr.enqueue_action("dev-1", "Fail Task", "exit 1")

    # Custom executor
    def test_executor(cmd):
        if "exit 1" in cmd:
            return 1, "", "Failed command"
        return 0, "Success output", ""

    results = q_mgr.process_queue(max_items=10, executor_fn=test_executor)
    assert len(results) == 2

    completed = [r for r in results if r["status"] == "completed"]
    retrying = [r for r in results if r["status"] in ("retrying", "failed")]

    assert len(completed) == 1
    assert completed[0]["result"]["stdout"] == "Success output"
    assert len(retrying) == 1


def test_offline_queue_clear_and_stats(temp_mobile_env):
    q_mgr = OfflineQueueManager()
    q_mgr.enqueue_action("dev-1", "T1", "echo 1")
    q_mgr.enqueue_action("dev-2", "T2", "echo 2")

    stats = q_mgr.get_stats()
    assert stats["queued"] == 2
    assert stats["total"] == 2

    # Clear specific device
    cleared_dev1 = q_mgr.clear_queue(device_id="dev-1")
    assert cleared_dev1 == 1
    assert len(q_mgr.get_queue()) == 1

    # Clear remaining
    cleared_all = q_mgr.clear_queue()
    assert cleared_all == 1
    assert len(q_mgr.get_queue()) == 0


# -------------------------------------------------------------------
# 7. MobileCompanionService & D-Bus Service Integration Tests
# -------------------------------------------------------------------

def test_mobile_companion_service_and_dbus(temp_mobile_env):
    service = MobileCompanionService()

    # Register device
    service.device_mgr.register_device("dev-dbus-1", "Test Phone", "android", push_token="tok_dbus")
    service.quick_action_mgr.add_quick_action("act-1", "Quick Echo", "echo 'quick'")
    service.save_config()

    # D-Bus Wrapper test
    dbus_svc = CmdBarDBusService()
    # Inject service instance to test D-Bus methods
    dbus_svc.mobile_service = service

    reg_ok = dbus_svc.register_mobile_device("dev-dbus-2", "Test iPad", "ios", "tok_ipad")
    assert reg_ok is True

    devices_json = dbus_svc.get_mobile_devices_json()
    assert "dev-dbus-2" in devices_json

    widget_json = dbus_svc.get_mobile_widget_payload("ios", "medium")
    assert "Quick Echo" in widget_json

    push_ok = dbus_svc.send_mobile_push_notification("dev-dbus-1", "Test Title", "Test Body")
    assert push_ok is True


# -------------------------------------------------------------------
# 8. Performance Benchmarks & Security Reviews
# -------------------------------------------------------------------

def test_performance_benchmarks(temp_mobile_env):
    service = MobileCompanionService()

    # Benchmark 1: Enqueue 100 items and process
    for i in range(100):
        service.queue_mgr.enqueue_action("dev-bench", f"Bench Task {i}", f"echo {i}")

    t0 = time.time()
    processed = service.queue_mgr.process_queue(max_items=100, executor_fn=lambda cmd: (0, "ok", ""))
    t_duration = time.time() - t0

    assert len(processed) == 100
    # Must process 100 queue items in under 500ms (0.5s)
    assert t_duration < 0.5

    # Benchmark 2: Widget payload generation speed (< 10ms)
    t_w0 = time.time()
    for _ in range(50):
        _ = service.widget_mgr.get_widget_payload("ios", "medium")
    t_w_duration = (time.time() - t_w0) / 50.0

    assert t_w_duration < 0.010  # Less than 10ms per payload rendering


def test_security_review_tamper_and_replay_protection():
    bio = BiometricAuthManager(secret_key="secure_key_123")
    ch = bio.create_challenge("dev-secure", "sensitive_cmd", ttl_seconds=300)

    # Tampered signature
    tampered_sig = ch["signature_token"][:-1] + ("0" if ch["signature_token"][-1] != "0" else "1")
    v_tampered, msg = bio.verify_challenge(ch["challenge_id"], tampered_sig)
    assert v_tampered is False
    assert "Invalid biometric signature" in msg

    # Replay protection
    v_first, _ = bio.verify_challenge(ch["challenge_id"], ch["signature_token"])
    assert v_first is True

    v_replay, msg_replay = bio.verify_challenge(ch["challenge_id"], ch["signature_token"])
    assert v_replay is False
    assert "replay attack" in msg_replay
