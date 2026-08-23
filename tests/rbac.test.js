import {
  RBACManager,
  AuditLogger,
  hasPermission,
  DEFAULT_PERMISSIONS,
  DEFAULT_ROLES,
} from "../extension/rbac.js";
import { rankCommands } from "../extension/commandProcessor.js";

describe("Role-Based Access Control (RBAC) Module", () => {
  describe("hasPermission Helper", () => {
    test("should grant access for exact permission match", () => {
      expect(hasPermission(["commands:view", "commands:execute"], "commands:execute")).toBe(true);
    });

    test("should deny access when permission is missing", () => {
      expect(hasPermission(["commands:view"], "commands:execute")).toBe(false);
    });

    test("should grant access when wildcard '*' is present", () => {
      expect(hasPermission(["*"], "rbac:manage")).toBe(true);
    });

    test("should support namespace wildcard matches (e.g. 'commands:*')", () => {
      expect(hasPermission(["commands:*"], "commands:execute")).toBe(true);
      expect(hasPermission(["commands:*"], "commands:approve")).toBe(true);
      expect(hasPermission(["commands:*"], "rbac:manage")).toBe(false);
    });

    test("should evaluate array of required permissions", () => {
      expect(
        hasPermission(
          ["commands:view", "commands:execute", "commands:approve"],
          ["commands:view", "commands:execute"]
        )
      ).toBe(true);
      expect(
        hasPermission(
          ["commands:view"],
          ["commands:view", "commands:execute"]
        )
      ).toBe(false);
    });
  });

  describe("AuditLogger", () => {
    test("should log events and retrieve with filtering", () => {
      const logger = new AuditLogger();
      logger.log("alice", "user", "COMMAND_EXECUTE", "ping", "ALLOWED");
      logger.log("bob", "admin", "ROLE_ASSIGNED", "charlie", "SUCCESS");
      logger.log("alice", "user", "COMMAND_EXECUTE", "deploy", "DENIED");

      expect(logger.logs.length).toBe(3);

      const aliceLogs = logger.getLogs({ actor: "alice" });
      expect(aliceLogs.length).toBe(2);

      const deniedLogs = logger.getLogs({ result: "DENIED" });
      expect(deniedLogs.length).toBe(1);
      expect(deniedLogs[0].target).toBe("deploy");

      logger.clear();
      expect(logger.logs.length).toBe(0);
    });
  });

  describe("RBACManager Roles & Permissions", () => {
    let rbac;

    beforeEach(() => {
      rbac = new RBACManager({
        users: {
          alice: { role: "admin" },
          bob: { role: "operator" },
          charlie: { role: "user" },
          dave: { role: "viewer" },
        },
      });
    });

    test("should resolve default role when user is unassigned", () => {
      expect(rbac.getUserRole("unknown_user")).toBe("user");
    });

    test("should resolve assigned role for users", () => {
      expect(rbac.getUserRole("alice")).toBe("admin");
      expect(rbac.getUserRole("bob")).toBe("operator");
      expect(rbac.getUserRole("charlie")).toBe("user");
      expect(rbac.getUserRole("dave")).toBe("viewer");
    });

    test("should set user role dynamically and log audit event", () => {
      rbac.setUserRole("charlie", "operator", "alice");
      expect(rbac.getUserRole("charlie")).toBe("operator");

      const logs = rbac.auditLogger.getLogs({ action: "ROLE_ASSIGNED" });
      expect(logs.length).toBe(1);
      expect(logs[0].actor).toBe("alice");
      expect(logs[0].target).toBe("charlie");
    });

    test("should throw error when assigning unknown role", () => {
      expect(() => rbac.setUserRole("charlie", "non_existent_role")).toThrow();
    });

    test("should compute effective permissions for users", () => {
      const alicePerms = rbac.getEffectivePermissions("alice");
      expect(alicePerms).toContain("*");

      const bobPerms = rbac.getEffectivePermissions("bob");
      expect(bobPerms).toContain("commands:view");
      expect(bobPerms).toContain("commands:execute");
      expect(bobPerms).toContain("commands:approve");

      const davePerms = rbac.getEffectivePermissions("dave");
      expect(davePerms).toContain("commands:view");
      expect(davePerms).not.toContain("commands:execute");
    });
  });

  describe("Command Visibility Rules", () => {
    let rbac;

    beforeEach(() => {
      rbac = new RBACManager({
        users: {
          admin_user: { role: "admin" },
          op_user: { role: "operator" },
          std_user: { role: "user" },
          view_user: { role: "viewer" },
        },
      });
    });

    const commands = [
      { name: "Public Echo", command: "echo hi", visibility: "public" },
      { name: "Admin Exec", command: "reboot", visibility: "admin-only" },
      { name: "Operator Tool", command: "deploy", required_role: "operator" },
      { name: "Hidden Service", command: "internal", visibility: "hidden" },
      { name: "Permission Specific", command: "audit", required_permission: "audit:view" },
    ];

    test("admin user can see all commands except hidden", () => {
      expect(rbac.isCommandVisible(commands[0], "admin_user")).toBe(true);
      expect(rbac.isCommandVisible(commands[1], "admin_user")).toBe(true);
      expect(rbac.isCommandVisible(commands[2], "admin_user")).toBe(true);
      expect(rbac.isCommandVisible(commands[3], "admin_user")).toBe(false);
    });

    test("standard user sees public commands but not admin-only or role-restricted commands", () => {
      expect(rbac.isCommandVisible(commands[0], "std_user")).toBe(true);
      expect(rbac.isCommandVisible(commands[1], "std_user")).toBe(false);
      expect(rbac.isCommandVisible(commands[2], "std_user")).toBe(false);
      expect(rbac.isCommandVisible(commands[4], "std_user")).toBe(false);
    });

    test("operator user sees operator required commands", () => {
      expect(rbac.isCommandVisible(commands[2], "op_user")).toBe(true);
    });

    test("getVisibleCommands filters category list according to permissions", () => {
      const categories = [
        {
          name: "General",
          commands: [commands[0], commands[1], commands[2]],
        },
      ];

      const userVisible = rbac.getVisibleCommands(categories, "std_user");
      expect(userVisible.length).toBe(1);
      expect(userVisible[0].commands.length).toBe(1);
      expect(userVisible[0].commands[0].name).toBe("Public Echo");

      const opVisible = rbac.getVisibleCommands(categories, "op_user");
      expect(opVisible[0].commands.length).toBe(2);
    });

    test("rankCommands filters out invisible commands when rbacManager is provided", () => {
      const ranked = rankCommands(commands, "e", {}, rbac, "std_user");
      const names = ranked.map((r) => r.command.name);
      expect(names).toContain("Public Echo");
      expect(names).not.toContain("Admin Exec");
      expect(names).not.toContain("Operator Tool");
    });
  });

  describe("Approval Chains", () => {
    let rbac;

    beforeEach(() => {
      rbac = new RBACManager({
        users: {
          admin1: { role: "admin" },
          user1: { role: "user" },
          operator1: { role: "operator" },
        },
      });
    });

    const sensitiveCommand = {
      name: "Drop Database",
      command: "dropdb production",
      requires_approval: true,
    };

    test("standard user execution of approval command requires approval chain", () => {
      const res = rbac.canExecuteCommand(sensitiveCommand, "user1");
      expect(res.allowed).toBe(false);
      expect(res.requires_approval).toBe(true);
    });

    test("admin can execute approval command directly", () => {
      const res = rbac.canExecuteCommand(sensitiveCommand, "admin1");
      expect(res.allowed).toBe(true);
      expect(res.requires_approval).toBe(false);
    });

    test("creating, approving, and rejecting approval requests", () => {
      const req = rbac.createApprovalRequest(
        sensitiveCommand.name,
        sensitiveCommand.command,
        "user1",
        "Quarterly maintenance"
      );

      expect(req.status).toBe("pending");
      expect(rbac.getPendingApprovalRequests().length).toBe(1);

      // Operator approves request
      const approved = rbac.approveRequest(req.id, "operator1", "Approved for maintenance window");
      expect(approved.status).toBe("approved");
      expect(approved.reviewed_by).toBe("operator1");
      expect(rbac.getPendingApprovalRequests().length).toBe(0);

      // Create second request and reject
      const req2 = rbac.createApprovalRequest(
        sensitiveCommand.name,
        sensitiveCommand.command,
        "user1"
      );
      const rejected = rbac.rejectRequest(req2.id, "operator1", "Not permitted at this time");
      expect(rejected.status).toBe("rejected");
    });

    test("non-approver user cannot approve or reject requests", () => {
      const req = rbac.createApprovalRequest(
        sensitiveCommand.name,
        sensitiveCommand.command,
        "user1"
      );
      expect(() => rbac.approveRequest(req.id, "user1")).toThrow();
    });
  });

  describe("Delegation Lifecycle", () => {
    let rbac;

    beforeEach(() => {
      rbac = new RBACManager({
        users: {
          admin1: { role: "admin" },
          user1: { role: "user" },
        },
      });
    });

    test("delegates operator role to user1 temporarily", () => {
      const now = Date.now();
      rbac.createDelegation({
        delegator: "admin1",
        delegatee: "user1",
        role: "operator",
        duration_ms: 60000,
        reason: "On-call shift",
      });

      // User1 now has active delegated permissions
      const perms = rbac.getEffectivePermissions("user1", { now });
      expect(perms).toContain("commands:approve");

      // Check command visibility with delegation
      const operatorCommand = {
        name: "Operator Action",
        command: "op_action",
        required_role: "operator",
      };
      expect(rbac.isCommandVisible(operatorCommand, "user1", { now })).toBe(true);
    });

    test("expired delegation does not grant permissions", () => {
      const now = Date.now();
      rbac.createDelegation({
        delegator: "admin1",
        delegatee: "user1",
        role: "operator",
        duration_ms: 1000,
      });

      // Evaluate 2 seconds in the future
      const future = now + 2000;
      const perms = rbac.getEffectivePermissions("user1", { now: future });
      expect(perms).not.toContain("commands:approve");
    });

    test("revoking delegation deactivates permissions immediately", () => {
      const del = rbac.createDelegation({
        delegator: "admin1",
        delegatee: "user1",
        role: "operator",
        duration_ms: 60000,
      });

      rbac.revokeDelegation(del.id, "admin1");
      const perms = rbac.getEffectivePermissions("user1");
      expect(perms).not.toContain("commands:approve");
    });
  });

  describe("Performance Benchmarks", () => {
    test("permission checks meet sub-millisecond execution benchmarks for 10,000 evaluations", () => {
      const rbac = new RBACManager({
        users: { user1: { role: "user" }, admin1: { role: "admin" } },
      });

      const start = Date.now();
      for (let i = 0; i < 10000; i++) {
        rbac.checkPermission("user1", "commands:execute");
      }
      const elapsed = Date.now() - start;

      // 10,000 permission checks should complete in under 500ms
      expect(elapsed).toBeLessThan(500);
    });
  });
});
