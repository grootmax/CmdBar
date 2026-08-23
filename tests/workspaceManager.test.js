import {
  WorkspaceManager,
  ROLE_ADMIN,
  ROLE_MEMBER,
  ROLE_VIEWER,
  BILLING_PLANS,
} from "../extension/workspaceManager.js";

describe("WorkspaceManager JS Test Suite", () => {
  let manager;

  beforeEach(() => {
    manager = new WorkspaceManager();
  });

  test("Creates and retrieves workspace", () => {
    const ws = manager.createWorkspace("Dev Team", "user_1", "Acme Inc", "free");
    expect(ws.id).toMatch(/^ws_/);
    expect(ws.name).toBe("Dev Team");
    expect(ws.organization).toBe("Acme Inc");
    expect(ws.owner_id).toBe("user_1");
    expect(ws.members.length).toBe(1);
    expect(ws.members[0].role).toBe(ROLE_ADMIN);

    const retrieved = manager.getWorkspace(ws.id);
    expect(retrieved.name).toBe("Dev Team");
  });

  test("Lists workspaces filtered by user membership", () => {
    const ws1 = manager.createWorkspace("Team Alpha", "alice");
    const ws2 = manager.createWorkspace("Team Beta", "bob");

    expect(manager.listWorkspaces().length).toBe(2);

    const aliceWorkspaces = manager.listWorkspaces("alice");
    expect(aliceWorkspaces.length).toBe(1);
    expect(aliceWorkspaces[0].id).toBe(ws1.id);
  });

  test("Enforces RBAC permissions and member role updates", () => {
    const ws = manager.createWorkspace("Security Ops", "admin_1", "Gov", "pro");
    const wsId = ws.id;

    manager.addMember(wsId, "member_1", ROLE_MEMBER, "admin_1");
    manager.addMember(wsId, "viewer_1", ROLE_VIEWER, "admin_1");

    expect(manager.checkPermission(wsId, "admin_1", "manage_members")).toBe(true);
    expect(manager.checkPermission(wsId, "member_1", "manage_members")).toBe(false);
    expect(manager.checkPermission(wsId, "member_1", "manage_commands")).toBe(true);
    expect(manager.checkPermission(wsId, "viewer_1", "manage_commands")).toBe(false);
    expect(manager.checkPermission(wsId, "viewer_1", "view_analytics")).toBe(true);

    manager.updateMemberRole(wsId, "viewer_1", ROLE_MEMBER, "admin_1");
    expect(manager.checkPermission(wsId, "viewer_1", "manage_commands")).toBe(true);

    expect(() => {
      manager.addMember(wsId, "unauthorized", ROLE_ADMIN, "member_1");
    }).toThrow("Requesting user does not have permission");

    expect(() => {
      manager.removeMember(wsId, "admin_1", "admin_1");
    }).toThrow("Cannot remove workspace owner.");

    expect(manager.removeMember(wsId, "member_1", "admin_1")).toBe(true);
  });

  test("Adds shared commands and merges into user categories", () => {
    const ws = manager.createWorkspace("Cloud Infrastructure", "ops_admin");
    const wsId = ws.id;

    manager.addSharedCommand(
      wsId,
      "AWS Utilities",
      { name: "List S3 Buckets", command: "aws s3 ls" },
      "ops_admin"
    );

    const userConfig = {
      active_workspace_id: wsId,
      categories: [
        {
          name: "Personal",
          commands: [{ name: "Git Status", command: "git status" }],
        },
      ],
    };

    const merged = manager.getMergedCategories(userConfig);
    expect(merged.length).toBe(2);
    expect(merged[0].name).toBe("Personal");
    expect(merged[1].name).toBe("[Cloud Infrastructure] AWS Utilities");
    expect(merged[1].commands[0].is_shared).toBe(true);
  });

  test("Records command execution analytics", () => {
    const ws = manager.createWorkspace("Metrics Workspace", "owner_x");
    const wsId = ws.id;

    manager.recordCommandExecution(wsId, "owner_x", "Deploy API", "CI/CD", "success", 200);
    manager.recordCommandExecution(wsId, "owner_x", "Deploy API", "CI/CD", "failed", 50);
    manager.recordCommandExecution(wsId, "dev_y", "Run Tests", "QA", "success", 120);

    const analytics = manager.getUsageAnalytics(wsId, "owner_x");
    expect(analytics.total_executions).toBe(3);
    expect(analytics.success_count).toBe(2);
    expect(analytics.failure_count).toBe(1);
    expect(analytics.success_rate).toBe(66.67);
    expect(analytics.top_commands["Deploy API"]).toBe(2);
  });

  test("Billing plans and quota limits enforcement", () => {
    const ws = manager.createWorkspace("Free Plan WS", "owner_z", "Org", "free"); // max 3 members
    const wsId = ws.id;

    manager.addMember(wsId, "m1", ROLE_MEMBER, "owner_z");
    manager.addMember(wsId, "m2", ROLE_MEMBER, "owner_z");

    expect(() => {
      manager.addMember(wsId, "m3", ROLE_MEMBER, "owner_z");
    }).toThrow("Workspace member limit reached");

    const upgraded = manager.updateBillingPlan(wsId, "pro", "owner_z");
    expect(upgraded.plan).toBe("pro");
    expect(upgraded.maxMembers).toBe(25);

    manager.addMember(wsId, "m3", ROLE_MEMBER, "owner_z");
    expect(manager.getWorkspace(wsId).members.length).toBe(4);
  });

  test("Private registry package publishing and installation", () => {
    const ws = manager.createWorkspace("Registry WS", "admin_pkg", "Org", "pro");
    const wsId = ws.id;

    const pkg = manager.publishToRegistry(
      wsId,
      "kubectl-helper",
      "Kubernetes Helper Tools",
      "2.1.0",
      [{ name: "K8s Pods", command: "kubectl get pods" }],
      "admin_pkg",
      "K8s pod management scripts"
    );

    expect(pkg.package_id).toBe("kubectl-helper");

    const searchResults = manager.searchRegistry(wsId, "kubernetes");
    expect(searchResults.length).toBe(1);

    const userCfg = { categories: [] };
    const updated = manager.installFromRegistry(wsId, "kubectl-helper", userCfg);
    expect(updated.categories.length).toBe(1);
    expect(updated.categories[0].name).toBe("Registry: Kubernetes Helper Tools");
  });

  test("Slack integration configuration and payload formatting", () => {
    const ws = manager.createWorkspace("Slack WS", "slack_owner", "Org", "enterprise");
    const wsId = ws.id;

    const slackConfig = manager.configureSlack(
      wsId,
      "https://hooks.slack.com/services/TEST/123/ABC",
      "#deployments",
      true,
      ["command_execution"],
      "slack_owner"
    );

    expect(slackConfig.enabled).toBe(true);
    expect(slackConfig.channel).toBe("#deployments");

    const payload = manager.formatSlackPayload(
      wsId,
      "command_execution",
      "User 'dev_user' ran command 'make build'",
      { status: "success", duration: "100ms" }
    );

    expect(payload.channel).toBe("#deployments");
    expect(payload.text).toContain("Slack WS");
    expect(payload.blocks.length).toBe(3);
  });

  test("Performance benchmark for category merging", () => {
    const ws = manager.createWorkspace("Benchmark WS", "bench_owner", "Org", "enterprise");
    const wsId = ws.id;

    for (let i = 0; i < 50; i++) {
      manager.addSharedCommand(
        wsId,
        `Category_${i % 5}`,
        { name: `Cmd_${i}`, command: `echo ${i}` },
        "bench_owner"
      );
    }

    const userConfig = { active_workspace_id: wsId, categories: [] };

    const startTime = performance.now();
    for (let i = 0; i < 200; i++) {
      manager.getMergedCategories(userConfig);
    }
    const elapsed = performance.now() - startTime;

    // 200 category merges should complete under 500ms
    expect(elapsed).toBeLessThan(500);
  });
});
