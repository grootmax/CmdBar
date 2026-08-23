# Team Command Sharing Developer Specifications

This specification details the technical design and API contracts for Team Command Sharing, Repository Management, Config Version Control, Role-Based Access Control (RBAC), Approval Workflows, and Activity Feed.

## Architectural Overview

Both JavaScript (`extension/teamSharing.js`) and Python (`app/team_sharing.py`) modules provide identical API signatures for cross-platform compatibility across the GNOME Shell extension and companion management app.

### Modules

- `extension/teamSharing.js`: Core ES module for GNOME Shell and Node.js runtime environment.
- `app/team_sharing.py`: Core Python module for companion app, CLI, and PyGObject Libadwaita integration.

## Key APIs

### RBAC Permissions

Roles: `viewer` (1), `editor` (2), `approver` (3), `admin` (4).

- `hasPermission(userRole, action)` / `has_permission(user_role, action)`
- `checkPermission(userRole, action)` / `check_permission(user_role, action)`

### URL Sharing

- `encodeCommandShareUrl(data, options)` / `encode_command_share_url(data, options)`
- `decodeCommandShareUrl(shareUrl, options)` / `decode_command_share_url(share_url, options)`
- `importFromShareUrl(shareUrl, targetCategory, config, userRole)` / `import_from_share_url(share_url, target_category, config, user_role)`

### Team Repository Management

- `addTeamRepository(repoData, config, userRole)` / `add_team_repository(repo_data, config, user_role)`
- `removeTeamRepository(repoId, config, userRole)` / `remove_team_repository(repo_id, config, user_role)`
- `listTeamRepositories(config)` / `list_team_repositories(config)`
- `syncTeamRepository(repoId, config, remoteFetcher, userRole)` / `sync_team_repository(repo_id, config, remote_fetcher, user_role)`

### Version Control for Configs

- `createConfigRevision(config, author, message)` / `create_config_revision(config, author, message)`
- `getRevisionHistory(config)` / `get_revision_history(config)`
- `diffConfigRevisions(snapshotA, snapshotB)` / `diff_config_revisions(snapshot_a, snapshot_b)`
- `rollbackToRevision(config, revisionId, userRole)` / `rollback_to_revision(config, revision_id, user_role)`

### Approval Workflows

- `createProposal(config, params, userRole)` / `create_proposal(config, repo_id, command_data, author, description, user_role)`
- `reviewProposal(config, proposalId, reviewData, reviewerRole)` / `review_proposal(config, proposal_id, status, reviewer, comment, reviewer_role)`
- `mergeProposal(config, proposalId, userRole)` / `merge_proposal(config, proposal_id, user_role)`
- `listProposals(config, filters)` / `list_proposals(config, filters)`

### Activity Feed

- `logActivity(config, eventData)` / `log_activity(config, actor, actor_role, action, target, details, repo_id)`
- `getActivityFeed(config, filters)` / `get_activity_feed(config, filters)`
- `clearActivityFeed(config, userRole)` / `clear_activity_feed(config, user_role)`
