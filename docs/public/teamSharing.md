# Team Command Sharing & Collaboration

CmdBar provides enterprise-grade collaboration and team command sharing capabilities.

## Key Capabilities

- **URL Sharing**: Easily share commands or entire command categories using custom `cmdbar://share?data=...` or `https://...` deep links with optional HMAC/SHA-256 integrity verification and expiration timestamps.
- **Team Repositories**: Connect team command repositories to sync shared shortcuts across engineering teams (DevOps, Security, SRE, Frontend).
- **Version Control**: Every configuration update creates a tracked revision snapshot with SHA commit hashes, diff summaries, and one-click rollback.
- **Role-Based Access Control (RBAC)**: Enforces role permissions across `Viewer`, `Editor`, `Approver`, and `Admin` tiers.
- **Approval Workflows**: Editors submit proposed command changes for team repositories, requiring review and approval from Approvers or Admins before merging.
- **Activity Feed**: Comprehensive audit trail logging all sharing, syncing, review, and permission events.
