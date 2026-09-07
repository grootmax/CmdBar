import os
import tempfile
import time
import pytest

from companion.mobile_companion import (
    MobileCompanionService,
    get_mobile_config_path,
    load_mobile_config,
    save_mobile_config,
)


@pytest.fixture
def temp_mobile_config():
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        tmp_path = tmp.name
    os.environ["CMDBAR_MOBILE_CONFIG_PATH"] = tmp_path
    yield tmp_path
    if os.path.exists(tmp_path):
        os.remove(tmp_path)
    if os.path.exists(tmp_path + ".tmp"):
        os.remove(tmp_path + ".tmp")
    os.environ.pop("CMDBAR_MOBILE_CONFIG_PATH", None)


def test_device_registration_and_auth(temp_mobile_config):
    service = MobileCompanionService()

    # Test iOS Device Registration
    ios_device = service.device_manager.register_device(
        device_id="dev_ios_1",
        name="John's iPhone",
        platform="ios",
        push_token="apns_token_12345",
        biometric_public_key="bio_pub_key_ios",
    )
    assert ios_device["device_id"] == "dev_ios_1"
    assert ios_device["platform"] == "ios"
    assert ios_device["biometric_enrolled"] is True

    # Test Android Device Registration
    android_device = service.device_manager.register_device(
        device_id="dev_android_1",
        name="Pixel 8",
        platform="android",
        push_token="fcm_token_67890",
    )
    assert android_device["platform"] == "android"

    # Test List Devices
    devices = service.device_manager.list_devices()
    assert len(devices) == 2

    # Test Device Auth
    dev_token = ios_device["device_token"]
    assert service.device_manager.authenticate_device("dev_ios_1", dev_token) is True
    assert service.device_manager.authenticate_device("dev_ios_1", "wrong_token") is False

    # Test Push Token Update
    updated = service.device_manager.update_push_token("dev_ios_1", "new_apns_token")
    assert updated is True
    assert service.device_manager.get_device("dev_ios_1")["push_token"] == "new_apns_token"

    # Test Invalid Registration Inputs
    with pytest.raises(ValueError):
        service.device_manager.register_device("", "Name", "ios")
    with pytest.raises(ValueError):
        service.device_manager.register_device("id", "Name", "windows_phone")

    # Test Unregister
    assert service.device_manager.unregister_device("dev_android_1") is True
    assert len(service.device_manager.list_devices()) == 1


def test_push_notifications(temp_mobile_config):
    service = MobileCompanionService()
    service.device_manager.register_device("ios_dev", "iPhone", "ios", "apns_123")
    service.device_manager.register_device("android_dev", "Pixel", "android", "fcm_456")

    # Send Notification to iOS
    ios_notif = service.push_engine.send_notification(
        "ios_dev", "Alert", "Command Succeeded", payload={"cmd": "git checkout"}
    )
    assert ios_notif["platform"] == "ios"
    assert "aps" in ios_notif["formatted_payload"]

    # Send Notification to Android
    android_notif = service.push_engine.send_notification(
        "android_dev", "Alert", "Command Failed", payload={"cmd": "docker run"}
    )
    assert android_notif["platform"] == "android"
    assert "notification" in android_notif["formatted_payload"]

    # Broadcast
    broadcast_results = service.push_engine.broadcast_notification("System Update", "Reboot complete")
    assert len(broadcast_results) == 2

    # History
    history = service.push_engine.get_notification_history("ios_dev")
    assert len(history) >= 2


def test_quick_actions_and_execution(temp_mobile_config):
    service = MobileCompanionService()
    service.device_manager.register_device("dev_1", "Phone", "ios")

    # Register Quick Action
    action = service.quick_action_manager.register_quick_action(
        action_id="qa_echo",
        title="Quick Echo",
        command_template="echo {message}",
        category="Testing",
        params_schema={"message": {"regex": r"^[a-zA-Z0-9_\-\s]+$"}},
    )
    assert action["action_id"] == "qa_echo"

    actions = service.quick_action_manager.get_quick_actions()
    assert len(actions) == 1

    # Execute Quick Action
    result = service.quick_action_manager.execute_quick_action(
        device_id="dev_1", action_id="qa_echo", params={"message": "Hello Mobile"}
    )
    assert result["status"] == "success"
    assert "Hello Mobile" in result["stdout"]

    # Execute with invalid param regex
    invalid_result = service.quick_action_manager.execute_quick_action(
        device_id="dev_1", action_id="qa_echo", params={"message": "Hello; rm -rf /"}
    )
    assert invalid_result["status"] == "error"
    assert "failed regex validation" in invalid_result["message"]

    # Remove Action
    assert service.quick_action_manager.remove_quick_action("qa_echo") is True
    assert len(service.quick_action_manager.get_quick_actions()) == 0


def test_biometric_auth_flow(temp_mobile_config):
    service = MobileCompanionService()
    service.device_manager.register_device(
        "bio_dev", "Secure Phone", "ios", biometric_public_key="secret_key_123"
    )

    # Register biometric required action
    service.quick_action_manager.register_quick_action(
        action_id="qa_secure",
        title="Secure Action",
        command_template="echo secure_output",
        require_biometric=True,
    )

    # Attempt execution without biometric token -> should fail
    fail_res = service.quick_action_manager.execute_quick_action("bio_dev", "qa_secure")
    assert fail_res["status"] == "biometric_required"

    # Generate Challenge
    challenge = service.biometric_handler.generate_challenge("bio_dev")
    assert "challenge" in challenge

    # Generate Token
    token = service.biometric_handler.create_biometric_token("bio_dev", challenge["challenge"])

    # Verify and Execute
    success_res = service.quick_action_manager.execute_quick_action(
        "bio_dev", "qa_secure", biometric_token=token
    )
    assert success_res["status"] == "success"
    assert "secure_output" in success_res["stdout"]


def test_widget_provider(temp_mobile_config):
    service = MobileCompanionService()
    service.device_manager.register_device("dev_1", "Phone", "android", "fcm_token")
    service.quick_action_manager.register_quick_action("qa_1", "Action 1", "echo 1")
    service.quick_action_manager.register_quick_action("qa_2", "Action 2", "echo 2")

    # Get Widget Data
    data_all = service.widget_provider.get_widget_data("all", size="medium")
    assert "quick_actions" in data_all
    assert len(data_all["quick_actions"]) == 2
    assert "system_status" in data_all

    data_qa = service.widget_provider.get_widget_data("quick_actions", size="small")
    assert data_qa["widget_type"] == "quick_actions"
    assert len(data_qa["items"]) == 2

    # Refresh Widget Data
    refreshed = service.widget_provider.refresh_widget_data("all")
    assert "updated_at" in refreshed or "quick_actions" in refreshed


def test_offline_queue(temp_mobile_config):
    service = MobileCompanionService()
    service.device_manager.register_device("dev_offline", "Offline Phone", "ios")
    service.quick_action_manager.register_quick_action("qa_queued", "Queued Action", "echo queued_ok")

    # Enqueue requests when offline
    req1 = service.offline_queue.enqueue_request("dev_offline", "qa_queued")
    req2 = service.offline_queue.enqueue_request("dev_offline", "qa_queued")

    queued = service.offline_queue.get_queued_requests("dev_offline", status="queued")
    assert len(queued) == 2

    # Process all queued requests when reconnected
    results = service.offline_queue.process_all_queued_requests()
    assert len(results) == 2
    assert results[0]["status"] == "success"

    # Check queue status updated
    completed = service.offline_queue.get_queued_requests("dev_offline", status="completed")
    assert len(completed) == 2

    # Clear completed requests
    cleared = service.offline_queue.clear_completed_requests()
    assert cleared == 2
    assert len(service.offline_queue.get_queued_requests()) == 0
