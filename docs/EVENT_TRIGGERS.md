# Event-Based Triggers in CmdBar

CmdBar includes a powerful **Event-Based Trigger Engine** that allows shell commands and top-bar actions to execute automatically in response to file system changes, Git hooks, incoming HTTP webhooks, and system events based on fine-grained conditional rules.

---

## 1. Supported Trigger Types

| Trigger Type | Identifier | Description |
|--------------|------------|-------------|
| **File Watcher** | `file_change` / `file_watch` | Monitors files or directories for creation, modification, or deletion events with configurable debouncing. |
| **Git Hooks** | `git_hook` | Reacts to Git events (`pre-commit`, `post-commit`, `pre-push`, `post-merge`) and can automatically install/uninstall native Git hook scripts. |
| **HTTP Webhook Listener** | `webhook` / `http_request` | Listens for incoming HTTP `POST` or `GET` webhook requests with bearer token, custom header, or HMAC signature authentication. |
| **System Events** | `system_event` | Responds to system-level events such as application startup, idle state, network status change, or custom D-Bus signals. |

---

## 2. Configuration Schema

Triggers are configured under the `"triggers"` array in your active CmdBar configuration (`~/.config/cmdbar/config.json`).

```json
{
  "triggers": [
    {
      "id": "auto_build_on_save",
      "name": "Auto Build TypeScript Files",
      "enabled": true,
      "type": "file_change",
      "config": {
        "path": "/home/user/project/src",
        "events": ["modify", "create"],
        "recursive": true,
        "debounce_ms": 100
      },
      "condition": {
        "all": [
          { "field": "file_ext", "operator": "in", "value": ["ts", "tsx"] },
          { "field": "file_path", "operator": "not_contains", "value": "node_modules" }
        ]
      },
      "action": "npm run build --file={file_name}"
    },
    {
      "id": "deploy_webhook",
      "name": "Deploy Staging via Webhook",
      "enabled": true,
      "type": "webhook",
      "config": {
        "port": 8080,
        "endpoint": "/webhook",
        "secret": "my-secure-token"
      },
      "condition": {
        "field": "payload.branch",
        "operator": "equals",
        "value": "main"
      },
      "action": "deploy --service={payload.service} --commit={payload.commit}"
    }
  ]
}
```

---

## 3. Conditional Logic Engine

The conditional logic engine evaluates event context properties before executing the action.

### Operators
- `equals` / `eq` / `==`: Exact string match.
- `not_equals` / `neq` / `!=`: Inequality.
- `contains` / `includes`: String or array element containment.
- `not_contains`: String or array does not contain value.
- `matches_regex` / `regex`: Regular expression evaluation.
- `greater_than` / `gt` / `less_than` / `lt`: Numeric comparison.
- `greater_equal` / `gte` / `less_equal` / `lte`: Numeric range check.
- `in` / `not_in`: Value in list or target string.
- `is_empty` / `is_not_empty`: Checks for empty string, array, object, or null.

### Nested Combinators
- `"all"`: Evaluates as `AND` (all rules must pass).
- `"any"`: Evaluates as `OR` (at least one rule must pass).
- `"not"`: Evaluates as `NOT` (inverts inner rule).

---

## 4. Parameter Interpolation

Placeholders in action commands are dynamically populated from the event context:
- `{file_path}`, `<file_name>`, `{{file_ext}}`
- `{payload.branch}`, `<payload.commit>`, `{{payload.service}}`
- `{headers.authorization}`, `{query.env}`

---

## 5. D-Bus API Trigger Methods

External CLI tools, scripts, and applications can manage and fire triggers via the `org.gnome.CmdBar` D-Bus interface.

| Method | Parameters | Return Type | Description |
|--------|------------|-------------|-------------|
| `RegisterTrigger` | `string trigger_json` | `boolean` | Registers a new event trigger |
| `UnregisterTrigger` | `string trigger_id` | `boolean` | Unregisters an existing trigger |
| `GetTriggers` | *None* | `string` (JSON) | Retrieves all active triggers |
| `FireEvent` | `string event_type, string context_json` | `string` (JSON) | Fires a custom event across matching triggers |
| `EnableTrigger` | `string trigger_id` | `boolean` | Enables a trigger |
| `DisableTrigger` | `string trigger_id` | `boolean` | Disables a trigger |

### Example Python D-Bus Integration

```python
from companion.dbus_client import CmdBarDBusClient

client = CmdBarDBusClient()

# Register a new webhook trigger dynamically
client.register_trigger({
    "id": "ci_webhook",
    "type": "webhook",
    "config": {"port": 9000, "secret": "ci-secret"},
    "action": "echo CI event received for {payload.repo}"
})

# Fire a custom event
client.fire_event("system_event", {"event_name": "startup"})
```
