# CmdBar Policy Enforcement Engine

The **Policy Enforcement Engine** provides enterprise-grade security controls for command execution in CmdBar. It allows administrators and security teams to restrict command access based on Multi-Factor Authentication (MFA), Data Loss Prevention (DLP) rules, Geographic location/IP fencing, and Time-based temporal access windows.

---

## Features Overview

1. **Multi-Factor Authentication (MFA) for Sensitive Ops**:
   - Enforces TOTP (RFC 6238) verification for high-risk or sensitive commands (e.g. `deploy`, `delete`, `kms`, `sudo`, `prod`, `iam`, `secrets`).
   - Supports configurable session TTLs and explicit command sensitivity tagging.

2. **Data Loss Prevention (DLP)**:
   - Scans command strings, parameter arguments, and prompt inputs for sensitive information (AWS Access Keys, Private Keys, SSNs, Credit Card numbers, API Tokens).
   - Configurable response actions: `block` execution, `redact` sensitive strings with `[REDACTED_<CATEGORY>]`, or `warn`.

3. **Geographic Restrictions (Geo-fencing)**:
   - Restricts command execution based on user country code or IP address CIDR ranges.
   - Supports explicit `allowed_countries`, `blocked_countries`, `allowed_ip_ranges`, and `blocked_ip_ranges`.

4. **Time-Based Access Controls**:
   - Limits command execution to designated days of the week and specific UTC time windows (e.g., business hours `08:00` - `18:00` Mon-Fri).
   - Supports overnight/shift access windows.

---

## Configuration Schema

All policy settings are stored under the `"policy"` key in `~/.config/cmdbar/config.json`.

```json
{
  "policy": {
    "enabled": true,
    "mfa": {
      "enabled": true,
      "sensitive_keywords": [
        "deploy", "delete", "destroy", "drop", "sudo",
        "prod", "admin", "kms", "iam", "secrets"
      ],
      "session_ttl_seconds": 300,
      "secret": "JBSWY3DPEHPK3PXP"
    },
    "dlp": {
      "enabled": true,
      "action": "block",
      "patterns": [
        {
          "name": "AWS Access Key",
          "regex": "AKIA[0-9A-Z]{16}",
          "category": "credentials"
        },
        {
          "name": "Private Key",
          "regex": "-----\\s*BEGIN[ A-Z1-9_-]*PRIVATE KEY\\s*-----",
          "category": "crypto"
        },
        {
          "name": "SSN",
          "regex": "\\b\\d{3}-\\d{2}-\\d{4}\\b",
          "category": "pii"
        },
        {
          "name": "Credit Card",
          "regex": "\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\\b",
          "category": "financial"
        }
      ]
    },
    "geo": {
      "enabled": false,
      "allowed_countries": ["US", "CA", "GB", "DE"],
      "blocked_countries": [],
      "allowed_ip_ranges": ["192.168.1.0/24"],
      "blocked_ip_ranges": []
    },
    "time": {
      "enabled": false,
      "allowed_days": ["Mon", "Tue", "Wed", "Thu", "Fri"],
      "start_time": "08:00",
      "end_time": "18:00",
      "timezone": "UTC"
    }
  }
}
```

---

## Usage in Python & JavaScript

### JavaScript Example
```javascript
import { evaluatePolicy, generateTOTP, verifyTOTP } from './extension/policyEngine.js';

const result = evaluatePolicy("deploy service staging", {}, { mfa_token: "123456" });

if (!result.allowed) {
  console.error("Execution blocked:", result.reasons);
} else {
  console.log("Sanitized command:", result.sanitized_command);
}
```

### Python Example
```python
from app.policy_engine import evaluate_policy, verify_totp

result = evaluate_policy("deploy service staging", context={"mfa_token": "123456"})

if not result["allowed"]:
    print("Execution blocked:", result["reasons"])
else:
    print("Sanitized command:", result["sanitized_command"])
```

---

## D-Bus API Method

CmdBar exposes policy evaluation over D-Bus under interface `org.gnome.CmdBar`:

```bash
gdbus call --session \
  --dest org.gnome.CmdBar \
  --object-path /org/gnome/CmdBar \
  --method org.gnome.CmdBar.EvaluatePolicy \
  "deploy production" "{}" '{"mfa_token": "123456"}'
```
