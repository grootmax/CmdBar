# Event-Based Triggers Architecture

CmdBar features a high-performance Event-Based Trigger Engine supporting file watchers, git hooks, HTTP webhooks, and system events with flexible conditional logic.

## Overview

Event-Based Triggers allow users to automatically run configured CmdBar actions when external or system events occur.

### Core Trigger Types

1. **File Watchers (`file_watcher` / `file_change`)**:
   - Monitors target files or directories for creation, modification, or deletion events.
   - Context variables: `{{file_path}}`, `{{file_name}}`, `{{dir_path}}`, `{{file_event}}`.

2. **Git Hooks (`git_hook`)**:
   - Triggers on git hook invocations (`pre-commit`, `post-commit`, `post-merge`, `pre-push`, `post-checkout`).
   - Generates shell script stubs for easy hook installation.
   - Context variables: `{{git_hook}}`, `{{git_repo}}`, `{{git_branch}}`, `{{git_commit}}`.

3. **HTTP Webhooks (`webhook` / `http_request`)**:
   - Listens for incoming HTTP GET/POST/PUT requests.
   - Supports HMAC-SHA256 signature verification (`X-Hub-Signature-256`) and secret token headers.
   - Context variables: `{{http_method}}`, `{{http_path}}`, `{{http_body.<key>}}`, `{{http_query.<key>}}`.

4. **System Events (`system_event` / `timer`)**:
   - Fires on system events such as timers, startup, network state change, or suspend/resume.
   - Context variables: `{{event_name}}`, `{{timestamp}}`.

## Conditional Logic

Triggers evaluate conditions before executing target commands. Supported operators include:
- `equals`, `not_equals`
- `contains`, `not_contains`
- `starts_with`, `ends_with`
- `regex` / `matches`
- `gt`, `lt`, `gte`, `lte`
- `in`, `not_in`
- `exists`, `not_exists`

Compound conditions support `and` / `or` logical compounding.

## D-Bus Integration

External scripts and tools can invoke triggers remotely via D-Bus:
- `TriggerEvent(event_type, payload_json)`
- `GetTriggers()`
- `AddTrigger(trigger_json)`
- `RemoveTrigger(trigger_id)`
- Signal: `EventTriggered(trigger_id, event_type, command, success)`
