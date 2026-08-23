import {
  ROLES,
  PERMISSIONS,
  hasPermission,
  checkPermission,
  sha256Hex,
  encodeCommandShareUrl,
  decodeCommandShareUrl,
  importFromShareUrl,
  addTeamRepository,
  removeTeamRepository,
  listTeamRepositories,
  syncTeamRepository,
  createConfigRevision,
  getRevisionHistory,
  diffConfigRevisions,
  rollbackToRevision,
  createProposal,
  reviewProposal,
  mergeProposal,
  listProposals,
  logActivity,
  getActivityFeed,
  clearActivityFeed,
} from "../extension/teamSharing.js";

describe("Team Command Sharing - RBAC Permissions", () => {
  test("Role hierarchy permits appropriate actions", () => {
    expect(hasPermission("viewer", "VIEW")).toBe(true);
    expect(hasPermission("viewer", "EXECUTE")).toBe(true);
    expect(hasPermission("viewer", "CREATE_COMMAND")).toBe(false);
    expect(hasPermission("viewer", "MANAGE_REPOS")).toBe(false);

    expect(hasPermission("editor", "CREATE_COMMAND")).toBe(true);
    expect(hasPermission("editor", "PROPOSE_CHANGE")).toBe(true);
    expect(hasPermission("editor", "APPROVE_PROPOSAL")).toBe(false);

    expect(hasPermission("approver", "APPROVE_PROPOSAL")).toBe(true);
    expect(hasPermission("approver", "REJECT_PROPOSAL")).toBe(true);
    expect(hasPermission("approver", "MANAGE_REPOS")).toBe(false);

    expect(hasPermission("admin", "MANAGE_REPOS")).toBe(true);
    expect(hasPermission("admin", "ROLLBACK_VERSION")).toBe(true);
  });

  test("checkPermission throws error when role is unauthorized", () => {
    expect(() => checkPermission("viewer", "MANAGE_REPOS")).toThrow(
      /Permission denied/
    );
    expect(checkPermission("admin", "MANAGE_REPOS")).toBe(true);
  });
});

describe("Team Command Sharing - URL Sharing & Deep Linking", () => {
  const sampleCommand = {
    name: "Deploy Production",
    command: "kubectl rollout status deployment/web",
    placeholder: "env",
  };

  test("encodeCommandShareUrl and decodeCommandShareUrl round-trip cleanly", () => {
    const url = encodeCommandShareUrl(sampleCommand, {
      scheme: "cmdbar://share",
      secretKey: "secret123",
    });

    expect(url).toContain("cmdbar://share?data=");
    expect(url).toContain("&sig=");

    const decoded = decodeCommandShareUrl(url, { secretKey: "secret123" });
    expect(decoded.valid).toBe(true);
    expect(decoded.type).toBe("command");
    expect(decoded.data.name).toBe(sampleCommand.name);
    expect(decoded.data.command).toBe(sampleCommand.command);
  });

  test("HTTPS scheme encoding/decoding works", () => {
    const url = encodeCommandShareUrl(sampleCommand, {
      scheme: "https://cmdbar.io/share",
    });

    expect(url.startsWith("https://cmdbar.io/share?")).toBe(true);
    const decoded = decodeCommandShareUrl(url);
    expect(decoded.valid).toBe(true);
    expect(decoded.data.name).toBe(sampleCommand.name);
  });

  test("Expired share URLs are rejected", async () => {
    const url = encodeCommandShareUrl(sampleCommand, {
      expiresInSeconds: -10, // already expired
    });

    const decoded = decodeCommandShareUrl(url);
    expect(decoded.valid).toBe(false);
    expect(decoded.error).toContain("expired");
  });

  test("Malformed or invalid share URLs return error response", () => {
    expect(decodeCommandShareUrl("invalid-url").valid).toBe(false);
    expect(decodeCommandShareUrl("cmdbar://share").valid).toBe(false);
    expect(decodeCommandShareUrl("cmdbar://share?data=invalidbase64").valid).toBe(false);
  });

  test("importFromShareUrl imports command into target category", () => {
    const url = encodeCommandShareUrl(sampleCommand);
    const initialConfig = { categories: [] };

    const result = importFromShareUrl(url, "Shared Workflows", initialConfig, "viewer");
    expect(result.importedCount).toBe(1);
    expect(result.config.categories.length).toBe(1);
    expect(result.config.categories[0].name).toBe("Shared Workflows");
    expect(result.config.categories[0].commands[0].name).toBe("Deploy Production");
  });
});

describe("Team Command Sharing - Repository Management & Sync", () => {
  const initialConfig = { categories: [], teamRepositories: [] };

  test("addTeamRepository registers a new team repo", () => {
    const repoData = {
      id: "devops-repo",
      name: "DevOps Core",
      url: "https://github.com/myorg/cmdbar-devops.git",
      branch: "main",
    };

    const config = addTeamRepository(repoData, initialConfig, "admin");
    const repos = listTeamRepositories(config);
    expect(repos.length).toBe(1);
    expect(repos[0].id).toBe("devops-repo");
    expect(repos[0].name).toBe("DevOps Core");
  });

  test("syncTeamRepository syncs commands into team category", async () => {
    let config = addTeamRepository(
      { id: "sre-repo", name: "SRE Tools" },
      initialConfig,
      "admin"
    );

    const mockFetcher = async (repo) => [
      { name: "Check Logs", command: "kubectl logs -f deployment/api" },
      { name: "Restart Pods", command: "kubectl rollout restart deployment/api" },
    ];

    const syncRes = await syncTeamRepository("sre-repo", config, mockFetcher, "viewer");
    expect(syncRes.syncedCount).toBe(2);

    const teamCat = syncRes.config.categories.find((c) => c.name === "Team: SRE Tools");
    expect(teamCat).toBeDefined();
    expect(teamCat.commands.length).toBe(2);
    expect(teamCat.commands[0].name).toBe("Check Logs");
  });

  test("removeTeamRepository removes repository and synced category", () => {
    let config = addTeamRepository(
      { id: "temp-repo", name: "Temp Repo" },
      initialConfig,
      "admin"
    );
    config.categories.push({ name: "Team: Temp Repo", commands: [] });

    const updated = removeTeamRepository("temp-repo", config, "admin");
    expect(listTeamRepositories(updated).length).toBe(0);
    expect(updated.categories.some((c) => c.name === "Team: Temp Repo")).toBe(false);
  });
});

describe("Team Command Sharing - Version Control for Configs", () => {
  test("createConfigRevision tracks config revisions with commit SHA and diffs", () => {
    const baseConfig = {
      categories: [
        { name: "Dev", commands: [{ name: "Test", command: "npm test" }] },
      ],
    };

    const rev1 = createConfigRevision(baseConfig, "alice@org.com", "Initial setup");
    const history = getRevisionHistory(rev1);

    expect(history.length).toBe(1);
    expect(history[0].revision).toBe(1);
    expect(history[0].author).toBe("alice@org.com");
    expect(history[0].commitHash.length).toBe(64);

    // Make a change and create second revision
    rev1.categories[0].commands.push({ name: "Lint", command: "npm run lint" });
    const rev2 = createConfigRevision(rev1, "bob@org.com", "Added lint command");
    const history2 = getRevisionHistory(rev2);

    expect(history2.length).toBe(2);
    expect(history2[1].diffSummary.addedCommands).toBe(1);
  });

  test("rollbackToRevision restores configuration to chosen revision", () => {
    let config = {
      categories: [
        { name: "Original", commands: [{ name: "v1", command: "echo 1" }] },
      ],
    };

    config = createConfigRevision(config, "alice", "Rev 1");

    // Modify config
    config.categories = [
      { name: "Modified", commands: [{ name: "v2", command: "echo 2" }] },
    ];
    config = createConfigRevision(config, "bob", "Rev 2");

    expect(config.categories[0].name).toBe("Modified");

    // Rollback to Rev 1
    const rolledBack = rollbackToRevision(config, 1, "admin");
    expect(rolledBack.categories[0].name).toBe("Original");
    expect(rolledBack.categories[0].commands[0].name).toBe("v1");
  });
});

describe("Team Command Sharing - Approval Workflows", () => {
  test("Full proposal lifecycle: create -> review -> merge", () => {
    let config = addTeamRepository(
      { id: "frontend", name: "Frontend Team" },
      { categories: [] },
      "admin"
    );

    const proposedCmd = {
      name: "Start Next Dev",
      command: "npm run dev",
    };

    // 1. Editor submits proposal
    const propRes = createProposal(
      config,
      {
        repoId: "frontend",
        commandData: proposedCmd,
        author: "charlie@org.com",
        description: "Add next.js dev runner",
      },
      "editor"
    );

    config = propRes.config;
    const propId = propRes.proposal.id;
    expect(propRes.proposal.status).toBe("pending");

    // Verify in pending list
    const pendingProps = listProposals(config, { status: "pending" });
    expect(pendingProps.length).toBe(1);

    // 2. Approver approves proposal
    const reviewRes = reviewProposal(
      config,
      propId,
      { status: "approved", reviewer: "diana@org.com", comment: "Looks great" },
      "approver"
    );

    config = reviewRes.config;
    expect(reviewRes.proposal.status).toBe("approved");

    // 3. Merge proposal
    const mergedConfig = mergeProposal(config, propId, "approver");
    const teamCat = mergedConfig.categories.find((c) => c.name === "Team: Frontend Team");

    expect(teamCat).toBeDefined();
    expect(teamCat.commands.some((c) => c.name === "Start Next Dev")).toBe(true);
  });

  test("Rejected proposal cannot be merged", () => {
    let config = addTeamRepository(
      { id: "sec", name: "Security Team" },
      { categories: [] },
      "admin"
    );

    const propRes = createProposal(
      config,
      {
        repoId: "sec",
        commandData: { name: "Root Shell", command: "sudo su" },
        author: "evil@org.com",
      },
      "editor"
    );

    config = propRes.config;
    const propId = propRes.proposal.id;

    const rejectRes = reviewProposal(
      config,
      propId,
      { status: "rejected", reviewer: "security@org.com", comment: "No root shells!" },
      "approver"
    );

    config = rejectRes.config;
    expect(() => mergeProposal(config, propId, "approver")).toThrow(/must be approved/);
  });
});

describe("Team Command Sharing - Activity Feed", () => {
  test("Activity feed logs events and supports filtering and clearing", () => {
    let config = { activityFeed: [] };

    logActivity(config, {
      actor: "Alice",
      actorRole: "admin",
      action: "ADD_REPO",
      target: "DevOps",
      repoId: "repo1",
    });

    logActivity(config, {
      actor: "Bob",
      actorRole: "editor",
      action: "CREATE_PROPOSAL",
      target: "New Script",
      repoId: "repo2",
    });

    const feed = getActivityFeed(config);
    expect(feed.total).toBe(2);

    const filtered = getActivityFeed(config, { repoId: "repo1" });
    expect(filtered.total).toBe(1);
    expect(filtered.items[0].actor).toBe("Alice");

    const cleared = clearActivityFeed(config, "admin");
    expect(getActivityFeed(cleared).total).toBe(0);
  });
});
