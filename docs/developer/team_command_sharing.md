# Team Command Sharing & Enterprise Collaboration

The Team Command Sharing module (`extension/teamSharing.js`) provides enterprise collaboration capabilities for CmdBar:

## Key Features

1. **URL Command Sharing**:
   - Commands and repository collections can be exported to shareable `cmdbar://share?data=...` URLs or URL payloads.
   - Incoming URLs are parsed and decoded with integrity checks before importing into local configurations or team repositories.

2. **Team Repositories**:
   - Multi-repository management (`TeamRepositoryManager`) allows organizing commands into team scopes (e.g. `devops-team`, `qa-team`).
   - Distinguishes team commands from local user commands with repository metadata and publisher attribution.

3. **Role-Based Access Control (RBAC)**:
   - Built-in roles: `admin`, `approver`, `editor`, and `viewer`.
   - Granular permission enforcement (`checkPermission` / `enforcePermission`) on sharing, publishing, approving, and rolling back configurations.

4. **Approval Workflows**:
   - Commands submitted by `editor` roles enter a `pending` approval queue (`ApprovalWorkflowManager`).
   - Designated `approver` or `admin` roles can approve or reject pending command proposals with notes.
   - Upon approval, proposed commands automatically publish to the team repository and update active configurations.

5. **Version Control for Configurations**:
   - Snapshot-based version history (`ConfigVersionControl`) records revisions upon configuration changes.
   - Calculates structural diffs (`diffRevisions`) highlighting added, modified, and removed commands across version snapshots.

6. **Activity Feed**:
   - Audit trail (`ActivityFeedManager`) logs enterprise events (e.g., `COMMAND_SHARED`, `PROPOSAL_SUBMITTED`, `PROPOSAL_APPROVED`, `REPOSITORY_CREATED`).
   - Supports filtered querying by actor, action, repository, and time range.

## D-Bus API Methods

The D-Bus interface `org.gnome.CmdBar` is extended with team sharing methods:
- `ShareCommandUrl(s command_json) -> (s url)`
- `ImportCommandFromUrl(s url, s role) -> (b success)`
- `GetPendingApprovals() -> (s json_approvals)`
- `ApproveCommand(s submission_id, s reviewer_role, s notes) -> (b success)`
- `RejectCommand(s submission_id, s reviewer_role, s reason) -> (b success)`
- `GetActivityFeed(i limit) -> (s json_feed)`
- `GetConfigHistory() -> (s json_history)`
