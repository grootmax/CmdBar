#!/usr/bin/env python3
"""
CmdBar Mobile Companion App Module.
Provides iOS and Android companion integration, push notifications,
quick actions, widget support, biometric authentication, and offline queue.
"""

import os
import sys
import json
import time
import hmac
import hashlib
import secrets
import re
from typing import Dict, List, Optional, Any, Tuple

from companion.companion_app import (
    load_config,
    save_config,
    run_command_in_shell,
    validate_input,
    substitute_and_quote_command,
)


def get_mobile_config_path() -> str:
    if os.environ.get("CMDBAR_MOBILE_CONFIG_PATH"):
        return os.environ["CMDBAR_MOBILE_CONFIG_PATH"]
    return os.path.expanduser("~/.config/cmdbar/mobile_companion.json")


def load_mobile_config(config_path: Optional[str] = None) -> dict:
    path = config_path or get_mobile_config_path()
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
        except Exception:
            pass
    return {
        "devices": {},
        "quick_actions": {},
        "notifications": [],
        "offline_queue": [],
        "biometric_challenges": {},
        "widget_config": {
            "refresh_interval_sec": 300,
            "theme": "system",
            "pinned_actions": []
        }
    }


def save_mobile_config(data: dict, config_path: Optional[str] = None) -> bool:
    path = config_path or get_mobile_config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = path + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, path)
        return True
    except Exception as e:
        print(f"Error saving mobile config: {e}", file=sys.stderr)
        return False


class DeviceManager:
    def __init__(self, service: "MobileCompanionService"):
        self.service = service

    def register_device(
        self,
        device_id: str,
        name: str,
        platform: str,
        push_token: Optional[str] = None,
        biometric_public_key: Optional[str] = None,
    ) -> dict:
        if not device_id or not isinstance(device_id, str) or not device_id.strip():
            raise ValueError("Device ID cannot be empty.")
        device_id = device_id.strip()

        if not name or not isinstance(name, str) or not name.strip():
            raise ValueError("Device name cannot be empty.")
        name = name.strip()

        platform_clean = str(platform).strip().lower()
        if platform_clean not in ("ios", "android"):
            raise ValueError("Platform must be 'ios' or 'android'.")

        data = self.service.load_data()
        devices = data.setdefault("devices", {})

        existing = devices.get(device_id, {})
        device_token = existing.get("device_token") or secrets.token_hex(32)
        now = time.time()

        device_info = {
            "device_id": device_id,
            "name": name,
            "platform": platform_clean,
            "push_token": push_token or existing.get("push_token"),
            "device_token": device_token,
            "biometric_public_key": biometric_public_key or existing.get("biometric_public_key"),
            "biometric_enrolled": bool(biometric_public_key or existing.get("biometric_public_key")),
            "status": "active",
            "registered_at": existing.get("registered_at", now),
            "last_active_at": now,
        }

        devices[device_id] = device_info
        self.service.save_data(data)
        return device_info

    def unregister_device(self, device_id: str) -> bool:
        data = self.service.load_data()
        devices = data.get("devices", {})
        if device_id in devices:
            del devices[device_id]
            self.service.save_data(data)
            return True
        return False

    def get_device(self, device_id: str) -> Optional[dict]:
        data = self.service.load_data()
        return data.get("devices", {}).get(device_id)

    def list_devices(self) -> List[dict]:
        data = self.service.load_data()
        return list(data.get("devices", {}).values())

    def update_push_token(self, device_id: str, push_token: str) -> bool:
        data = self.service.load_data()
        device = data.get("devices", {}).get(device_id)
        if device:
            device["push_token"] = push_token
            device["last_active_at"] = time.time()
            self.service.save_data(data)
            return True
        return False

    def authenticate_device(self, device_id: str, device_token: str) -> bool:
        device = self.get_device(device_id)
        if not device or device.get("status") != "active":
            return False
        if hmac.compare_digest(device.get("device_token", ""), device_token):
            data = self.service.load_data()
            if device_id in data.get("devices", {}):
                data["devices"][device_id]["last_active_at"] = time.time()
                self.service.save_data(data)
            return True
        return False


class PushNotificationEngine:
    def __init__(self, service: "MobileCompanionService"):
        self.service = service

    def send_notification(
        self,
        device_id: str,
        title: str,
        body: str,
        payload: Optional[dict] = None,
        category: Optional[str] = None,
    ) -> dict:
        device = self.service.device_manager.get_device(device_id)
        if not device:
            raise ValueError(f"Device '{device_id}' not found.")

        push_token = device.get("push_token")
        platform = device.get("platform", "ios")

        now = time.time()
        notif_id = f"notif_{int(now * 1000)}_{secrets.token_hex(4)}"

        if platform == "ios":
            formatted_payload = {
                "aps": {
                    "alert": {"title": title, "body": body},
                    "sound": "default",
                    "category": category or "QUICK_ACTION_RESULT",
                },
                "data": payload or {},
            }
        else:
            formatted_payload = {
                "notification": {"title": title, "body": body},
                "data": payload or {},
                "android": {
                    "priority": "high",
                    "notification": {"channel_id": category or "cmdbar_channel"},
                },
            }

        status = "delivered" if push_token else "queued"

        record = {
            "notification_id": notif_id,
            "device_id": device_id,
            "platform": platform,
            "title": title,
            "body": body,
            "payload": payload or {},
            "category": category,
            "formatted_payload": formatted_payload,
            "status": status,
            "timestamp": now,
        }

        data = self.service.load_data()
        data.setdefault("notifications", []).append(record)
        if len(data["notifications"]) > 200:
            data["notifications"] = data["notifications"][-200:]
        self.service.save_data(data)

        return record

    def broadcast_notification(
        self, title: str, body: str, payload: Optional[dict] = None, category: Optional[str] = None
    ) -> List[dict]:
        devices = self.service.device_manager.list_devices()
        results = []
        for dev in devices:
            if dev.get("status") == "active":
                res = self.send_notification(
                    dev["device_id"], title, body, payload=payload, category=category
                )
                results.append(res)
        return results

    def get_notification_history(
        self, device_id: Optional[str] = None, limit: int = 50
    ) -> List[dict]:
        data = self.service.load_data()
        notifs = data.get("notifications", [])
        if device_id:
            notifs = [n for n in notifs if n.get("device_id") == device_id]
        return notifs[-limit:]


class QuickActionManager:
    def __init__(self, service: "MobileCompanionService"):
        self.service = service

    def register_quick_action(
        self,
        action_id: str,
        title: str,
        command_template: str,
        icon: str = "default",
        category: str = "General",
        require_biometric: bool = False,
        params_schema: Optional[dict] = None,
    ) -> dict:
        if not action_id or not isinstance(action_id, str) or not action_id.strip():
            raise ValueError("Action ID cannot be empty.")
        action_id = action_id.strip()

        if not title or not isinstance(title, str) or not title.strip():
            raise ValueError("Title cannot be empty.")

        if not command_template or not isinstance(command_template, str) or not command_template.strip():
            raise ValueError("Command template cannot be empty.")

        data = self.service.load_data()
        actions = data.setdefault("quick_actions", {})

        action_info = {
            "action_id": action_id,
            "title": title.strip(),
            "command_template": command_template.strip(),
            "icon": icon or "default",
            "category": category or "General",
            "require_biometric": bool(require_biometric),
            "params_schema": params_schema or {},
            "created_at": time.time(),
        }

        actions[action_id] = action_info
        self.service.save_data(data)
        return action_info

    def remove_quick_action(self, action_id: str) -> bool:
        data = self.service.load_data()
        actions = data.get("quick_actions", {})
        if action_id in actions:
            del actions[action_id]
            self.service.save_data(data)
            return True
        return False

    def get_quick_actions(self) -> List[dict]:
        data = self.service.load_data()
        return list(data.get("quick_actions", {}).values())

    def get_quick_action(self, action_id: str) -> Optional[dict]:
        data = self.service.load_data()
        return data.get("quick_actions", {}).get(action_id)

    def execute_quick_action(
        self,
        device_id: str,
        action_id: str,
        params: Optional[dict] = None,
        biometric_token: Optional[str] = None,
    ) -> dict:
        action = self.get_quick_action(action_id)
        if not action:
            return {"status": "error", "message": f"Quick action '{action_id}' not found."}

        if action.get("require_biometric"):
            if not biometric_token or not self.service.biometric_handler.verify_biometric(
                device_id, biometric_token
            ):
                return {
                    "status": "biometric_required",
                    "message": f"Quick action '{action_id}' requires valid biometric authentication.",
                }

        template = action.get("command_template", "")
        params_data = params or {}

        schema = action.get("params_schema", {})
        for param_name, cfg in schema.items():
            pattern = cfg.get("regex")
            val = params_data.get(param_name, "")
            if pattern and not validate_input(val, pattern):
                return {
                    "status": "error",
                    "message": f"Parameter '{param_name}' failed regex validation: {pattern}",
                }

        final_cmd = substitute_and_quote_command(template, params_data)
        code, stdout, stderr = run_command_in_shell(final_cmd)

        res = {
            "status": "success" if code == 0 else "error",
            "action_id": action_id,
            "device_id": device_id,
            "final_command": final_cmd,
            "exit_code": code,
            "stdout": stdout,
            "stderr": stderr,
            "executed_at": time.time(),
        }

        try:
            self.service.push_engine.send_notification(
                device_id,
                title=f"Quick Action: {action.get('title')}",
                body=f"Executed with status code {code}",
                payload={"action_id": action_id, "exit_code": code, "stdout_summary": stdout[:100]},
            )
        except Exception:
            pass

        return res


class WidgetProvider:
    def __init__(self, service: "MobileCompanionService"):
        self.service = service

    def get_widget_data(
        self, widget_type: str = "all", device_id: Optional[str] = None, size: str = "medium"
    ) -> dict:
        widget_type = (widget_type or "all").lower()
        size = (size or "medium").lower()

        data = self.service.load_data()
        actions = list(data.get("quick_actions", {}).values())

        action_limit = 2 if size == "small" else (4 if size == "medium" else 8)
        actions_data = [
            {
                "action_id": a["action_id"],
                "title": a["title"],
                "icon": a["icon"],
                "require_biometric": a["require_biometric"],
                "category": a["category"],
            }
            for a in actions[:action_limit]
        ]

        system_status = {
            "status": "online",
            "active_devices": len([d for d in data.get("devices", {}).values() if d.get("status") == "active"]),
            "pending_offline_queue": len([q for q in data.get("offline_queue", []) if q.get("status") == "queued"]),
            "timestamp": time.time(),
        }

        recent_notifications = data.get("notifications", [])[-5:]
        recent_history = [
            {
                "title": n.get("title"),
                "status": n.get("status"),
                "timestamp": n.get("timestamp"),
            }
            for n in recent_notifications
        ]

        if widget_type == "quick_actions":
            return {"widget_type": "quick_actions", "size": size, "items": actions_data}
        elif widget_type == "system_status":
            return {"widget_type": "system_status", "size": size, "info": system_status}
        elif widget_type == "recent_history":
            return {"widget_type": "recent_history", "size": size, "history": recent_history}
        else:
            return {
                "widget_type": "all",
                "size": size,
                "quick_actions": actions_data,
                "system_status": system_status,
                "recent_history": recent_history,
                "updated_at": time.time(),
            }

    def refresh_widget_data(self, widget_type: str = "all") -> dict:
        widget_payload = self.get_widget_data(widget_type=widget_type)
        self.service.push_engine.broadcast_notification(
            title="Widget Update",
            body="Mobile widget state refreshed.",
            payload={"widget_data": widget_payload},
            category="WIDGET_REFRESH",
        )
        return widget_payload


class BiometricAuthHandler:
    def __init__(self, service: "MobileCompanionService"):
        self.service = service

    def enroll_biometric(self, device_id: str, public_key_or_secret: str) -> bool:
        if not public_key_or_secret:
            return False
        data = self.service.load_data()
        device = data.get("devices", {}).get(device_id)
        if not device:
            return False
        device["biometric_public_key"] = public_key_or_secret
        device["biometric_enrolled"] = True
        self.service.save_data(data)
        return True

    def generate_challenge(self, device_id: str, timeout_seconds: int = 300) -> dict:
        device = self.service.device_manager.get_device(device_id)
        if not device:
            raise ValueError(f"Device '{device_id}' not found.")

        nonce = secrets.token_hex(16)
        expires_at = time.time() + timeout_seconds

        data = self.service.load_data()
        challenges = data.setdefault("biometric_challenges", {})
        challenges[device_id] = {"nonce": nonce, "expires_at": expires_at}
        self.service.save_data(data)

        return {"device_id": device_id, "challenge": nonce, "expires_at": expires_at}

    def create_biometric_token(self, device_id: str, challenge_nonce: str) -> str:
        device = self.service.device_manager.get_device(device_id)
        if not device:
            raise ValueError("Device not found")
        key = device.get("biometric_public_key") or device.get("device_token")
        return hmac.new(key.encode("utf-8"), challenge_nonce.encode("utf-8"), hashlib.sha256).hexdigest()

    def verify_biometric(self, device_id: str, biometric_token: str) -> bool:
        data = self.service.load_data()
        challenge_info = data.get("biometric_challenges", {}).get(device_id)
        if not challenge_info:
            device = self.service.device_manager.get_device(device_id)
            if not device or not device.get("biometric_enrolled"):
                return False
            key = device.get("biometric_public_key") or device.get("device_token")
            expected_fallback = hashlib.sha256(f"biometric_{key}".encode("utf-8")).hexdigest()
            return hmac.compare_digest(expected_fallback, biometric_token)

        if time.time() > challenge_info.get("expires_at", 0):
            del data["biometric_challenges"][device_id]
            self.service.save_data(data)
            return False

        nonce = challenge_info.get("nonce", "")
        device = self.service.device_manager.get_device(device_id)
        if not device:
            return False
        key = device.get("biometric_public_key") or device.get("device_token")
        expected = hmac.new(key.encode("utf-8"), nonce.encode("utf-8"), hashlib.sha256).hexdigest()

        if hmac.compare_digest(expected, biometric_token):
            del data["biometric_challenges"][device_id]
            self.service.save_data(data)
            return True

        return False


class OfflineQueueManager:
    def __init__(self, service: "MobileCompanionService"):
        self.service = service

    def enqueue_request(
        self, device_id: str, action_id: str, params: Optional[dict] = None, nonce: Optional[str] = None
    ) -> dict:
        now = time.time()
        queue_id = f"queue_{int(now * 1000)}_{secrets.token_hex(4)}"

        request_item = {
            "queue_id": queue_id,
            "device_id": device_id,
            "action_id": action_id,
            "params": params or {},
            "nonce": nonce or secrets.token_hex(8),
            "status": "queued",
            "retry_count": 0,
            "created_at": now,
            "processed_at": None,
            "result": None,
        }

        data = self.service.load_data()
        data.setdefault("offline_queue", []).append(request_item)
        self.service.save_data(data)
        return request_item

    def get_queued_requests(
        self, device_id: Optional[str] = None, status: Optional[str] = None
    ) -> List[dict]:
        data = self.service.load_data()
        queue = data.get("offline_queue", [])
        if device_id:
            queue = [item for item in queue if item.get("device_id") == device_id]
        if status:
            queue = [item for item in queue if item.get("status") == status]
        return queue

    def process_queued_request(self, queue_id: str) -> dict:
        data = self.service.load_data()
        queue = data.get("offline_queue", [])

        target_item = None
        for item in queue:
            if item.get("queue_id") == queue_id:
                target_item = item
                break

        if not target_item:
            return {"status": "error", "message": f"Queued request '{queue_id}' not found."}

        target_item["status"] = "processing"
        target_item["retry_count"] += 1
        self.service.save_data(data)

        res = self.service.quick_action_manager.execute_quick_action(
            device_id=target_item["device_id"],
            action_id=target_item["action_id"],
            params=target_item["params"],
        )

        target_item["status"] = "completed" if res.get("status") == "success" else "failed"
        target_item["processed_at"] = time.time()
        target_item["result"] = res

        self.service.save_data(data)
        return res

    def process_all_queued_requests(self) -> List[dict]:
        pending = self.get_queued_requests(status="queued")
        results = []
        for item in pending:
            res = self.process_queued_request(item["queue_id"])
            results.append(res)
        return results

    def clear_completed_requests(self) -> int:
        data = self.service.load_data()
        queue = data.get("offline_queue", [])
        initial_len = len(queue)
        data["offline_queue"] = [item for item in queue if item.get("status") == "queued"]
        self.service.save_data(data)
        return initial_len - len(data["offline_queue"])


class MobileCompanionService:
    def __init__(self, config_path: Optional[str] = None):
        self.config_path = config_path or get_mobile_config_path()
        self.device_manager = DeviceManager(self)
        self.push_engine = PushNotificationEngine(self)
        self.quick_action_manager = QuickActionManager(self)
        self.widget_provider = WidgetProvider(self)
        self.biometric_handler = BiometricAuthHandler(self)
        self.offline_queue = OfflineQueueManager(self)

    def load_data(self) -> dict:
        return load_mobile_config(self.config_path)

    def save_data(self, data: dict) -> bool:
        return save_mobile_config(data, self.config_path)
