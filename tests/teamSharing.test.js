import fs from "fs";
import path from "path";
import os from "os";
import {
  ROLES,
  PERMISSIONS,
  checkPermission,
  enforcePermission,
  exportCommandToUrl,
  exportRepositoryToUrl,
  parseShareUrl,
  ActivityFeedManager,
  ConfigVersionControl,
  ApprovalWorkflowManager,
  TeamRepositoryManager,
  TeamSharingService,
} from "../extension/teamSharing.js";

describe("Team Command Sharing Unit Tests", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmdbar-team-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Role-Based Access Control (RBAC)", () => {
    test("checkPermission should correctly validate role permissions", () => {
      expect(checkPermission(ROLES.ADMIN, "manage_roles")).toBe(true);
      expect(checkPermission(ROLES.ADMIN, "share")).toBe(true);

      expect(checkPermission(ROLES.APPROVER, "approve")).toBe(true);
      expect(checkPermission(ROLES.APPROVER, "manage_roles")).toBe(false);

      expect(checkPermission(ROLES.EDITOR, "share")).toBe(true);
      expect(checkPermission(ROLES.EDITOR, "publish_team")).toBe(true);
      expect(checkPermission(ROLES.EDITOR, "approve")).toBe(false);

      expect(checkPermission(ROLES.VIEWER, "view")).toBe(true);
      expect(checkPermission(ROLES.VIEWER, "execute")).toBe(true);
      expect(checkPermission(ROLES.VIEWER, "share")).toBe(false);
      expect(checkPermission(ROLES.VIEWER, "create")).toBe(false);

      expect(checkPermission("unknown_role", "view")).toBe(false);
      expect(checkPermission(null, "view")).toBe(false);
    });

    test("enforcePermission should throw error when permission is denied", () => {
      expect(() => enforcePermission(ROLES.VIEWER, "share")).toThrow(
        "Permission denied: Role 'viewer' is not authorized for 'share'"
      );
      expect(() => enforcePermission(ROLES.EDITOR, "approve")).toThrow();
      expect(() => enforcePermission(ROLES.ADMIN, "share")).not.toThrow();
    });
  });

  describe("URL Command Sharing (Export & Import)", () => {
    test("exportCommandToUrl should produce valid URL string with command payload", () => {
      const cmd = {
        name: "Deploy Service",
        command: "deploy --env staging <service>",
        placeholder: "service",
        category: "Ops",
      };

      const url = exportCommandToUrl(cmd, { author: "alice" });
      expect(url).toContain("cmdbar://share?data=");

      const parsed = parseShareUrl(url);
      expect(parsed.type).toBe("command");
      expect(parsed.data.name).toBe("Deploy Service");
      expect(parsed.data.command).toBe("deploy --env staging <service>");
      expect(parsed.author).toBe("alice");
    });

    test("exportRepositoryToUrl should encode collection of commands", () => {
      const repoData = [
        { name: "Dev Tools", commands: [{ name: "Build", command: "make" }] },
      ];

      const url = exportRepositoryToUrl(repoData, { author: "bob" });
      expect(url).toContain("cmdbar://share?data=");

      const parsed = parseShareUrl(url);
      expect(parsed.type).toBe("repository");
      expect(parsed.data).toEqual(repoData);
      expect(parsed.author).toBe("bob");
    });

    test("parseShareUrl should handle invalid or malformed input", () => {
      expect(() => parseShareUrl(null)).toThrow("Invalid URL string");
      expect(() => parseShareUrl("cmdbar://share")).toThrow("Missing data parameter in share URL");
      expect(() => parseShareUrl("cmdbar://share?data=invalid_base64_json!!!")).toThrow();
    });
  });

  describe("Activity Feed Manager", () => {
    test("should log activities and query with filters", async () => {
      const storagePath = path.join(tempDir, "activity.json");
      const feed = new ActivityFeedManager(storagePath);

      await feed.logActivity("COMMAND_SHARED", "alice", { name: "test1" }, "ops");
      await feed.logActivity("PROPOSAL_SUBMITTED", "bob", { name: "test2" }, "dev");
      await feed.logActivity("COMMAND_SHARED", "alice", { name: "test3" }, "ops");

      const all = await feed.getActivityFeed();
      expect(all.length).toBe(3);

      const aliceOps = await feed.getActivityFeed({ actor: "alice", repositoryId: "ops" });
      expect(aliceOps.length).toBe(2);

      const limited = await feed.getActivityFeed({ limit: 1 });
      expect(limited.length).toBe(1);

      await feed.clearFeed();
      const empty = await feed.getActivityFeed();
      expect(empty.length).toBe(0);
    });
  });

  describe("Config Version Control", () => {
    test("should record revisions, track history, and compute revision diffs", async () => {
      const historyPath = path.join(tempDir, "history.json");
      const vc = new ConfigVersionControl(historyPath);

      const configV1 = {
        categories: [
          {
            name: "Default",
            commands: [{ name: "Echo", command: "echo hello" }],
          },
        ],
      };

      const rev1 = await vc.recordRevision(configV1, "alice", "Initial version");
      expect(rev1.version).toBe(1);

      const configV2 = {
        categories: [
          {
            name: "Default",
            commands: [
              { name: "Echo", command: "echo hello world" }, // modified
              { name: "Build", command: "make build" }, // added
            ],
          },
        ],
      };

      const rev2 = await vc.recordRevision(configV2, "bob", "Added build command and updated echo");
      expect(rev2.version).toBe(2);

      const history = await vc.getHistory();
      expect(history.length).toBe(2);

      const diff = await vc.diffRevisions(rev1.revisionId, rev2.revisionId);
      expect(diff.added.length).toBe(1);
      expect(diff.added[0].name).toBe("Build");
      expect(diff.modified.length).toBe(1);
      expect(diff.modified[0].before.command).toBe("echo hello");
      expect(diff.modified[0].after.command).toBe("echo hello world");
      expect(diff.removed.length).toBe(0);
    });
  });

  describe("Approval Workflow Manager", () => {
    test("should submit, list, approve, and reject proposals", async () => {
      const storagePath = path.join(tempDir, "approvals.json");
      const feed = new ActivityFeedManager(path.join(tempDir, "activity.json"));
      const workflow = new ApprovalWorkflowManager(storagePath, feed);

      const submission = await workflow.submitForApproval({
        command: { name: "Prod Deploy", command: "deploy --prod" },
        category: "Ops",
        submitter: "charlie",
        submitterRole: ROLES.EDITOR,
      });

      expect(submission.status).toBe("pending");

      const pending = await workflow.getPendingSubmissions();
      expect(pending.length).toBe(1);

      // Attempting approve with EDITOR role should throw
      await expect(
        workflow.approveSubmission(submission.submissionId, "editor_user", ROLES.EDITOR)
      ).rejects.toThrow();

      // Approve with APPROVER role
      const approved = await workflow.approveSubmission(
        submission.submissionId,
        "manager_user",
        ROLES.APPROVER,
        "Looks good!"
      );
      expect(approved.status).toBe("approved");

      const pendingAfter = await workflow.getPendingSubmissions();
      expect(pendingAfter.length).toBe(0);
    });

    test("rejectSubmission should reject pending proposal", async () => {
      const storagePath = path.join(tempDir, "approvals.json");
      const workflow = new ApprovalWorkflowManager(storagePath);

      const sub = await workflow.submitForApproval({
        command: { name: "Dangerous Cmd", command: "rm -rf /" },
        submitter: "malicious_user",
      });

      const rejected = await workflow.rejectSubmission(
        sub.submissionId,
        "admin_user",
        ROLES.ADMIN,
        "Unsafe command"
      );

      expect(rejected.status).toBe("rejected");
      expect(rejected.reviewNotes).toBe("Unsafe command");
    });
  });

  describe("Team Repository Manager", () => {
    test("should manage team repositories and publish commands", async () => {
      const storagePath = path.join(tempDir, "repos.json");
      const repoMgr = new TeamRepositoryManager(storagePath);

      const repo = await repoMgr.createRepository(
        { id: "dev-team", name: "Development Team", owner: "admin_user" },
        ROLES.ADMIN
      );
      expect(repo.id).toBe("dev-team");

      const published = await repoMgr.publishCommand(
        "dev-team",
        { name: "Run Tests", command: "npm test" },
        ROLES.ADMIN,
        "dev_lead",
        { requireApproval: false }
      );

      expect(published.status).toBe("published");
      expect(published.command.name).toBe("Run Tests");

      const fetched = await repoMgr.getRepository("dev-team");
      expect(fetched.commands.length).toBe(1);
    });
  });

  describe("TeamSharingService High-Level Integration", () => {
    test("should share and import commands seamlessly", async () => {
      const service = new TeamSharingService({
        baseDir: tempDir,
        userRole: ROLES.ADMIN,
        userName: "team_admin",
      });

      const cmd = { name: "Docker Logs", command: "docker logs -f app", category: "Containers" };
      const url = await service.shareCommand(cmd);

      const initialConfig = { categories: [] };
      const result = await service.importFromUrl(url, initialConfig);

      expect(result.status).toBe("imported");
      expect(result.config.categories.length).toBe(1);
      expect(result.config.categories[0].commands[0].name).toBe("Docker Logs");

      const feed = await service.activityFeed.getActivityFeed();
      expect(feed.length).toBeGreaterThanOrEqual(2); // SHARED and IMPORTED
    });
  });
});
