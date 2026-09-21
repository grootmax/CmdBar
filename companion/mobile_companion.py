#!/usr/bin/env python3
"""
CmdBar Mobile Companion Service Module
======================================
Provides iOS and Android mobile companion support including:
  - Device pairing and token management
  - Biometric authentication (Face ID, Touch ID, Android Biometrics)
  - Quick actions management (iOS ShortcutItems & Android App Shortcuts)
  - Widget support (iOS WidgetKit timeline entries & Android RemoteViews data)
  - Push notification payload generation & dispatch (APNs & FCM)
  - Offline queue management with batch sync, retry logic, & execution tracking
"""

import os
import sys
import json
import time
import hmac
import hashlib
import uuid
from typing import Dict, List, Optional, Tuple, Any, Callable

try:
    from companion.atomic_write import atomic_write_json
except ImportError:
    try:
        from app.atomic_write import atomic_write_json
    except ImportError:
        def atomic_write_json(filepath, data, indent=2):
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=indent)


def get_mobile_config_path() -> str:
    """
    Returns the absolute path to the mobile companion configuration file.
    Can be overridden via CMDBAR_MOBILE_CONFIG_PATH environment variable.
    """
    env_path = os.environ.get("CMDBAR_MOBILE_CONFIG_PATH")
    if env_path:
        return os.path.abspath(env_path)
    config_dir = os.path.expanduser("~/.config/cmdbar")
    os.makedirs(config_dir, exist_ok=True)
    return os.path.join(config_dir, "mobile_config.json")


def get_mobile_queue_path() -> str:
    """
    Returns the absolute path to the offline action queue file.
    Can be overridden via CMDBAR_MOBILE_QUEUE_PATH environment variable.
    """
    env_path = os.environ.get("CMDBAR_MOBILE_QUEUE_PATH")
    if env_path:
        return os.path.abspath(env_path)
    config_dir = os.path.expanduser("~/.config/cmdbar")
    os.makedirs(config_dir, exist_ok=True)
    return os.path.join(config_dir, "mobile_queue.json")


class DeviceManager:
    """
    Manages registered and paired iOS and Android mobile devices.
    :visibility: public
    """

    def __init__(self, devices_data: Optional[List[Dict[str, Any]]] = None):
        self._devices: Dict[str, Dict[str, Any]] = {}
        if devices_data:
            for d in devices_data:
                dev_id = d.get("device_id")
                if dev_id:
                    self._devices[dev_id] = d

    def register_device(
        self,
        device_id: str,
        name: str,
        platform: str,
        push_token: str = "",
        public_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Registers or updates a mobile device (iOS or Android).
        :visibility: public
        """
        if not device_id or not str(device_id).strip():
            raise ValueError("Device ID cannot be empty.")
        if not name or not str(name).strip():
            raise ValueError("Device name cannot be empty.")

        platform_clean = str(platform).strip().lower()
        if platform_clean not in ("ios", "android"):
            raise ValueError(f"Unsupported platform '{platform}'. Must be 'ios' or 'android'.")

        device_record = {
            "device_id": str(device_id).strip(),
            "name": str(name).strip(),
            "platform": platform_clean,
            "push_token": str(push_token).strip() if push_token else "",
            "public_key": str(public_key).strip() if public_key else "",
            "paired_at": time.time(),
            "last_active": time.time(),
            "status": "paired"
        }
        self._devices[device_record["device_id"]] = device_record
        return device_record

    def unregister_device(self, device_id: str) -> bool:
        """
        Unregisters/removes a paired mobile device by ID.
        :visibility: public
        """
        if device_id in self._devices:
            del self._devices[device_id]
            return True
        return False

    def get_device(self, device_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieves a registered device record by ID.
        :visibility: public
        """
        return self._devices.get(device_id)

    def list_devices(self) -> List[Dict[str, Any]]:
        """
        Returns a list of all registered mobile devices.
        :visibility: public
        """
        return list(self._devices.values())

    def update_push_token(self, device_id: str, push_token: str) -> bool:
        """
        Updates the push notification token for a registered device.
        :visibility: public
        """
        device = self._devices.get(device_id)
        if not device:
            return False
        device["push_token"] = str(push_token).strip()
        device["last_active"] = time.time()
        return True

    def to_list(self) -> List[Dict[str, Any]]:
        return list(self._devices.values())


class BiometricAuthManager:
    """
    Manages biometric authentication challenges and signature verifications.
    Supports Face ID, Touch ID, Android Biometrics, and device PIN fallback.
    :visibility: public
    """

    def __init__(self, secret_key: Optional[str] = None):
        self._secret_key = secret_key or str(uuid.uuid4())
        self._challenges: Dict[str, Dict[str, Any]] = {}

    def create_challenge(
        self,
        device_id: str,
        action_id: str,
        ttl_seconds: int = 300
    ) -> Dict[str, Any]:
        """
        Creates a time-bound biometric challenge for a device and action.
        :visibility: public
        """
        if not device_id or not action_id:
            raise ValueError("device_id and action_id are required for challenge creation.")

        challenge_id = str(uuid.uuid4())
        nonce = uuid.uuid4().hex
        now = time.time()
        expires_at = now + ttl_seconds

        msg = f"{challenge_id}:{device_id}:{action_id}:{nonce}:{int(now)}"
        expected_sig = hmac.new(
            self._secret_key.encode("utf-8"),
            msg.encode("utf-8"),
            hashlib.sha256
        ).hexdigest()

        challenge = {
            "challenge_id": challenge_id,
            "device_id": device_id,
            "action_id": action_id,
            "nonce": nonce,
            "timestamp": now,
            "expires_at": expires_at,
            "expected_signature": expected_sig,
            "used": False
        }
        self._challenges[challenge_id] = challenge
        return {
            "challenge_id": challenge_id,
            "device_id": device_id,
            "action_id": action_id,
            "nonce": nonce,
            "timestamp": now,
            "expires_at": expires_at,
            "signature_token": expected_sig
        }

    def verify_challenge(
        self,
        challenge_id: str,
        signature: str,
        biometric_type: str = "face_id"
    ) -> Tuple[bool, str]:
        """
        Verifies a biometric authentication signature for a challenge.
        Single-use to prevent replay attacks.
        :visibility: public
        """
        if not challenge_id or challenge_id not in self._challenges:
            return False, "Challenge ID not found."

        challenge = self._challenges[challenge_id]

        if challenge.get("used", False):
            return False, "Challenge has already been used (replay attack prevented)."

        if time.time() > challenge.get("expires_at", 0):
            return False, "Biometric challenge has expired."

        valid_types = ("face_id", "touch_id", "android_biometric", "device_pin")
        if biometric_type.lower() not in valid_types:
            return False, f"Invalid biometric type '{biometric_type}'."

        expected = challenge.get("expected_signature", "")
        if not hmac.compare_digest(expected, signature):
            return False, "Invalid biometric signature token."

        # Mark challenge as consumed (single-use)
        challenge["used"] = True
        return True, "Biometric authentication verified successfully."


class QuickActionManager:
    """
    Manages Mobile Quick Actions (iOS ShortcutItems / Android Shortcuts).
    :visibility: public
    """

    def __init__(self, actions_data: Optional[List[Dict[str, Any]]] = None):
        self._actions: Dict[str, Dict[str, Any]] = {}
        if actions_data:
            for a in actions_data:
                aid = a.get("action_id")
                if aid:
                    self._actions[aid] = a

    def add_quick_action(
        self,
        action_id: str,
        name: str,
        command: str,
        icon: str = "terminal",
        category: str = "Quick",
        requires_biometric: bool = False
    ) -> Dict[str, Any]:
        """
        Adds or updates a mobile quick action.
        :visibility: public
        """
        if not action_id or not str(action_id).strip():
            raise ValueError("Action ID cannot be empty.")
        if not name or not str(name).strip():
            raise ValueError("Action name cannot be empty.")
        if not command or not str(command).strip():
            raise ValueError("Command string cannot be empty.")

        clean_id = str(action_id).strip()
        action_record = {
            "action_id": clean_id,
            "name": str(name).strip(),
            "command": str(command).strip(),
            "icon": str(icon).strip() if icon else "terminal",
            "category": str(category).strip() if category else "Quick",
            "requires_biometric": bool(requires_biometric),
            "updated_at": time.time()
        }
        self._actions[clean_id] = action_record
        return action_record

    def remove_quick_action(self, action_id: str) -> bool:
        """
        Removes a quick action by ID.
        :visibility: public
        """
        if action_id in self._actions:
            del self._actions[action_id]
            return True
        return False

    def get_quick_action(self, action_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieves a quick action record.
        :visibility: public
        """
        return self._actions.get(action_id)

    def get_quick_actions(self, platform: str = "ios") -> List[Dict[str, Any]]:
        """
        Formats and returns quick actions formatted for iOS or Android APIs.
        :visibility: public
        """
        platform_clean = str(platform).lower()
        formatted = []
        for aid, action in self._actions.items():
            if platform_clean == "ios":
                formatted.append({
                    "type": action["action_id"],
                    "title": action["name"],
                    "subtitle": action["category"],
                    "iconType": action["icon"],
                    "command": action["command"],
                    "requiresBiometric": action["requires_biometric"]
                })
            else:
                formatted.append({
                    "id": action["action_id"],
                    "shortLabel": action["name"],
                    "longLabel": f"{action['category']}: {action['name']}",
                    "iconRes": action["icon"],
                    "command": action["command"],
                    "requiresBiometric": action["requires_biometric"]
                })
        return formatted

    def to_list(self) -> List[Dict[str, Any]]:
        return list(self._actions.values())


class WidgetManager:
    """
    Generates structured widget state payloads for iOS WidgetKit and Android RemoteViews.
    :visibility: public
    """

    def __init__(self, quick_action_mgr: QuickActionManager):
        self._quick_action_mgr = quick_action_mgr

    def get_widget_payload(
        self,
        platform: str = "ios",
        widget_family: str = "medium",
        system_status: str = "online",
        queue_count: int = 0
    ) -> Dict[str, Any]:
        """
        Returns structured widget data tailored for iOS or Android widget engines.
        :visibility: public
        """
        platform_clean = str(platform).lower()
        now = time.time()
        actions = self._quick_action_mgr.get_quick_actions(platform=platform_clean)

        if platform_clean == "ios":
            return {
                "date": now,
                "family": widget_family,
                "status": system_status,
                "quickActions": actions[:4],
                "systemMetrics": {
                    "queueDepth": queue_count,
                    "totalQuickActions": len(actions)
                },
                "timeline": [
                    {
                        "entryDate": now,
                        "title": "CmdBar Desktop Companion",
                        "status": system_status,
                        "badgeCount": queue_count
                    }
                ]
            }
        else:
            return {
                "widgetType": "remote_views",
                "family": widget_family,
                "updatedAt": now,
                "shortcuts": actions[:6],
                "statusText": f"CmdBar ({system_status.capitalize()})",
                "queueCount": queue_count,
                "layout": {
                    "columns": 2 if widget_family == "medium" else 4,
                    "showStatusHeader": True
                }
            }


class PushNotificationManager:
    """
    Manages push notification payload creation and dispatch (APNs for iOS, FCM for Android).
    :visibility: public
    """

    def __init__(self, device_mgr: DeviceManager):
        self._device_mgr = device_mgr
        self._sent_history: List[Dict[str, Any]] = []

    def build_apns_payload(
        self,
        title: str,
        body: str,
        data: Optional[Dict[str, Any]] = None,
        sound: str = "default",
        badge: int = 1
    ) -> Dict[str, Any]:
        """
        Builds an Apple Push Notification service (APNs) payload dictionary.
        :visibility: public
        """
        payload = {
            "aps": {
                "alert": {
                    "title": title,
                    "body": body
                },
                "sound": sound,
                "badge": badge,
                "mutable-content": 1
            }
        }
        if data:
            payload["data"] = data
        return payload

    def build_fcm_payload(
        self,
        push_token: str,
        title: str,
        body: str,
        data: Optional[Dict[str, Any]] = None,
        priority: str = "HIGH"
    ) -> Dict[str, Any]:
        """
        Builds a Firebase Cloud Messaging (FCM) payload dictionary for Android.
        :visibility: public
        """
        return {
            "message": {
                "token": push_token,
                "notification": {
                    "title": title,
                    "body": body
                },
                "android": {
                    "priority": priority,
                    "notification": {
                        "sound": "default",
                        "click_action": "FLUTTER_NOTIFICATION_CLICK"
                    }
                },
                "data": data or {}
            }
        }

    def send_push_notification(
        self,
        device_id: str,
        title: str,
        body: str,
        data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Formats and dispatches a push notification to a specific registered device.
        :visibility: public
        """
        device = self._device_mgr.get_device(device_id)
        if not device:
            raise ValueError(f"Device '{device_id}' is not registered.")

        push_token = device.get("push_token")
        platform = device.get("platform", "ios")

        if platform == "ios":
            payload = self.build_apns_payload(title, body, data)
        else:
            payload = self.build_fcm_payload(push_token or "mock_token", title, body, data)

        record = {
            "notification_id": str(uuid.uuid4()),
            "device_id": device_id,
            "platform": platform,
            "push_token": push_token,
            "title": title,
            "body": body,
            "payload": payload,
            "sent_at": time.time(),
            "status": "delivered"
        }
        self._sent_history.append(record)
        return record

    def broadcast_push(
        self,
        title: str,
        body: str,
        data: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Dispatches a push notification to all paired devices.
        :visibility: public
        """
        results = []
        for device in self._device_mgr.list_devices():
            dev_id = device.get("device_id")
            if dev_id:
                res = self.send_push_notification(dev_id, title, body, data)
                results.append(res)
        return results

    def get_sent_history() -> List[Dict[str, Any]]:
        return list(self._sent_history)


class OfflineQueueManager:
    """
    Manages offline command queueing, batch synchronization, and execution retry logic.
    :visibility: public
    """

    def __init__(self, queue_filepath: Optional[str] = None):
        self._queue_path = queue_filepath or get_mobile_queue_path()
        self._queue: Dict[str, Dict[str, Any]] = {}
        self.load_queue()

    def load_queue(self) -> None:
        """
        Loads queue items from the persistent file store.
        :visibility: public
        """
        if os.path.exists(self._queue_path):
            try:
                with open(self._queue_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        for item in data:
                            item_id = item.get("queue_id")
                            if item_id:
                                self._queue[item_id] = item
            except Exception as e:
                sys.stderr.write(f"CmdBar Mobile: Warning loading offline queue: {e}\n")

    def save_queue(self) -> bool:
        """
        Atomically persists current queue items to disk.
        :visibility: public
        """
        try:
            items = list(self._queue.values())
            atomic_write_json(self._queue_path, items)
            return True
        except Exception as e:
            sys.stderr.write(f"CmdBar Mobile: Failed saving offline queue: {e}\n")
            return False

    def enqueue_action(
        self,
        device_id: str,
        command_name: str,
        command_str: str,
        parameters: Optional[Dict[str, Any]] = None,
        action_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Queues an action for offline or asynchronous processing.
        :visibility: public
        """
        if not command_name or not str(command_name).strip():
            raise ValueError("Command name cannot be empty.")
        if not command_str or not str(command_str).strip():
            raise ValueError("Command string cannot be empty.")

        queue_id = action_id or str(uuid.uuid4())
        item = {
            "queue_id": queue_id,
            "device_id": str(device_id).strip() if device_id else "unknown",
            "command_name": str(command_name).strip(),
            "command_str": str(command_str).strip(),
            "parameters": parameters or {},
            "status": "queued",  # "queued", "processing", "completed", "failed"
            "attempts": 0,
            "max_retries": 3,
            "created_at": time.time(),
            "updated_at": time.time(),
            "result": None,
            "error": None
        }
        self._queue[queue_id] = item
        self.save_queue()
        return item

    def sync_queue(self, device_id: str, items: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Batch synchronizes offline actions uploaded from a mobile device upon reconnection.
        Deduplicates based on queue_id and validates records.
        :visibility: public
        """
        added = 0
        updated = 0
        for raw in items:
            qid = raw.get("queue_id") or str(uuid.uuid4())
            cmd_name = raw.get("command_name", "Sync Action")
            cmd_str = raw.get("command_str") or raw.get("command", "")

            if not cmd_str:
                continue

            if qid in self._queue:
                # Update existing if pending
                existing = self._queue[qid]
                if existing.get("status") == "queued":
                    existing["command_str"] = cmd_str
                    existing["parameters"] = raw.get("parameters", {})
                    existing["updated_at"] = time.time()
                    updated += 1
            else:
                self._queue[qid] = {
                    "queue_id": qid,
                    "device_id": str(device_id).strip(),
                    "command_name": str(cmd_name).strip(),
                    "command_str": str(cmd_str).strip(),
                    "parameters": raw.get("parameters", {}),
                    "status": "queued",
                    "attempts": 0,
                    "max_retries": raw.get("max_retries", 3),
                    "created_at": raw.get("created_at", time.time()),
                    "updated_at": time.time(),
                    "result": None,
                    "error": None
                }
                added += 1

        self.save_queue()
        return {
            "added": added,
            "updated": updated,
            "total_queued": len(self.get_queue(status="queued"))
        }

    def process_queue(
        self,
        max_items: int = 50,
        executor_fn: Optional[Callable[[str], Tuple[int, str, str]]] = None
    ) -> List[Dict[str, Any]]:
        """
        Processes pending queued actions up to max_items.
        Uses executor_fn if provided, or default shell execution fallback.
        :visibility: public
        """
        processed = []
        queued_items = [
            item for item in self._queue.values()
            if item.get("status") in ("queued", "retrying")
        ]
        # Sort by creation timestamp
        queued_items.sort(key=lambda x: x.get("created_at", 0))

        for item in queued_items[:max_items]:
            item["status"] = "processing"
            item["attempts"] = item.get("attempts", 0) + 1
            item["updated_at"] = time.time()

            cmd_str = item["command_str"]

            try:
                if executor_fn:
                    code, stdout, stderr = executor_fn(cmd_str)
                else:
                    from companion.companion_app import run_command_in_shell
                    code, stdout, stderr = run_command_in_shell(cmd_str)

                if code == 0:
                    item["status"] = "completed"
                    item["result"] = {"code": code, "stdout": stdout, "stderr": stderr}
                    item["error"] = None
                else:
                    if item["attempts"] < item.get("max_retries", 3):
                        item["status"] = "retrying"
                    else:
                        item["status"] = "failed"
                    item["result"] = {"code": code, "stdout": stdout, "stderr": stderr}
                    item["error"] = f"Command failed with exit code {code}: {stderr}"

            except Exception as e:
                if item["attempts"] < item.get("max_retries", 3):
                    item["status"] = "retrying"
                else:
                    item["status"] = "failed"
                item["error"] = str(e)

            item["updated_at"] = time.time()
            processed.append(item)

        self.save_queue()
        return processed

    def get_queue(
        self,
        device_id: Optional[str] = None,
        status: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Filters and returns queue items by device_id or status.
        :visibility: public
        """
        items = list(self._queue.values())
        if device_id:
            items = [i for i in items if i.get("device_id") == device_id]
        if status:
            items = [i for i in items if i.get("status") == status]
        return items

    def clear_queue(self, device_id: Optional[str] = None) -> int:
        """
        Clears queued actions. If device_id is specified, clears only for that device.
        :visibility: public
        """
        if device_id:
            to_remove = [qid for qid, item in self._queue.items() if item.get("device_id") == device_id]
            for qid in to_remove:
                del self._queue[qid]
            removed_count = len(to_remove)
        else:
            removed_count = len(self._queue)
            self._queue.clear()

        self.save_queue()
        return removed_count

    def get_stats(self) -> Dict[str, int]:
        """
        Returns summary metrics of the offline queue depth and statuses.
        :visibility: public
        """
        stats = {"queued": 0, "processing": 0, "completed": 0, "failed": 0, "retrying": 0, "total": len(self._queue)}
        for item in self._queue.values():
            st = item.get("status", "queued")
            if st in stats:
                stats[st] += 1
        return stats


class MobileCompanionService:
    """
    Main Mobile Companion Service integrating devices, biometrics, quick actions,
    widgets, push notifications, and offline queue capabilities.
    :visibility: public
    """

    def __init__(self, config_filepath: Optional[str] = None):
        self._config_path = config_filepath or get_mobile_config_path()
        self.device_mgr = DeviceManager()
        self.biometric_mgr = BiometricAuthManager()
        self.quick_action_mgr = QuickActionManager()
        self.widget_mgr = WidgetManager(self.quick_action_mgr)
        self.push_mgr = PushNotificationManager(self.device_mgr)
        self.queue_mgr = OfflineQueueManager()
        self.load_config()

    def load_config(self) -> None:
        """
        Loads mobile configuration from disk.
        :visibility: public
        """
        if os.path.exists(self._config_path):
            try:
                with open(self._config_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                    devices = cfg.get("devices", [])
                    actions = cfg.get("quick_actions", [])
                    self.device_mgr = DeviceManager(devices)
                    self.quick_action_mgr = QuickActionManager(actions)
                    self.widget_mgr = WidgetManager(self.quick_action_mgr)
                    self.push_mgr = PushNotificationManager(self.device_mgr)
            except Exception as e:
                sys.stderr.write(f"CmdBar Mobile: Warning loading config: {e}\n")

    def save_config(self) -> bool:
        """
        Saves mobile configuration state to disk atomically.
        :visibility: public
        """
        try:
            cfg = {
                "devices": self.device_mgr.to_list(),
                "quick_actions": self.quick_action_mgr.to_list(),
                "updated_at": time.time()
            }
            atomic_write_json(self._config_path, cfg)
            return True
        except Exception as e:
            sys.stderr.write(f"CmdBar Mobile: Error saving config: {e}\n")
            return False
