import {
  ChainRunner,
  ChainStatus,
  StepStatus,
} from "../extension/chainRunner.js";

describe("Multi-Step Command Chains Unit Tests", () => {
  test("runs sequential command chain (Pull → Build → Deploy → Notify) successfully", async () => {
    const executedCommands = [];
    const mockExecutor = async (cmd) => {
      executedCommands.push(cmd);
      return { exit_code: 0, stdout: `Executed: ${cmd}`, stderr: "" };
    };

    const chainDef = {
      name: "Deploy Pipeline",
      type: "chain",
      steps: [
        { id: "pull", name: "Pull", command: "git pull origin main" },
        { id: "build", name: "Build", command: "npm run build" },
        { id: "deploy", name: "Deploy", command: "./deploy.sh" },
        { id: "notify", name: "Notify", command: "notify-send Done" },
      ],
    };

    const runner = new ChainRunner(chainDef, { executor: mockExecutor });
    await runner.start();

    expect(runner.status).toBe(ChainStatus.SUCCESS);
    expect(executedCommands).toEqual([
      "git pull origin main",
      "npm run build",
      "./deploy.sh",
      "notify-send Done",
    ]);
  });

  test("substitutes placeholders in step commands", async () => {
    const executedCommands = [];
    const mockExecutor = async (cmd) => {
      executedCommands.push(cmd);
      return { exit_code: 0, stdout: "ok", stderr: "" };
    };

    const chainDef = {
      name: "Parameterized Chain",
      type: "chain",
      steps: [
        {
          id: "step1",
          name: "Build",
          command: "docker build -t app:<version>",
        },
        {
          id: "step2",
          name: "Tag",
          command: "docker tag app:<version> registry/app:{{version}}",
        },
      ],
    };

    const runner = new ChainRunner(chainDef, {
      executor: mockExecutor,
      placeholderMap: { version: "v1.2.3" },
    });

    await runner.start();

    expect(runner.status).toBe(ChainStatus.SUCCESS);
    expect(executedCommands).toEqual([
      "docker build -t app:v1.2.3",
      "docker tag app:v1.2.3 registry/app:v1.2.3",
    ]);
  });

  test("enforces step dependencies (depends_on)", async () => {
    const executedCommands = [];
    const mockExecutor = async (cmd) => {
      executedCommands.push(cmd);
      if (cmd === "step1")
        return { exit_code: 1, stdout: "", stderr: "Failed" };
      return { exit_code: 0, stdout: "OK", stderr: "" };
    };

    const chainDef = {
      name: "Dependency Chain",
      type: "chain",
      steps: [
        { id: "step1", name: "Step 1", command: "step1", on_failure: "next" },
        {
          id: "step2",
          name: "Step 2",
          command: "step2",
          depends_on: ["step1"],
        },
        { id: "step3", name: "Step 3", command: "step3" },
      ],
    };

    const runner = new ChainRunner(chainDef, { executor: mockExecutor });
    await runner.start();

    // step2 depends on step1 which failed; so step2 is skipped and step3 runs
    expect(executedCommands).toEqual(["step1", "step3"]);
    expect(runner.getStepById("step2").status).toBe(StepStatus.SKIPPED);
  });

  test("evaluates success_criteria (exit_code & output_contains)", async () => {
    const mockExecutor = async (cmd) => {
      if (cmd === "check_logs") {
        return { exit_code: 0, stdout: "Status: ALL_TESTS_PASSED", stderr: "" };
      }
      return { exit_code: 0, stdout: "", stderr: "" };
    };

    const chainDef = {
      name: "Success Criteria Chain",
      type: "chain",
      steps: [
        {
          id: "check",
          name: "Check",
          command: "check_logs",
          success_criteria: {
            exit_code: 0,
            output_contains: "ALL_TESTS_PASSED",
          },
        },
      ],
    };

    const runner = new ChainRunner(chainDef, { executor: mockExecutor });
    await runner.start();

    expect(runner.status).toBe(ChainStatus.SUCCESS);
    expect(runner.getStepById("check").status).toBe(StepStatus.SUCCESS);
  });

  test("supports conditional branching (on_success & on_failure)", async () => {
    const executedCommands = [];
    const mockExecutor = async (cmd) => {
      executedCommands.push(cmd);
      if (cmd === "test_service") {
        return { exit_code: 1, stdout: "", stderr: "Service unavailable" };
      }
      return { exit_code: 0, stdout: "ok", stderr: "" };
    };

    const chainDef = {
      name: "Branching Chain",
      type: "chain",
      steps: [
        {
          id: "test",
          name: "Test Service",
          command: "test_service",
          on_success: "deploy",
          on_failure: "fallback",
        },
        { id: "deploy", name: "Deploy", command: "deploy_normal" },
        { id: "fallback", name: "Fallback", command: "deploy_fallback" },
      ],
    };

    const runner = new ChainRunner(chainDef, { executor: mockExecutor });
    await runner.start();

    expect(executedCommands).toEqual(["test_service", "deploy_fallback"]);
    expect(runner.status).toBe(ChainStatus.SUCCESS);
  });

  test("supports pausing between steps and resuming", async () => {
    const executedCommands = [];
    let pauseCallbackCalled = false;

    const mockExecutor = async (cmd) => {
      executedCommands.push(cmd);
      return { exit_code: 0, stdout: "ok", stderr: "" };
    };

    const chainDef = {
      name: "Paused Chain",
      type: "chain",
      steps: [
        { id: "step1", name: "Step 1", command: "build" },
        {
          id: "pause_step",
          name: "Pause",
          type: "pause",
          prompt: "Ready to deploy?",
        },
        { id: "step2", name: "Step 2", command: "deploy" },
      ],
    };

    const runner = new ChainRunner(chainDef, {
      executor: mockExecutor,
      onStepPause: (step, prompt, resume) => {
        pauseCallbackCalled = true;
        setTimeout(() => resume(), 20);
      },
    });

    await runner.start();

    expect(pauseCallbackCalled).toBe(true);
    expect(executedCommands).toEqual(["build", "deploy"]);
    expect(runner.status).toBe(ChainStatus.SUCCESS);
  });

  test("handles step failure and executes rollback commands in reverse order", async () => {
    const executedCommands = [];
    const mockExecutor = async (cmd) => {
      executedCommands.push(cmd);
      if (cmd === "deploy")
        return { exit_code: 1, stdout: "", stderr: "Deploy failed" };
      return { exit_code: 0, stdout: "OK", stderr: "" };
    };

    const chainDef = {
      name: "Rollback Chain",
      type: "chain",
      steps: [
        {
          id: "pull",
          name: "Pull",
          command: "pull",
          rollback_command: "rollback_pull",
        },
        {
          id: "build",
          name: "Build",
          command: "build",
          rollback_command: "rollback_build",
        },
        {
          id: "deploy",
          name: "Deploy",
          command: "deploy",
          rollback_command: "rollback_deploy",
        },
      ],
    };

    const runner = new ChainRunner(chainDef, { executor: mockExecutor });
    await runner.start();

    expect(runner.status).toBe(ChainStatus.ROLLED_BACK);
    // pull and build succeeded and have rollback commands.
    // They roll back in reverse order: rollback_build, then rollback_pull
    expect(executedCommands).toEqual([
      "pull",
      "build",
      "deploy",
      "rollback_build",
      "rollback_pull",
    ]);
  });
});
