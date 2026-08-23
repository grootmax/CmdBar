# Enterprise Role-Based Access Control (RBAC) Specification

CmdBar provides a comprehensive Enterprise Role-Based Access Control (RBAC) system supporting granular permissions, admin/user roles, command visibility rules, approval chains, delegation, and structured audit trails.

---

## 1. Overview

The RBAC system ensures that users only view and execute commands for which they hold explicit permissions or active delegated roles. Sensitive operations can mandate multi-step approval chains before execution, while every authorization decision and management action is logged to an immutable audit trail.

---

## 2. Configuration Schema

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
        "permissions": ["command:view", "command:execute", "approval:request"]
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
      "admin": ["admin"],
      "alice": ["admin"],
      "bob": ["user"],
      "charlie": ["operator"],
      "david": ["approver"]
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

## 3. Command Visibility Rules

Commands in `config.json` can specify visibility and access restrictions:

- **`visibility`**:
  - `"public"` (default): Visible to all users.
  - `"role_restricted"`: Requires user to hold at least one role in `allowed_roles`.
  - `"admin_only"`: Only visible to users with `admin` role or `*` permission.
  - `"hidden"`: Hidden from all menus and search queries.
- **`allowed_roles` / `roles`**: List of role strings permitted to see the command.
- **`required_permissions` / `permissions`**: List of permission strings required to see the command.
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

## 4. Approval Chains

For critical commands, `requires_approval: true` mandates that an approval request be created and approved before execution is granted.

- **Request Creation**: When an unauthorized or non-admin user triggers the command, an approval request is generated with `status: "pending"`.
- **Approving**: Users holding an approving role (e.g. `approver` or `admin`) or `command:approve` permission approve the request.
- **Rejection**: Approvers can reject requests with an optional explanation string.
- **Execution Gate**: Once status transitions to `"approved"`, passing the `approval_request_id` grants command execution.

---

## 5. Delegation

Delegation allows users to delegate roles or permissions to another user for a specified duration or until revoked:

- **`delegator`**: User delegating authority.
- **`delegatee`**: User receiving authority.
- **`roles` / `permissions`**: List of delegated roles/permissions.
- **`start_time` / `end_time`**: Delegation validity window. If `end_time` passes, the delegation is automatically marked expired.
- **`status`**: `"active"`, `"revoked"`, or `"expired"`.

---

## 6. Audit Trail

All authorization events, role assignments, approval decisions, delegation updates, and command executions generate structured audit log entries:

- **Querying**: Filter logs by actor, action, resource, outcome, and date ranges.
- **Exports**: Export audit logs in pretty-printed JSON or standard CSV formats for compliance reporting.
