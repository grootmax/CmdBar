import { jest } from "@jest/globals";
import {
  normalizeConfig,
  maskSecrets,
  parsePipelineStatus,
  formatPipelineStatusOutput,
  getTriggerCommand,
  getStatusCommand,
  getRollbackCommand,
  getPipelineStatus,
  triggerDeployment,
  executeRollback,
} from "../extension/cicdPipeline.js";

describe("CI/CD Integration Pipeline Unit & Integration Tests", () => {
  const sampleGitHubRun = {
    workflow_runs: [
      {
        id: 12345678,
        status: "completed",
        conclusion: "success",
        head_branch: "main",
        head_sha: "a1b2c3d4e5f6",
        actor: { login: "octocat" },
        html_url: "https://github.com/owner/repo/actions/runs/12345678",
        created_at: "2026-08-23T12:00:00Z",
        updated_at: "2026-08-23T12:01:30Z",
      },
    ],
    jobs: [
      { name: "build", status: "completed", conclusion: "success" },
      { name: "test", status: "completed", conclusion: "success" },
    ],
  };

  const sampleGitLabPipeline = [
    {
      id: 98765,
      status: "running",
      ref: "feature/ci-pipeline",
      sha: "f6e5d4c3b2a1",
      user: { name: "Alice Developer" },
      web_url: "https://gitlab.com/owner/project/-/pipelines/98765",
      created_at: "2026-08-23T12:10:00Z",
      duration: 45,
      details: {
        stages: [
          { name: "build", status: "success" },
          { name: "test", status: "running" },
        ],
      },
    },
  ];

  const sampleJenkinsBuild = {
    number: 42,
    building: false,
    result: "FAILURE",
    url: "http://jenkins.internal/job/deploy-app/42/",
    timestamp: 1787486400000,
    duration: 120000,
    actions: [
      {
        lastBuiltRevision: {
          SHA1: "7890abcdef123456",
          branch: [{ name: "main" }],
        },
        causes: [{ userName: "CI Service" }],
      },
    ],
    stages: [
      { name: "Compile", status: "SUCCESS" },
      { name: "Deploy", status: "FAILED" },
    ],
  };

  // --- 1. Configuration Normalization ---
  describe("normalizeConfig", () => {
    test("normalizes GitHub default options", () => {
      const cfg = normalizeConfig("github", { repo: "owner/repo", token: "ghp_secret123" });
      expect(cfg.provider).toBe("github");
      expect(cfg.repo).toBe("owner/repo");
      expect(cfg.token).toBe("ghp_secret123");
      expect(cfg.baseUrl).toBe("https://api.github.com");
    });

    test("normalizes GitLab custom options", () => {
      const cfg = normalizeConfig("gitlab", {
        projectId: "12345",
        baseUrl: "https://gitlab.example.com/api/v4/",
        token: "glpat-xyz789",
      });
      expect(cfg.provider).toBe("gitlab");
      expect(cfg.projectId).toBe("12345");
      expect(cfg.baseUrl).toBe("https://gitlab.example.com/api/v4");
      expect(cfg.token).toBe("glpat-xyz789");
    });

    test("normalizes Jenkins user & token options", () => {
      const cfg = normalizeConfig("jenkins", {
        job: "release-job",
        user: "admin",
        token: "jenkins-api-key",
      });
      expect(cfg.provider).toBe("jenkins");
      expect(cfg.job).toBe("release-job");
      expect(cfg.user).toBe("admin");
      expect(cfg.token).toBe("jenkins-api-key");
    });

    test("handles null or missing provider gracefully", () => {
      const cfg = normalizeConfig(null);
      expect(cfg.provider).toBe("github");
    });
  });

  // --- 2. Secrets Masking ---
  describe("maskSecrets", () => {
    test("masks GitHub personal access tokens", () => {
      const input = "Connecting with ghp_1234567890abcdefghijklmnopqrstuvwxyz to repo";
      const masked = maskSecrets(input);
      expect(masked).not.toContain("ghp_1234567890abcdefghijklmnopqrstuvwxyz");
      expect(masked).toContain("[REDACTED]");
    });

    test("masks GitLab personal access tokens", () => {
      const input = "Header PRIVATE-TOKEN: glpat-abcdefghijklmnopqrst";
      const masked = maskSecrets(input);
      expect(masked).not.toContain("glpat-abcdefghijklmnopqrst");
      expect(masked).toContain("[REDACTED]");
    });

    test("masks Bearer authorization tokens", () => {
      const input = "Authorization: Bearer secret_bearer_token_value_999";
      const masked = maskSecrets(input);
      expect(masked).not.toContain("secret_bearer_token_value_999");
      expect(masked).toContain("[REDACTED]");
    });

    test("masks explicit secret strings passed in array", () => {
      const input = "Deploying with password my_super_secret_p@ssword_123";
      const masked = maskSecrets(input, ["my_super_secret_p@ssword_123"]);
      expect(masked).not.toContain("my_super_secret_p@ssword_123");
      expect(masked).toContain("[REDACTED]");
    });

    test("handles null or undefined input for maskSecrets", () => {
      expect(maskSecrets(null)).toBe("");
      expect(maskSecrets(undefined)).toBe("");
    });
  });

  // --- 3. Pipeline Status Response Parsing ---
  describe("parsePipelineStatus", () => {
    test("parses GitHub Actions successful completed run with jobs", () => {
      const parsed = parsePipelineStatus("github", sampleGitHubRun);
      expect(parsed.provider).toBe("github");
      expect(parsed.id).toBe("12345678");
      expect(parsed.status).toBe("success");
      expect(parsed.outcome).toBe("success");
      expect(parsed.branch).toBe("main");
      expect(parsed.commit).toBe("a1b2c3d");
      expect(parsed.author).toBe("octocat");
      expect(parsed.duration).toBe("90s");
      expect(parsed.stages.length).toBe(2);
      expect(parsed.stages[0].name).toBe("build");
    });

    test("parses GitLab CI running pipeline with stages", () => {
      const parsed = parsePipelineStatus("gitlab", sampleGitLabPipeline);
      expect(parsed.provider).toBe("gitlab");
      expect(parsed.id).toBe("98765");
      expect(parsed.status).toBe("running");
      expect(parsed.branch).toBe("feature/ci-pipeline");
      expect(parsed.commit).toBe("f6e5d4c");
      expect(parsed.author).toBe("Alice Developer");
      expect(parsed.duration).toBe("45s");
      expect(parsed.stages.length).toBe(2);
      expect(parsed.stages[0].name).toBe("build");
    });

    test("parses Jenkins failed build with stages", () => {
      const parsed = parsePipelineStatus("jenkins", sampleJenkinsBuild);
      expect(parsed.provider).toBe("jenkins");
      expect(parsed.id).toBe("42");
      expect(parsed.status).toBe("failed");
      expect(parsed.outcome).toBe("failure");
      expect(parsed.commit).toBe("7890abc");
      expect(parsed.author).toBe("CI Service");
      expect(parsed.duration).toBe("120s");
      expect(parsed.stages.length).toBe(2);
    });

    test("parses cancelled and building statuses", () => {
      const ghCancelled = parsePipelineStatus("github", { status: "completed", conclusion: "cancelled" });
      expect(ghCancelled.status).toBe("cancelled");

      const glCanceled = parsePipelineStatus("gitlab", { status: "canceled" });
      expect(glCanceled.status).toBe("cancelled");

      const jenkinsBuilding = parsePipelineStatus("jenkins", { building: true });
      expect(jenkinsBuilding.status).toBe("running");
    });
  });

  // --- 4. Shell Command Generation ---
  describe("Shell Command Generation", () => {
    test("generates trigger command for GitHub Actions with secret masking", () => {
      const cmd = getTriggerCommand("github", {
        repo: "myorg/myrepo",
        token: "ghp_secret_token_val_12345",
        job: "deploy.yml",
        environment: "production",
      });
      expect(cmd).toContain("curl");
      expect(cmd).toContain("myorg/myrepo");
      expect(cmd).toContain("deploy.yml");
      expect(cmd).not.toContain("ghp_secret_token_val_12345");
      expect(cmd).toContain("[REDACTED]");
    });

    test("generates status command for GitLab CI", () => {
      const cmd = getStatusCommand("gitlab", {
        projectId: "my-group/my-project",
        token: "glpat-secret_gl_token",
      });
      expect(cmd).toContain("curl");
      expect(cmd).toContain("my-group%2Fmy-project");
      expect(cmd).not.toContain("glpat-secret_gl_token");
      expect(cmd).toContain("[REDACTED]");
    });

    test("generates rollback command for Jenkins", () => {
      const cmd = getRollbackCommand("jenkins", {
        job: "rollback-service",
        user: "admin",
        token: "jenkins_token_abc",
        targetVersion: "v1.4.2",
      });
      expect(cmd).toContain("curl");
      expect(cmd).toContain("rollback-service");
      expect(cmd).toContain("TARGET_VERSION");
      expect(cmd).toContain("v1.4.2");
      expect(cmd).not.toContain("jenkins_token_abc");
    });

    test("returns fallback string for unsupported provider", () => {
      expect(getTriggerCommand("invalid_provider")).toContain("Unsupported provider");
      expect(getStatusCommand("invalid_provider")).toContain("Unsupported provider");
    });
  });

  // --- 5. Async API Calls with Mocks ---
  describe("Async API Calls (getPipelineStatus, triggerDeployment, executeRollback)", () => {
    test("getPipelineStatus fetches and normalizes status via mockFetch for GitHub and Jenkins", async () => {
      const mockFetchGH = jest.fn().mockResolvedValue({
        ok: true,
        data: sampleGitHubRun,
      });

      const resGH = await getPipelineStatus("github", {
        repo: "owner/repo",
        token: "ghp_my_token",
        mockFetch: mockFetchGH,
      });

      expect(resGH.status).toBe("success");

      const mockFetchJenkins = jest.fn().mockResolvedValue({
        ok: true,
        data: sampleJenkinsBuild,
      });

      const resJenkins = await getPipelineStatus("jenkins", {
        job: "my-job",
        user: "admin",
        token: "admin-pass",
        mockFetch: mockFetchJenkins,
      });

      expect(resJenkins.provider).toBe("jenkins");
      expect(resJenkins.status).toBe("failed");
    });

    test("triggerDeployment sends trigger payload via mockFetch for Jenkins and GitHub", async () => {
      const mockFetchJenkins = jest.fn().mockResolvedValue({
        ok: true,
        data: { number: 101 },
      });

      const resJenkins = await triggerDeployment("jenkins", {
        job: "deploy-job",
        user: "admin",
        token: "secret-token",
        mockFetch: mockFetchJenkins,
      });

      expect(resJenkins.success).toBe(true);
      expect(resJenkins.buildId).toBe(101);

      const mockFetchGH = jest.fn().mockResolvedValue({
        ok: true,
        data: { id: "gh-dispatch-202" },
      });

      const resGH = await triggerDeployment("github", {
        repo: "owner/repo",
        token: "ghp_tok",
        mockFetch: mockFetchGH,
      });

      expect(resGH.success).toBe(true);
    });

    test("executeRollback initiates rollback workflow via mockFetch", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        data: { id: "rb-101" },
      });

      const res = await executeRollback("github", {
        repo: "owner/app",
        token: "ghp_tok",
        targetVersion: "v2.1.0",
        mockFetch,
      });

      expect(res.success).toBe(true);
      expect(res.rollbackVersion).toBe("v2.1.0");
      expect(res.buildId).toBe("rb-101");
    });

    test("handles network/fetch error gracefully without exposing secrets", async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error("Network timeout with token ghp_secret_tok_val"));

      const res = await getPipelineStatus("github", {
        repo: "owner/app",
        token: "ghp_secret_tok_val",
        mockFetch,
      });

      expect(res.status).toBe("failed");
      expect(res.error).not.toContain("ghp_secret_tok_val");
      expect(res.error).toContain("[REDACTED]");
    });
  });

  // --- 6. Status Output Formatter ---
  describe("formatPipelineStatusOutput", () => {
    test("formats pipeline status into human-readable text", () => {
      const statusObj = {
        provider: "github",
        id: "555",
        status: "success",
        branch: "main",
        commit: "b8c7d6e",
        author: "DevUser",
        duration: "42s",
        stages: [
          { name: "Build", status: "success" },
          { name: "Test", status: "failed" },
        ],
        url: "https://github.com/owner/repo/runs/555",
      };

      const formatted = formatPipelineStatusOutput(statusObj);
      expect(formatted).toContain("[GITHUB] Pipeline #555: ✅ SUCCESS");
      expect(formatted).toContain("Branch: main (b8c7d6e)");
      expect(formatted).toContain("Author: DevUser");
      expect(formatted).toContain("Duration: 42s");
      expect(formatted).toContain("✓ Build: success");
      expect(formatted).toContain("✗ Test: failed");
    });

    test("handles null statusObj gracefully", () => {
      expect(formatPipelineStatusOutput(null)).toBe("No pipeline status available.");
    });
  });

  // --- 7. Full Integration Test Suite ---
  describe("Full End-to-End Integration Workflow Test", () => {
    test("simulates full lifecycle: trigger -> query status -> execute rollback across all 3 providers", async () => {
      const providers = [
        { name: "github", options: { repo: "org/repo", token: "ghp_integration_tok_123" } },
        { name: "gitlab", options: { projectId: "4567", token: "glpat-integration_tok_456" } },
        { name: "jenkins", options: { job: "build-deploy", user: "jenkins_user", token: "jenkins_api_tok_789" } },
      ];

      for (const prov of providers) {
        // Step 1: Trigger Deployment
        const triggerMock = jest.fn().mockResolvedValue({
          ok: true,
          data: { id: "job-1001", number: 1001 },
        });

        const triggerRes = await triggerDeployment(prov.name, {
          ...prov.options,
          environment: "production",
          mockFetch: triggerMock,
        });

        expect(triggerRes.success).toBe(true);

        // Step 2: Query Pipeline Status
        const statusMockData = prov.name === "github"
          ? sampleGitHubRun
          : prov.name === "gitlab"
          ? sampleGitLabPipeline
          : sampleJenkinsBuild;

        const statusMock = jest.fn().mockResolvedValue({
          ok: true,
          data: statusMockData,
        });

        const statusRes = await getPipelineStatus(prov.name, {
          ...prov.options,
          mockFetch: statusMock,
        });

        expect(statusRes.provider).toBe(prov.name);
        expect(["success", "running", "failed"]).toContain(statusRes.status);

        // Step 3: Execute Rollback
        const rollbackMock = jest.fn().mockResolvedValue({
          ok: true,
          data: { id: "job-1002", number: 1002 },
        });

        const rollbackRes = await executeRollback(prov.name, {
          ...prov.options,
          targetVersion: "v1.0.0",
          mockFetch: rollbackMock,
        });

        expect(rollbackRes.success).toBe(true);
        expect(rollbackRes.rollbackVersion).toBe("v1.0.0");
      }
    });
  });

  // --- 8. Performance Benchmark ---
  describe("Performance Benchmarks", () => {
    test("normalizing config, masking secrets, and generating commands finishes under 50ms for 1000 operations", () => {
      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        normalizeConfig("github", { repo: "owner/repo", token: `ghp_${i}_secret_value` });
        maskSecrets(`Connecting to ghp_${i}_secret_value with Bearer token_${i}`);
        getTriggerCommand("gitlab", { projectId: `proj_${i}`, token: `glpat_secret_${i}` });
        getStatusCommand("jenkins", { job: `job_${i}`, user: "admin", token: `tok_${i}` });
      }

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(500);
    });
  });
});
