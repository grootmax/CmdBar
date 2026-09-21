# Enterprise Role-Based Access Control (RBAC) Specification & User Guide

CmdBar provides a comprehensive Enterprise Role-Based Access Control (RBAC) system supporting granular permissions, admin/user roles, command visibility rules, approval chains, delegation, and structured audit trails.

---

## 1. Overview & Architecture

RBAC in CmdBar is implemented synchronously across both the JS extension runtime (`extension/rbac.js`) and Python companion service (`app/rbac.py` / `companion/rbac.py`).

### Key Features
- **Granular Permissions**: Fine-grained capability checks (`commands:view`, `commands:execute`, `commands:approve`, `commands:manage`, `rbac:manage`, `audit:view`, and wildcard `*` or `namespace:*`).
- **Built-in & Custom Roles**: Pre-configured roles (`admin`, `operator`, `user`, `viewer`, `auditor`) and configurable custom roles.
- **Command Visibility Rules**: Restrict command visibility per category or command using `required_role`, `required_permissions`, `allowed_roles`, or `visibility` (`public`, `role_restricted`, `admin_only`, `hidden`).
- **Approval Chains**: Require approver review before executing sensitive commands.
- **Delegation**: Delegate roles or permissions temporarily with explicit expiration times (`expires_at` / `end_time`).
- **Audit Trail**: Every authorization check, execution attempt, approval, delegation, and role change is logged to a structured audit log exportable to JSON and CSV.

---

## 2. Default Roles & Permissions

| Role | Default Permissions | Description |
| --- | --- | --- |
| **admin** | `*` | Full administrative access with wildcard permissions |
| **operator** | `commands:view`, `commands:execute`, `commands:approve` | Command execution and approval authorization |
| **user** | `commands:view`, `commands:execute` | Standard command viewing and execution rights |
| **viewer** | `commands:view` | Read-only view of allowed commands |
| **auditor** | `commands:view`, `audit:view` | Access to view commands and audit logs |

---

## 3. Configuration Schema

The RBAC state is embedded within the primary `config.json` file under the `"rbac"` key:

```json
{
  "rbac": {
    "enabled": true,
    "default_role": "user",
    "roles": {
      "admin": {
        "name": "Administrator",
        "description": "Full system access with wildcard permissions",
        "permissions": ["*"]
      },
      "user": {
        "name": "Standard User",
        "description": "Standard command viewing and execution rights",
        "permissions": ["command:view", "command:execute"]
      },
      "operator": {
        "name": "Operator",
        "description": "Execution, viewing, and approval requesting capabilities",
        "permissions": ["command:view", "command:execute", "approval:request", "commands:approve"]
      },
      "approver": {
        "name": "Approver",
        "description": "Command viewing and approval chain authorization",
        "permissions": ["command:view", "command:approve"]
      },
      "auditor": {
        "name": "Auditor",
        "description": "Read-only access to commands and audit logs",
        "permissions": ["command:view", "audit:read"]
      }
    },
    "user_roles": {
      "alice": ["admin"],
      "bob": ["user"],
      "charlie": ["operator"],
      "david": ["approver"]
    },
    "users": {
      "alice": { "role": "admin" },
      "bob": { "role": "operator" }
    },
    "user_permissions": {
      "bob": ["command:execute:staging"]
    },
    "delegations": [],
    "approval_requests": [],
    "audit_logs": []
  }
}
```

---

## 4. Command Visibility Rules

Commands in `config.json` can specify visibility and access restrictions:

- **`visibility`**:
  - `"public"` (default): Visible to all users.
  - `"role_restricted"` / `"role-restricted"`: Requires user to hold at least one role in `allowed_roles` or `required_role`.
  - `"admin_only"` / `"admin-only"`: Only visible to users with `admin` role or `*` permission.
  - `"hidden"`: Hidden from all menus and search queries.
- **`allowed_roles` / `roles` / `required_role`**: Role(s) permitted to see the command.
- **`required_permissions` / `permissions` / `required_permission`**: Permission string(s) required to see the command.
- **`min_role`**: Minimum required role level.

### Example Restricted Command:

```json
{
  "name": "Scale Production ECS Service",
  "command": "aws ecs update-service --service prod --desired-count <count>",
  "visibility": "role_restricted",
  "allowed_roles": ["admin", "operator"],
  "requires_approval": true,
  "approval_chain": ["approver"]
}
```

---

## 5. Approval Chains

For critical commands, `requires_approval: true` mandates that an approval request be created and approved before execution is granted.

- **Request Creation**: When an unauthorized or non-admin user triggers the command, an approval request is generated with `status: "pending"`.
- **Approving**: Users holding an approving role (e.g. `approver` or `admin`) or `commands:approve` permission approve the request.
- **Rejection**: Approvers can reject requests with an optional explanation string.
- **Execution Gate**: Once status transitions to `"approved"`, passing the `approval_request_id` grants command execution.

---

## 6. Delegation

Delegation allows users to delegate roles or permissions to another user for a specified duration or until revoked:

- **`delegator`**: User delegating authority.
- **`delegatee`**: User receiving authority.
- **`roles` / `permissions`**: List of delegated roles/permissions.
- **`start_time` / `end_time`**: Delegation validity window. If `end_time` passes, the delegation is automatically marked expired.
- **`status`**: `"active"`, `"revoked"`, or `"expired"`.

---

## 7. Audit Trail

All authorization events, role assignments, approval decisions, delegation updates, and command executions generate structured audit log entries:

- **Querying**: Filter logs by actor, action, resource, outcome, and date ranges.
- **Exports**: Export audit logs in pretty-printed JSON or standard CSV formats for compliance reporting.

---

## 8. D-Bus Interface API

The D-Bus service `org.gnome.CmdBar` exposes RBAC endpoints:

- `GetUserRole(username -> role)`: Retrieve user's active role.
- `SetUserRole(username, role -> success)`: Change user role.
- `GetPendingApprovals(-> json_approvals)`: List pending approval requests.
- `ApproveCommand(request_id, reviewer -> success)`: Approve a pending command request.
- `RejectCommand(submission_id, reviewer_role, reason -> success)`: Reject a pending command request.
