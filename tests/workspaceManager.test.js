import {
  WorkspaceManager,
  WORKSPACE_ROLES,
  PLAN_TIERS,
  PLAN_LIMITS,
} from "../extension/workspaceManager.js";

describe("Organization Workspaces Manager - Unit & Integration Tests", () => {
  let wm;
  const orgId = "org_acme";
  const adminId = "user_admin";
  const memberId = "user_member";
  const viewerId = "user_viewer";

  beforeEach(() => {
    wm = new WorkspaceManager();
  });

  test("Workspace creation with default plan tier (FREE) and owner ADMIN role", () => {
    const ws = wm.createWorkspace({
      name: "Engineering Core",
      description: "Primary engineering team workspace",
      orgId,
      ownerId: adminId,
    });

    expect(ws.id).toBeDefined();
    expect(ws.name).toBe("Engineering Core");
    expect(ws.orgId).toBe(orgId);
    expect(ws.planTier).toBe(PLAN_TIERS.FREE);
    expect(ws.members.length).toBe(1);
    expect(ws.members[0].userId).toBe(adminId);
    expect(ws.members[0].role).toBe(WORKSPACE_ROLES.ADMIN);
    expect(ws.auditLogs.length).toBe(1);
    expect(ws.auditLogs[0].action).toBe("WORKSPACE_CREATED");
  });

  test("Workspace creation fails if name is invalid or orgId/ownerId is missing", () => {
    expect(() =>
      wm.createWorkspace({ name: "", orgId, ownerId: adminId })
    ).toThrow();
    expect(() =>
      wm.createWorkspace({ name: "Valid", orgId: "", ownerId: adminId })
    ).toThrow();
  });

  test("Enforces workspace creation limit based on plan tier", () => {
    wm.createWorkspace({ name: "WS 1", orgId, ownerId: adminId, planTier: "free" });
    expect(() =>
      wm.createWorkspace({ name: "WS 2", orgId, ownerId: adminId, planTier: "free" })
    ).toThrow(/limit reached/i);
  });

  test("Workspace updates and deletion lifecycle", () => {
    const ws = wm.createWorkspace({ name: "Temp WS", orgId, ownerId: adminId });
    expect(wm.getWorkspace(ws.id)).toBeDefined();

    const updated = wm.updateWorkspace(
      ws.id,
      {
        name: "Renamed WS",
        description: "New desc",
        adminSettings: { requireConfirmation: false },
        slackIntegration: { webhookUrl: "https://hooks.slack.com/services/123" },
      },
      adminId
    );
    expect(updated.name).toBe("Renamed WS");
    expect(updated.description).toBe("New desc");
    expect(updated.adminSettings.requireConfirmation).toBe(false);

    // Non-admin update fails
    expect(() => wm.updateWorkspace(ws.id, { name: "Hacked" }, viewerId)).toThrow();

    // Deletion
    expect(() => wm.deleteWorkspace(ws.id, viewerId)).toThrow();
    const deleted = wm.deleteWorkspace(ws.id, adminId);
    expect(deleted).toBe(true);
    expect(wm.getWorkspace(ws.id)).toBeNull();
  });

  test("Member management: add, update role, remove member with permissions and edge cases", () => {
    const ws = wm.createWorkspace({ name: "DevOps", orgId, ownerId: adminId, planTier: "pro" });

    // Add member
    const m = wm.addMember(ws.id, { userId: memberId, role: WORKSPACE_ROLES.MEMBER }, adminId);
    expect(m.userId).toBe(memberId);
    expect(m.role).toBe(WORKSPACE_ROLES.MEMBER);
    expect(wm.hasPermission(ws.id, memberId, WORKSPACE_ROLES.MEMBER)).toBe(true);
    expect(wm.hasPermission(ws.id, memberId, WORKSPACE_ROLES.ADMIN)).toBe(false);

    // Duplicate member fails
    expect(() => wm.addMember(ws.id, { userId: memberId }, adminId)).toThrow(/already a member/i);

    // Non-admin adding member fails
    expect(() => wm.addMember(ws.id, { userId: viewerId }, memberId)).toThrow(/ADMIN/);

    // Update role
    const updated = wm.updateMemberRole(ws.id, memberId, WORKSPACE_ROLES.ADMIN, adminId);
    expect(updated.role).toBe(WORKSPACE_ROLES.ADMIN);
    expect(wm.hasPermission(ws.id, memberId, WORKSPACE_ROLES.ADMIN)).toBe(true);

    // Cannot remove workspace owner
    expect(() => wm.removeMember(ws.id, adminId, adminId)).toThrow(/owner/i);

    // Remove member
    const removed = wm.removeMember(ws.id, memberId, adminId);
    expect(removed).toBe(true);
    expect(wm.hasPermission(ws.id, memberId, WORKSPACE_ROLES.MEMBER)).toBe(false);
  });

  test("Admin policies and shared command management", () => {
    const ws = wm.createWorkspace({ name: "Infra Team", orgId, ownerId: adminId, planTier: "pro" });

    const cmd = {
      name: "Deploy App",
      command: "kubectl apply -f deployment.yaml",
      mode: "shell-quoted",
    };

    wm.addSharedCommand(ws.id, "Deployments", cmd, adminId);
    expect(ws.sharedCategories.length).toBe(1);
    expect(ws.sharedCategories[0].commands.length).toBe(1);

    // Updating existing command
    const updatedCmd = {
      name: "Deploy App",
      command: "kubectl apply -f deployment_v2.yaml",
      mode: "shell-quoted",
    };
    wm.addSharedCommand(ws.id, "Deployments", updatedCmd, adminId);
    expect(ws.sharedCategories[0].commands[0].command).toBe("kubectl apply -f deployment_v2.yaml");

    // Execution mode restriction policy
    ws.adminSettings.allowedExecutionModes = ["direct-array"];
    const blockedModeCmd = { name: "Sh Cmd", command: "echo hi", mode: "shell-quoted" };
    expect(() => wm.addSharedCommand(ws.id, "Deployments", blockedModeCmd, adminId)).toThrow(/Execution mode/i);

    // Allowed hosts restriction policy
    ws.adminSettings.allowedExecutionModes = ["shell-quoted", "direct-array"];
    ws.adminSettings.allowedHosts = ["prod.example.com"];
    const unallowedHostCmd = { name: "Ping Host", command: "ping bad.example.com", mode: "shell-quoted" };
    expect(() => wm.addSharedCommand(ws.id, "Deployments", unallowedHostCmd, adminId)).toThrow(/allowed hosts/i);

    ws.adminSettings.allowedHosts = []; // Reset

    // Command matching prohibited security pattern is blocked
    const dangerousCmd = {
      name: "Nuke All",
      command: "rm -rf /",
      mode: "shell-quoted",
    };
    expect(() =>
      wm.addSharedCommand(ws.id, "Deployments", dangerousCmd, adminId)
    ).toThrow(/blocked by workspace security policy/i);

    // Merge into base config
    const baseConfig = {
      categories: [{ name: "Local Tools", commands: [{ name: "Echo", command: "echo hello" }] }],
    };
    const merged = wm.getMergedConfig(ws.id, baseConfig);
    expect(merged.categories.length).toBe(2);
    expect(merged.categories[1].name).toBe("Deployments");
    expect(merged.categories[1].commands[0].workspaceId).toBe(ws.id);

    // Remove command
    wm.removeSharedCommand(ws.id, "Deployments", "Deploy App", adminId);
    expect(ws.sharedCategories.length).toBe(0);
    expect(wm.removeSharedCommand(ws.id, "Deployments", "Nonexistent", adminId)).toBe(false);
  });

  test("Usage analytics: recording, summary calculation, and CSV/JSON export", () => {
    const ws = wm.createWorkspace({ name: "Analytics Test", orgId, ownerId: adminId });

    wm.recordCommandExecution({
      workspaceId: ws.id,
      commandId: "cmd1",
      commandName: "Build",
      userId: memberId,
      durationMs: 120,
      success: true,
    });

    wm.recordCommandExecution({
      workspaceId: ws.id,
      commandId: "cmd1",
      commandName: "Build",
      userId: memberId,
      durationMs: 150,
      success: false,
      errorMessage: "Compilation error",
    });

    const summary = wm.getAnalyticsSummary(ws.id);
    expect(summary.totalExecutions).toBe(2);
    expect(summary.successful).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.successRate).toBe(50);
    expect(summary.avgDurationMs).toBe(135);

    const csv = wm.exportAnalyticsCSV(ws.id);
    expect(csv).toContain("timestamp,userId,commandName");
    expect(csv).toContain("Compilation error");

    const json = wm.exportAnalyticsJSON(ws.id);
    expect(json).toContain("Build");
  });

  test("Subscription billing management and plan limits", () => {
    const ws = wm.createWorkspace({ name: "Billing Test", orgId, ownerId: adminId, planTier: "free" });

    const check1 = wm.checkPlanLimits(ws.id, "privateRegistry");
    expect(check1.allowed).toBe(false);

    const checkSlack = wm.checkPlanLimits(ws.id, "slackIntegration");
    expect(checkSlack.allowed).toBe(false);

    // Upgrade to enterprise
    wm.updateBillingPlan(ws.id, PLAN_TIERS.ENTERPRISE, { billingEmail: "billing@acme.com" }, adminId);
    expect(ws.planTier).toBe(PLAN_TIERS.ENTERPRISE);

    const check2 = wm.checkPlanLimits(ws.id, "privateRegistry");
    expect(check2.allowed).toBe(true);
  });

  test("Private registry package publishing, searching, installing, and uninstalling", () => {
    const ws = wm.createWorkspace({ name: "Registry WS", orgId, ownerId: adminId, planTier: "enterprise" });

    const pkg = wm.publishPackage(
      ws.id,
      {
        name: "Kubernetes Ops Bundle",
        version: "1.2.0",
        description: "Standard K8s management commands",
        commands: [
          { name: "Get Pods", command: "kubectl get pods", mode: "shell-quoted" },
          { name: "Get Nodes", command: "kubectl get nodes", mode: "shell-quoted" },
        ],
      },
      adminId
    );

    expect(pkg.id).toBeDefined();
    expect(wm.listPackages(ws.id).length).toBe(1);

    const searchRes = wm.searchPackages(ws.id, "k8s");
    expect(searchRes.length).toBe(1);

    // Install package into workspace
    wm.installPackage(ws.id, pkg.id, adminId);
    expect(ws.sharedCategories.some((c) => c.name.includes("Kubernetes Ops Bundle"))).toBe(true);

    // Uninstall package
    wm.uninstallPackage(ws.id, pkg.id, adminId);
    expect(ws.sharedCategories.some((c) => c.name.includes("Kubernetes Ops Bundle"))).toBe(false);
  });

  test("Slack integration: webhook notifications and slash command handler", () => {
    const ws = wm.createWorkspace({ name: "Slack WS", orgId, ownerId: adminId, planTier: "pro" });

    // Webhook payload formatting
    const notif = wm.sendSlackNotification(ws.id, "member_joined", { member: "user_new" });
    expect(notif.text).toContain("Slack WS");
    expect(notif.blocks.length).toBe(2);

    // Event not enabled returns null
    expect(wm.sendSlackNotification(ws.id, "unenabled_event", {})).toBeNull();

    // Slash command handler simulation
    const listResp = wm.handleSlackSlashCommand(ws.id, { text: "list" });
    expect(listResp.text).toContain("CmdBar Workspace Commands");

    const statsResp = wm.handleSlackSlashCommand(ws.id, { text: "stats" });
    expect(statsResp.text).toContain("CmdBar Usage Stats");

    const execResp = wm.handleSlackSlashCommand(ws.id, { text: "exec deploy" });
    expect(execResp.text).toContain("deploy");

    const unknownResp = wm.handleSlackSlashCommand(ws.id, { text: "unknown_cmd" });
    expect(unknownResp.text).toContain("Unknown sub-command");
  });
});
