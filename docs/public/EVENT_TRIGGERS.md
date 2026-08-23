# Event-Based Triggers Guide

CmdBar provides automated Event-Based Triggers to run commands automatically when events occur.

## Key Features

- **File Watchers**: Run commands automatically when files in a project folder are saved, created, or deleted.
- **Git Hooks**: Execute tasks on git events like `pre-commit`, `post-commit`, or `pre-push`.
- **Webhooks**: Receive HTTP requests from GitHub, GitLab, or CI/CD services with secret token and HMAC SHA-256 signature verification.
- **System Events**: Automate actions on timers, desktop startup, or system resume.
- **Conditional Logic**: Filter events using conditions (e.g. branch matching, file extension filters, or header matching) before running commands.

## Configuration Example

```json
{
  "triggers": [
    {
      "id": "autobuild_on_save",
      "name": "Auto Build on Save",
      "type": "file_watcher",
      "enabled": true,
      "target_command": "make build FILE={{file_name}}",
      "config": {
        "path": "/home/user/projects/my-app/src",
        "events": ["modify", "create"],
        "recursive": true
      },
      "conditions": [
        {
          "field": "file_name",
          "operator": "ends_with",
          "value": ".js"
        }
      ]
    }
  ]
}
```
