# Role-Based Access Control (RBAC) Specification & User Guide

CmdBar includes enterprise-grade **Role-Based Access Control (RBAC)** providing granular permissions, admin/user roles, command visibility rules, approval chains, delegation, and an audit trail.

---

## Architecture Overview

RBAC in CmdBar is implemented synchronously across both the JS extension runtime (`extension/rbac.js`) and Python companion service (`app/rbac.py`).

### Key Features
- **Granular Permissions**: Fine-grained capability checks (`commands:view`, `commands:execute`, `commands:approve`, `commands:manage`, `rbac:manage`, `audit:view`, and wildcard `*` or `namespace:*`).
- **Built-in & Custom Roles**: Pre-configured roles (`admin`, `operator`, `user`, `viewer`, `auditor`) and configurable custom roles.
- **Command Visibility Rules**: Restrict command visibility per category or command using `required_role`, `required_permissions`, or `visibility` (`public`, `role-restricted`, `admin-only`, `hidden`).
- **Approval Chains**: Require approver review before executing sensitive commands.
- **Delegation**: Delegate roles or permissions temporarily with explicit expiration times (`expires_at`).
- **Audit Trail**: Every authorization check, execution attempt, approval, delegation, and role change is logged to an audit log.

---

## Default Roles & Permissions

| Role | Default Permissions | Description |
| --- | --- | --- |
| **admin** | `*` | Full administrative access |
| **operator** | `commands:view`, `commands:execute`, `commands:approve` | Execute commands and approve pending requests |
| **user** | `commands:view`, `commands:execute` | Standard user execution |
| **viewer** | `commands:view` | Read-only view of allowed commands |
| **auditor** | `commands:view`, `audit:view` | Access to view commands and audit logs |

---

## Configuration Schema

RBAC settings are defined inside `config.json` under the `rbac` top-level object:

```json
{
  "rbac": {
    "enabled": true,
    "default_role": "user",
    "roles": {
      "admin": {
        "name": "Admin",
        "description": "Administrator with full access",
        "permissions": ["*"]
      },
      "operator": {
        "name": "Operator",
        "description": "Operator with approval access",
        "permissions": ["commands:view", "commands:execute", "commands:approve"]
      }
    },
    "users": {
      "alice": { "role": "admin" },
      "bob": { "role": "operator" }
    },
    "delegations": [
      {
        "id": "del_12345",
        "delegator": "alice",
        "delegatee": "charlie",
        "role": "operator",
        "expires_at": 1700000000000,
        "active": true,
        "reason": "Shift coverage"
      }
    ],
    "approval_requests": [],
    "audit_logs": []
  }
}
```

---

## Command Visibility & Approval Configuration

Commands in `config.json` can specify access control rules:

```json
{
  "name": "Deploy Staging",
  "command": "deploy staging",
  "required_role": "operator",
  "requires_approval": true,
  "visibility": "role-restricted"
}
```

- `visibility`: `"public"` (default), `"role-restricted"`, `"admin-only"`, or `"hidden"`.
- `requires_approval`: `true` forces non-approvers to submit an approval request before command execution.

---

## D-Bus Interface API

The D-Bus service `org.gnome.CmdBar` exposes RBAC endpoints:

- `GetUserRole(username -> role)`: Retrieve user's active role.
- `SetUserRole(username, role -> success)`: Change user role.
- `GetPendingApprovals(-> json_approvals)`: List pending approval requests.
- `ApproveCommand(request_id, reviewer -> success)`: Approve a pending command request.
