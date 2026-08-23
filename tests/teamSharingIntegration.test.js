import fs from "fs";
import path from "path";
import os from "os";
import {
  ROLES,
  TeamSharingService,
  exportCommandToUrl,
  parseShareUrl,
  checkPermission,
} from "../extension/teamSharing.js";
import { loadConfig, saveConfig } from "../extension/configSync.js";

describe("Team Command Sharing End-to-End Integration Tests", () => {
  let tempDir;
  let configPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmdbar-integration-test-"));
    configPath = path.join(tempDir, "config.json");
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("Full Lifecycle: Proposal -> Approval -> Repo Publish -> Share URL -> Import -> Version History & Activity Log", async () => {
    // Initialize Team Sharing Service
    const teamService = new TeamSharingService({
      baseDir: tempDir,
      userRole: ROLES.ADMIN,
      userName: "system_admin",
    });

    // 1. Admin creates a team repository 'devops-team'
    const repo = await teamService.repositoryManager.createRepository(
      {
        id: "devops-team",
        name: "DevOps Team Repo",
        description: "Shared infrastructure and deployment automation commands",
        owner: "system_admin",
      },
      ROLES.ADMIN
    );

    expect(repo.id).toBe("devops-team");

    // 2. Editor user 'dev_dave' proposes a command requiring approval
    const proposedCmd = {
      name: "Scale K8s Deployment",
      command: "kubectl scale deployment {{deployment}} --replicas={{count}}",
      placeholder: "deployment & count",
      category: "Kubernetes",
    };

    const submission = await teamService.repositoryManager.publishCommand(
      "devops-team",
      proposedCmd,
      ROLES.EDITOR,
      "dev_dave",
      { requireApproval: true, notes: "Need scale command for emergency mitigation" }
    );

    expect(submission.submissionId).toBeDefined();
    expect(submission.status).toBe("pending");

    // 3. Approver user 'ops_lead' reviews pending approvals and approves
    const pendingList = await teamService.approvalWorkflow.getPendingSubmissions();
    expect(pendingList.length).toBe(1);
    expect(pendingList[0].submissionId).toBe(submission.submissionId);

    const approvedSub = await teamService.approvalWorkflow.approveSubmission(
      submission.submissionId,
      "ops_lead",
      ROLES.APPROVER,
      "Approved after security verification"
    );

    expect(approvedSub.status).toBe("approved");

    // 4. Publish approved command to repository and active config
    const targetRepo = await teamService.repositoryManager.getRepository("devops-team");
    targetRepo.commands.push({
      ...approvedSub.command,
      isTeamCommand: true,
      repositoryId: "devops-team",
      approvedBy: "ops_lead",
    });

    const activeConfig = {
      categories: [
        {
          name: "Kubernetes",
          commands: [approvedSub.command],
        },
      ],
    };

    await saveConfig(activeConfig, configPath);
    await teamService.versionControl.recordRevision(
      activeConfig,
      "ops_lead",
      "Added approved K8s scaling command"
    );

    // 5. Generate Share URL for the command
    const shareUrl = exportCommandToUrl(approvedSub.command, {
      author: "ops_lead",
      repositoryId: "devops-team",
    });

    expect(shareUrl).toContain("cmdbar://share?data=");

    // 6. User 'qa_quinn' parses URL and imports command into local config
    const parsedPayload = parseShareUrl(shareUrl);
    expect(parsedPayload.type).toBe("command");
    expect(parsedPayload.data.name).toBe("Scale K8s Deployment");

    const loadedConfig = await loadConfig(configPath);
    const importResult = await teamService.importFromUrl(
      shareUrl,
      loadedConfig,
      ROLES.EDITOR
    );

    expect(importResult.status).toBe("imported");
    await saveConfig(importResult.config, configPath);

    // 7. Verify updated config content from disk
    const finalConfig = await loadConfig(configPath);
    const k8sCat = finalConfig.categories.find((c) => c.name === "Kubernetes");
    expect(k8sCat).toBeDefined();
    expect(k8sCat.commands.length).toBeGreaterThanOrEqual(1);

    // 8. Verify Activity Feed entries recorded during lifecycle
    const activityFeed = await teamService.activityFeed.getActivityFeed();
    expect(activityFeed.length).toBeGreaterThanOrEqual(4);

    const actions = activityFeed.map((a) => a.action);
    expect(actions).toContain("REPOSITORY_CREATED");
    expect(actions).toContain("PROPOSAL_SUBMITTED");
    expect(actions).toContain("PROPOSAL_APPROVED");
    expect(actions).toContain("COMMAND_IMPORTED");

    // 9. Verify Config Version Control history
    const history = await teamService.versionControl.getHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);
  });
});
