import assert from "assert";
import { RBACManager } from "../extension/rbacManager.js";
import { filterCommandsByRBAC, checkCommandExecutionRBAC } from "../extension/commandProcessor.js";

describe("Role-Based Access Control (RBAC) Module", () => {
  let rbac;

  beforeEach(() => {
    rbac = new RBACManager({
      enabled: true,
      default_role: "user",
      roles: {
        admin: { name: "Admin", permissions: ["*"] },
        user: { name: "User", permissions: ["command:view", "command:execute"] },
        operator: { name: "Operator", permissions: ["command:view", "command:execute", "approval:request"] },
        approver: { name: "Approver", permissions: ["command:view", "command:approve"] },
        auditor: { name: "Auditor", permissions: ["command:view", "audit:read"] },
      },
      user_roles: {
        alice: ["admin"],
        bob: ["user"],
        charlie: ["operator"],
        david: ["approver"],
      },
      user_permissions: {
        bob: ["command:execute:staging"],
      },
    });
  });

  describe("1. Roles & Granular Permissions", () => {
    test("Assigns default role to unknown user", () => {
      const roles = rbac.getUserRoles("unknown_user");
      expect(roles).toEqual(["user"]);
    });

    test("Resolves direct user roles correctly", () => {
      expect(rbac.getUserRoles("alice")).toEqual(["admin"]);
      expect(rbac.getUserRoles("bob")).toEqual(["user"]);
    });

    test("Assigns and revokes user roles", () => {
      rbac.assignUserRole("eve", "operator", "admin");
      expect(rbac.getUserRoles("eve")).toContain("operator");

      rbac.removeUserRole("eve", "operator", "admin");
      expect(rbac.getUserRoles("eve")).not.toContain("operator");
    });

    test("Matches permissions with exact, wildcard, and prefix rules", () => {
      expect(RBACManager.matchPermission(["*"], "anything")).toBe(true);
      expect(RBACManager.matchPermission(["command:*"], "command:execute")).toBe(true);
      expect(RBACManager.matchPermission(["command:execute:*"], "command:execute:prod")).toBe(true);
      expect(RBACManager.matchPermission(["command:execute:prod"], "command:execute:dev")).toBe(false);
    });

    test("Resolves effective permissions combining roles and custom permissions", () => {
      const bobPerms = rbac.getEffectivePermissions("bob");
      expect(bobPerms).toContain("command:view");
      expect(bobPerms).toContain("command:execute");
      expect(bobPerms).toContain("command:execute:staging");
    });
  });

  describe("2. Command Visibility Rules", () => {
    const categories = [
      {
        name: "Public Tools",
        commands: [
          { name: "Ping", command: "ping 127.0.0.1", visibility: "public" },
          { name: "Secret Command", command: "secret", visibility: "hidden" },
        ],
      },
      {
        name: "Restricted Tools",
        commands: [
          { name: "Prod Deploy", command: "deploy prod", allowed_roles: ["admin", "operator"] },
          { name: "Staging Deploy", command: "deploy staging", required_permissions: ["command:execute:staging"] },
          { name: "Admin Console", command: "admin-console", visibility: "admin_only" },
        ],
      },
    ];

    test("Public commands are visible to standard users", () => {
      const ping = categories[0].commands[0];
      expect(rbac.canViewCommand("bob", ping)).toBe(true);
    });

    test("Hidden commands are not visible to anyone", () => {
      const secret = categories[0].commands[1];
      expect(rbac.canViewCommand("alice", secret)).toBe(false);
      expect(rbac.canViewCommand("bob", secret)).toBe(false);
    });

    test("Role-restricted commands enforce role checks", () => {
      const prodDeploy = categories[1].commands[0];
      expect(rbac.canViewCommand("alice", prodDeploy)).toBe(true); // admin
      expect(rbac.canViewCommand("charlie", prodDeploy)).toBe(true); // operator
      expect(rbac.canViewCommand("bob", prodDeploy)).toBe(false); // standard user
    });

    test("Permission-restricted commands enforce granular permission checks", () => {
      const stagingDeploy = categories[1].commands[1];
      expect(rbac.canViewCommand("bob", stagingDeploy)).toBe(true); // bob has command:execute:staging
      expect(rbac.canViewCommand("charlie", stagingDeploy)).toBe(false); // charlie lacks perm
    });

    test("filterCommandsByRBAC filters out invisible commands and empty categories", () => {
      const filteredBob = filterCommandsByRBAC(categories, "bob", rbac.exportConfig());
      expect(filteredBob.length).toBe(2);
      expect(filteredBob[0].commands.map((c) => c.name)).toEqual(["Ping"]);
      expect(filteredBob[1].commands.map((c) => c.name)).toEqual(["Staging Deploy"]);

      const filteredAlice = filterCommandsByRBAC(categories, "alice", rbac.exportConfig());
      expect(filteredAlice[1].commands.map((c) => c.name)).toContain("Admin Console");
    });
  });

  describe("3. Approval Chains", () => {
    const prodCmd = {
      name: "Drop Prod Table",
      command: "drop table users",
      requires_approval: true,
      approval_chain: ["approver"],
    };

    test("Command requiring approval initiates an approval request", () => {
      const res = rbac.canExecuteCommand("bob", prodCmd);
      expect(res.allowed).toBe(false);
      expect(res.status).toBe("requires_approval");
      expect(res.approval_request_id).toBeDefined();

      const req = rbac.getApprovalRequest(res.approval_request_id);
      expect(req.status).toBe("pending");
      expect(req.requester).toBe("bob");
    });

    test("Approving request updates status to approved and permits execution", () => {
      const res = rbac.canExecuteCommand("charlie", prodCmd);
      const reqId = res.approval_request_id;

      // David is an approver
      rbac.approveRequest(reqId, "david");

      const req = rbac.getApprovalRequest(reqId);
      expect(req.status).toBe("approved");

      const execRes = rbac.canExecuteCommand("charlie", prodCmd, { approval_request_id: reqId });
      expect(execRes.allowed).toBe(true);
      expect(execRes.status).toBe("granted");
    });

    test("Unauthorized approver throws error on approval attempt", () => {
      const res = rbac.canExecuteCommand("charlie", prodCmd);
      const reqId = res.approval_request_id;

      // Bob is a standard user without approval rights
      expect(() => rbac.approveRequest(reqId, "bob")).toThrow();
    });

    test("Rejecting request blocks command execution", () => {
      const res = rbac.canExecuteCommand("charlie", prodCmd);
      const reqId = res.approval_request_id;

      rbac.rejectRequest(reqId, "david", "Risky operation during business hours");

      const req = rbac.getApprovalRequest(reqId);
      expect(req.status).toBe("rejected");

      const execRes = rbac.canExecuteCommand("charlie", prodCmd, { approval_request_id: reqId });
      expect(execRes.allowed).toBe(false);
      expect(execRes.status).toBe("rejected");
    });
  });

  describe("4. Delegation", () => {
    test("Creates active delegation that expands delegatee permissions", () => {
      // Alice delegates 'admin' role to Bob for 1 hour
      const now = new Date();
      const inOneHour = new Date(now.getTime() + 3600 * 1000);

      const del = rbac.createDelegation({
        delegator: "alice",
        delegatee: "bob",
        roles: ["admin"],
        start_time: now,
        end_time: inOneHour,
      });

      expect(del.status).toBe("active");
      const effectiveRoles = rbac.getEffectiveRoles("bob", now);
      expect(effectiveRoles).toContain("admin");
    });

    test("Expired delegation is automatically ignored and marked expired", () => {
      const pastStart = new Date(Date.now() - 7200 * 1000);
      const pastEnd = new Date(Date.now() - 3600 * 1000);

      rbac.createDelegation({
        delegator: "alice",
        delegatee: "bob",
        roles: ["admin"],
        start_time: pastStart,
        end_time: pastEnd,
      });

      const effectiveRoles = rbac.getEffectiveRoles("bob", new Date());
      expect(effectiveRoles).not.toContain("admin");
    });

    test("Revoking a delegation immediately terminates delegated access", () => {
      const del = rbac.createDelegation({
        delegator: "alice",
        delegatee: "bob",
        roles: ["operator"],
      });

      expect(rbac.getEffectiveRoles("bob")).toContain("operator");

      rbac.revokeDelegation(del.id, "alice");
      expect(rbac.getEffectiveRoles("bob")).not.toContain("operator");
    });
  });

  describe("5. Audit Trail", () => {
    test("Logs RBAC actions and allows filtering", () => {
      rbac.assignUserRole("bob", "operator", "alice");
      rbac.logAudit({ actor: "bob", action: "TEST_ACTION", resource: "res1", outcome: "success" });

      const logs = rbac.queryAuditLogs({ actor: "bob" });
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some((l) => l.action === "TEST_ACTION")).toBe(true);
    });

    test("Exports audit logs to JSON and CSV formats", () => {
      rbac.logAudit({ actor: "alice", action: "EXPORT_TEST", resource: "test", outcome: "success" });

      const jsonExport = rbac.exportAuditLogs("json");
      expect(jsonExport).toContain("EXPORT_TEST");

      const csvExport = rbac.exportAuditLogs("csv");
      expect(csvExport).toContain("id,timestamp,actor,action,resource,outcome,details");
      expect(csvExport).toContain("EXPORT_TEST");
    });
  });

  describe("6. Performance Benchmarks", () => {
    test("Evaluates 10,000 permission checks in under 500ms", () => {
      const start = Date.now();
      for (let i = 0; i < 10000; i++) {
        rbac.hasPermission("bob", "command:execute");
      }
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(500);
    });
  });
});
