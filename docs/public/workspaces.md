# Organization Workspaces

CmdBar Organization Workspaces enable teams to collaborate efficiently with shared command palettes, role-based access controls, security policy enforcement, usage analytics, tier-based billing management, private registries, and Slack integrations.

## Key Capabilities

### 1. Team Workspaces & Shared Commands
- Create team workspaces per organization.
- Manage team membership with assigned roles: `Admin`, `Member`, and `Viewer`.
- Share command categories across workspace members, automatically merging shared commands into member status bar command palettes.

### 2. Admin Controls & Security Policies
- Define allowed execution modes (`shell-quoted`, `direct-array`).
- Configure prohibited security patterns (e.g., destructive system commands).
- Restrict command modification permissions to workspace Admins.
- Maintain full audit logs of workspace actions (member changes, policy updates, command additions).

### 3. Usage Analytics
- Track command execution events, success/failure rates, average execution duration, and top executed commands.
- Export analytics data in JSON or CSV format.

### 4. Subscription Billing Management
- Support for `Free`, `Pro`, and `Enterprise` plan tiers.
- Enforce seat limits, shared command limits, and feature access according to plan tier.

### 5. Private Registries
- Publish, search, install, and uninstall organization command packages from private registries.
- Automatic cryptographic checksum verification on published command bundles.

### 6. Slack Integration
- Configure Slack webhook notifications for command failures, membership events, and audit alerts.
- Handle Slack slash command simulations (`/cmdbar list`, `/cmdbar stats`, `/cmdbar exec <command>`).
