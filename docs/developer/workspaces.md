# Organization Workspaces Developer Guide

This document covers the architectural design and API contracts for CmdBar Organization Workspaces (`WorkspaceManager`).

## Architecture Overview

Organization Workspaces are implemented natively across both JavaScript (`extension/workspaceManager.js`) and Python (`app/workspace_manager.py` / `companion/workspace_manager.py`).

### Data Structures

- **Workspace Object**: Contains workspace ID, name, description, orgId, ownerId, planTier, status, members list, shared categories, admin settings, audit logs, billing details, private registry config, and Slack integration settings.
- **Roles & Permissions**:
  - `Admin`: Full workspace management, member role updates, package publishing/installation, billing updates.
  - `Member`: Execute commands and manage shared commands (unless Admin-only policy is enforced).
  - `Viewer`: View and execute shared commands only.
- **Plan Tiers**:
  - `Free`: 1 workspace, 5 seats, 10 shared commands.
  - `Pro`: 5 workspaces, 25 seats, 100 shared commands, Slack integration.
  - `Enterprise`: Unlimited workspaces, seats, and commands, Private Registries, Slack integration.

## Module Exports

- `WorkspaceManager`: Core manager class providing workspace lifecycle, membership, policy validation, analytics, billing, private registry, and Slack handling.
- `WORKSPACE_ROLES`: Enums for `ADMIN`, `MEMBER`, `VIEWER`.
- `PLAN_TIERS`: Enums for `FREE`, `PRO`, `ENTERPRISE`.
- `PLAN_LIMITS`: Capacity thresholds per plan tier.
