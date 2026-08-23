# Organization Workspaces & Team Collaboration

CmdBar provides built-in Organization Workspaces for teams to share commands, enforce admin controls, track usage analytics, manage billing tiers, host private command registries, and receive automated Slack notifications.

---

## 1. Overview

Organization Workspaces allow engineering teams and organizations to collaborate effectively by sharing command palettes across members with role-based access control (RBAC).

Key Features:
- **Shared Commands & Merged Palettes**: Merge workspace-level command categories with local user shortcuts.
- **Admin Access Controls & Policy**: Role-based permissions (Admin, Member, Viewer) and customizable security policies.
- **Usage Analytics**: Real-time tracking of command execution volume, success/failure rates, top commands, and user activity.
- **Billing Management**: Tiered quotas (Free, Pro, Enterprise) with automatic limit checks for members, commands, and monthly executions.
- **Private Registries**: Publish and distribute reusable command packages within your organization.
- **Slack Integration**: Real-time notifications for command executions, registry publishing, and workspace admin events.

---

## 2. Configuration & Structure

Workspaces are stored within `~/.config/cmdbar/config.json` under the `workspaces` key:

```json
{
  "active_workspace_id": "ws_a1b2c3d4",
  "workspaces": [
    {
      "id": "ws_a1b2c3d4",
      "name": "DevOps Engineering",
      "organization": "Acme Corp",
      "owner_id": "alice_123",
      "plan": "pro",
      "members": [
        { "user_id": "alice_123", "role": "admin", "joined_at": "2026-08-23T10:00:00Z" },
        { "user_id": "bob_456", "role": "member", "joined_at": "2026-08-23T11:00:00Z" }
      ],
      "categories": [
        {
          "name": "Infrastructure",
          "commands": [
            {
              "name": "Restart K8s Ingress",
              "command": "kubectl rollout restart deployment/ingress-nginx -n ingress-nginx"
            }
          ]
        }
      ],
      "slack_config": {
        "enabled": true,
        "webhook_url": "https://hooks.slack.com/services/...",
        "channel": "#cmdbar-alerts"
      }
    }
  ]
}
```

---

## 3. Role-Based Access Control (RBAC)

Each member in a workspace has an assigned role:

| Role | Permissions |
| :--- | :--- |
| **Admin** | Manage workspace settings, members, billing plans, security policies, private registry publishing, Slack integration, and commands. |
| **Member** | Add/edit shared commands, publish packages to private registry, execute commands, view analytics. |
| **Viewer** | Read-only access to shared commands, execution of allowed commands, view analytics. |

---

## 4. Billing Tiers & Quotas

CmdBar supports three billing tiers:

| Plan | Max Members | Max Shared Commands | Max Monthly Executions |
| :--- | :--- | :--- | :--- |
| **Free** | 3 | 10 | 1,000 |
| **Pro** | 25 | 100 | 50,000 |
| **Enterprise** | Unlimited (-1) | Unlimited (-1) | Unlimited (-1) |

---

## 5. Private Command Registries

Workspaces include a private registry to publish and install bundled command packages:

1. **Publish**: Admins and Members can publish command bundles to the workspace registry using `publishToRegistry()`.
2. **Search**: Find packages using keyword queries with `searchRegistry()`.
3. **Install**: Pull package commands directly into user or workspace categories with `installFromRegistry()`.

---

## 6. Slack Integration

Automated Slack Incoming Webhooks keep team members informed of workspace activity:
- **Events**: Command execution, shared command additions, package publishing, and billing plan updates.
- **Payload**: Standard Slack Block Kit messages formatted with event headers, user details, and metadata.
