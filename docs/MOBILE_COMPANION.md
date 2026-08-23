# Mobile Companion App

The **CmdBar Mobile Companion App** provides iOS and Android integration for CmdBar. It allows developers to monitor, trigger quick actions, manage widgets, receive push notifications, and authorize sensitive commands securely using biometric authentication from their mobile devices—with full offline support.

---

## Features

1. **iOS and Android Companion Protocol**:
   - Secure device registration and session token authentication.
   - Support for both APNs (Apple Push Notification service) and FCM (Firebase Cloud Messaging).
   - Real-time device state synchronization.

2. **Push Notifications**:
   - Automatic dispatch of execution status, error alerts, and long-running job completions.
   - Platform-formatted payloads for iOS CallKit/notifications and Android Notification Channels.
   - Full notification history tracking and retrieval.

3. **Quick Actions**:
   - Optimized mobile touch shortcuts for common terminal actions.
   - Custom parameters with regex validation.
   - Optional biometric protection per action.

4. **Widget Support**:
   - Formatted data providers for iOS CallKit / LockScreen / Home Screen widgets and Android App Widgets.
   - Support for multiple widget sizes (`small`, `medium`, `large`).
   - Live status views: Quick Actions, System Status, and Recent History.
   - Broadcast background refresh events for instant widget updates.

5. **Biometric Authentication**:
   - Challenge-Response flow using Face ID / Touch ID (iOS) or BiometricPrompt (Android).
   - Nonce-based challenge creation with expiration window.
   - HMAC SHA-256 challenge signature verification.

6. **Offline Queue**:
   - Persistent offline action queue when disconnected from host.
   - Automatic execution, backoff, and state recovery upon reconnection.
   - Clears or retains completed request records on demand.

---

## Architecture & Data Flow

```text
+-----------------------+           +-----------------------+
|  iOS / Android App    |           |  CmdBar Host System   |
|                       |           |                       |
|  - Widgets            |  D-Bus /  |  - MobileCompanion    |
|  - Quick Actions      |  REST API |    Service            |
|  - Biometric Auth     | <=======> |  - Device Manager     |
|  - Offline Queue      |           |  - Push Engine        |
+-----------------------+           |  - Widget Provider    |
                                    +-----------------------+
```

---

## Usage Example (Python API)

```python
from companion.mobile_companion import MobileCompanionService

# Initialize service
service = MobileCompanionService()

# 1. Register a Mobile Device (iOS or Android)
device = service.device_manager.register_device(
    device_id="iphone_dev_1",
    name="Developer iPhone",
    platform="ios",
    push_token="apns_token_xyz123",
    biometric_public_key="bio_pub_key_abc"
)

# 2. Register a Quick Action
service.quick_action_manager.register_quick_action(
    action_id="qa_deploy",
    title="Deploy Staging",
    command_template="make deploy-staging ENV={env}",
    category="DevOps",
    require_biometric=True,
    params_schema={"env": {"regex": "^(staging|dev)$"}}
)

# 3. Biometric Auth Challenge-Response
challenge = service.biometric_handler.generate_challenge("iphone_dev_1")
bio_token = service.biometric_handler.create_biometric_token("iphone_dev_1", challenge["challenge"])

# 4. Execute Quick Action with Biometric Token
result = service.quick_action_manager.execute_quick_action(
    device_id="iphone_dev_1",
    action_id="qa_deploy",
    params={"env": "staging"},
    biometric_token=bio_token
)
print("Execution Result:", result)

# 5. Fetch Mobile Widget Data
widget_data = service.widget_provider.get_widget_data(widget_type="all", size="medium")
print("Widget Payload:", widget_data)
```

---

## Usage Example (JavaScript API)

```javascript
import { MobileCompanionService } from './companion/mobileCompanion.js';

const service = new MobileCompanionService();

// Register Android device
const device = service.deviceManager.registerDevice('pixel_1', 'Developer Pixel 8', 'android', 'fcm_token_123');

// Register Quick Action
service.quickActionManager.registerQuickAction(
    'qa_status',
    'Check Status',
    'systemctl status cmdbar',
    'info',
    'System'
);

// Execute Quick Action
const res = await service.quickActionManager.executeQuickAction('pixel_1', 'qa_status');
console.log('Status result:', res);
```

---

## D-Bus Mobile Companion Endpoints

| Method | Parameters | Return Type | Description |
|--------|------------|-------------|-------------|
| `RegisterMobileDevice` | `string device_id, string name, string platform` | `string` (JSON) | Register iOS or Android device |
| `GetMobileQuickActions` | *None* | `string` (JSON) | List all registered quick actions |
| `ExecuteMobileQuickAction` | `string device_id, string action_id, string params_json, string biometric_token` | `string` (JSON) | Execute quick action |
| `GetMobileWidgetData` | `string widget_type, string device_id, string size` | `string` (JSON) | Fetch widget provider data |
| `ProcessMobileOfflineQueue` | *None* | `string` (JSON) | Drain and process all offline queued requests |

---

## Testing & Quality Assurance

Run Python tests:
```bash
PYTHONPATH=. pytest tests/test_mobile_companion.py
```

Run JavaScript tests:
```bash
npm run test tests/mobileCompanion.test.js
```
