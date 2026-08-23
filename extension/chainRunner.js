/**
 * ChainRunner handles execution of multi-step command chains with conditional branching,
 * step dependencies, success criteria, pausing, and rollback capabilities.
 */

export const StepStatus = {
  PENDING: "pending",
  RUNNING: "running",
  SUCCESS: "success",
  FAILED: "failed",
  PAUSED: "paused",
  SKIPPED: "skipped",
  ROLLING_BACK: "rolling_back",
  ROLLED_BACK: "rolled_back",
};

export const ChainStatus = {
  IDLE: "idle",
  RUNNING: "running",
  PAUSED: "paused",
  SUCCESS: "success",
  FAILED: "failed",
  CANCELLED: "cancelled",
  ROLLING_BACK: "rolling_back",
  ROLLED_BACK: "rolled_back",
};

export class ChainRunner {
  /**
   * @param {object} chainDef - The chain command definition object.
   * @param {object} [options]
   * @param {object} [options.placeholderMap] - Parameter placeholder map.
   * @param {function} [options.executor] - Async function (cmdStrOrArgv, step) => Promise<{exit_code: number, stdout: string, stderr: string}>
   * @param {function} [options.onStepStart]
   * @param {function} [options.onStepProgress]
   * @param {function} [options.onStepComplete]
   * @param {function} [options.onStepPause]
   * @param {function} [options.onChainComplete]
   * @param {function} [options.onChainError]
   * @param {function} [options.onRollbackStart]
   * @param {function} [options.onRollbackComplete]
   */
  constructor(chainDef, options = {}) {
    this.chainDef = chainDef || {};
    this.name = chainDef.name || "Command Chain";
    this.description = chainDef.description || "";
    this.options = options;
    this.placeholderMap = options.placeholderMap || {};
    this.executor = options.executor || this._defaultExecutor.bind(this);

    this.steps = this._initializeSteps(chainDef.steps || []);
    this.status = ChainStatus.IDLE;
    this.currentStepIndex = -1;
    this.currentStepId = null;
    this.executedSteps = []; // List of step IDs that completed execution
    this.logs = [];
    this._pauseResolve = null;
    this._cancelled = false;
  }

  _initializeSteps(rawSteps) {
    return rawSteps.map((step, idx) => ({
      id: step.id || `step_${idx + 1}`,
      name: step.name || `Step ${idx + 1}`,
      type: step.type || (step.command ? "command" : "pause"),
      command: step.command || null,
      depends_on: Array.isArray(step.depends_on) ? step.depends_on : [],
      success_criteria: step.success_criteria || { exit_code: 0 },
      on_success: step.on_success || null,
      on_failure: step.on_failure || null,
      pause_before: Boolean(step.pause_before || step.type === "pause"),
      prompt: step.prompt || `Pause before step: ${step.name || step.id}`,
      rollback_command: step.rollback_command || null,
      status: StepStatus.PENDING,
      exit_code: null,
      stdout: "",
      stderr: "",
      error: null,
    }));
  }

  getStepById(id) {
    return this.steps.find((s) => s.id === id) || null;
  }

  getProgress() {
    const total = this.steps.length;
    const completed = this.steps.filter(
      (s) => s.status === StepStatus.SUCCESS || s.status === StepStatus.SKIPPED,
    ).length;
    return {
      total,
      completed,
      currentStepId: this.currentStepId,
      status: this.status,
      steps: this.steps.map((s) => ({ ...s })),
    };
  }

  _substitute(strOrArr) {
    if (!strOrArr) return strOrArr;
    if (Array.isArray(strOrArr)) {
      return strOrArr.map((item) => this._substituteString(String(item)));
    }
    return this._substituteString(String(strOrArr));
  }

  _substituteString(str) {
    if (!str) return "";
    let res = str;
    for (const [key, val] of Object.entries(this.placeholderMap)) {
      const cleanVal = val !== undefined && val !== null ? String(val) : "";
      const patterns = [`<${key}>`, `{{${key}}}`, `{${key}}`];
      for (const p of patterns) {
        res = res.split(p).join(cleanVal);
      }
    }
    return res;
  }

  async _defaultExecutor(commandStrOrArr, step) {
    const isNode =
      typeof process !== "undefined" &&
      process.versions &&
      process.versions.node;

    const cmd = this._substitute(commandStrOrArr);
    const cmdStr = Array.isArray(cmd) ? cmd.join(" ") : String(cmd);

    if (isNode) {
      try {
        const { exec } = await import("child_process");
        return new Promise((resolve) => {
          exec(cmdStr, (error, stdout, stderr) => {
            const exit_code = error
              ? error.code !== undefined
                ? error.code
                : 1
              : 0;
            resolve({
              exit_code,
              stdout: stdout || "",
              stderr: stderr || (error ? error.message : ""),
            });
          });
        });
      } catch (e) {
        return { exit_code: 1, stdout: "", stderr: e.message };
      }
    } else {
      try {
        const giModule = await import("gi");
        const Gio =
          giModule.Gio ||
          (giModule.default && giModule.default.Gio) ||
          giModule.default;
        const argv = Array.isArray(cmd) ? cmd : ["sh", "-c", cmdStr];
        const proc = Gio.Subprocess.new(
          argv,
          Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        );

        return new Promise((resolve) => {
          proc.communicate_utf8_async(null, null, (subprocess, res) => {
            try {
              const [stdout, stderr] = subprocess.communicate_utf8_finish(res);
              const exit_code = subprocess.get_exit_status();
              resolve({
                exit_code: subprocess.get_successful() ? 0 : exit_code || 1,
                stdout: stdout || "",
                stderr: stderr || "",
              });
            } catch (err) {
              resolve({ exit_code: 1, stdout: "", stderr: err.message });
            }
          });
        });
      } catch (e) {
        return { exit_code: 1, stdout: "", stderr: e.message };
      }
    }
  }

  _evaluateSuccessCriteria(step, result) {
    const criteria = step.success_criteria || {};
    const expectedCode =
      criteria.exit_code !== undefined ? criteria.exit_code : 0;

    if (result.exit_code !== expectedCode) {
      return false;
    }

    if (criteria.output_contains) {
      const target = criteria.output_contains;
      const combinedOutput =
        (result.stdout || "") + "\n" + (result.stderr || "");
      if (target instanceof RegExp) {
        if (!target.test(combinedOutput)) return false;
      } else if (typeof target === "string") {
        if (!combinedOutput.includes(target)) return false;
      }
    }

    if (criteria.output_not_contains) {
      const target = criteria.output_not_contains;
      const combinedOutput =
        (result.stdout || "") + "\n" + (result.stderr || "");
      if (target instanceof RegExp) {
        if (target.test(combinedOutput)) return false;
      } else if (typeof target === "string") {
        if (combinedOutput.includes(target)) return false;
      }
    }

    return true;
  }

  _areDependenciesSatisfied(step) {
    if (!step.depends_on || step.depends_on.length === 0) return true;
    for (const depId of step.depends_on) {
      const depStep = this.getStepById(depId);
      if (!depStep || depStep.status !== StepStatus.SUCCESS) {
        return false;
      }
    }
    return true;
  }

  async start() {
    if (this.status === ChainStatus.RUNNING) return;
    this.status = ChainStatus.RUNNING;
    this._cancelled = false;

    if (this.steps.length === 0) {
      this.status = ChainStatus.SUCCESS;
      if (this.options.onChainComplete)
        this.options.onChainComplete(this.getProgress());
      return;
    }

    let nextStepIndex = 0;
    while (
      typeof nextStepIndex === "number" &&
      nextStepIndex >= 0 &&
      nextStepIndex < this.steps.length
    ) {
      if (this._cancelled) break;

      const step = this.steps[nextStepIndex];
      this.currentStepIndex = nextStepIndex;
      this.currentStepId = step.id;

      // Check dependencies
      if (!this._areDependenciesSatisfied(step)) {
        step.status = StepStatus.SKIPPED;
        if (this.options.onStepComplete) {
          this.options.onStepComplete(
            step,
            { exit_code: -1, stdout: "", stderr: "Dependencies not satisfied" },
            this.getProgress(),
          );
        }
        nextStepIndex = this.currentStepIndex + 1;
        continue;
      }

      // Handle pause step or pause_before
      if (step.pause_before || step.type === "pause") {
        step.status = StepStatus.PAUSED;
        this.status = ChainStatus.PAUSED;
        if (this.options.onStepPause) {
          this.options.onStepPause(step, step.prompt, () => this.resume());
        }
        await new Promise((resolve) => {
          this._pauseResolve = resolve;
        });

        if (this._cancelled) break;
        this.status = ChainStatus.RUNNING;
      }

      // If step is pause-only with no command
      if (!step.command) {
        step.status = StepStatus.SUCCESS;
        this.executedSteps.push(step.id);
        if (this.options.onStepComplete) {
          this.options.onStepComplete(
            step,
            { exit_code: 0, stdout: "Paused and continued", stderr: "" },
            this.getProgress(),
          );
        }
        nextStepIndex = this._getNextStepIndex(step, true);
        continue;
      }

      // Execute command step
      step.status = StepStatus.RUNNING;
      if (this.options.onStepStart) {
        this.options.onStepStart(step, this.getProgress());
      }

      let result;
      try {
        result = await this.executor(this._substitute(step.command), step);
      } catch (e) {
        result = { exit_code: 1, stdout: "", stderr: e.message };
      }

      step.exit_code = result.exit_code;
      step.stdout = result.stdout;
      step.stderr = result.stderr;

      const isSuccess = this._evaluateSuccessCriteria(step, result);

      if (isSuccess) {
        step.status = StepStatus.SUCCESS;
        this.executedSteps.push(step.id);
        if (this.options.onStepComplete) {
          this.options.onStepComplete(step, result, this.getProgress());
        }
        nextStepIndex = this._getNextStepIndex(step, true);
      } else {
        step.status = StepStatus.FAILED;
        if (this.options.onStepComplete) {
          this.options.onStepComplete(step, result, this.getProgress());
        }

        const nextBranch = this._getNextStepIndex(step, false);
        if (typeof nextBranch === "number" && nextBranch >= 0) {
          nextStepIndex = nextBranch;
        } else {
          // Chain failed - trigger rollback
          this.status = ChainStatus.FAILED;
          await this._rollback();
          if (this.options.onChainError) {
            this.options.onChainError(
              new Error(`Step '${step.name}' failed.`),
              this.getProgress(),
            );
          }
          return;
        }
      }
    }

    if (this._cancelled) {
      this.status = ChainStatus.CANCELLED;
      await this._rollback();
    } else if (this.status !== ChainStatus.FAILED) {
      this.status = ChainStatus.SUCCESS;
      if (this.options.onChainComplete) {
        this.options.onChainComplete(this.getProgress());
      }
    }
  }

  _getNextStepIndex(step, isSuccess) {
    const targetId = isSuccess ? step.on_success : step.on_failure;

    if (targetId) {
      if (targetId === "next") {
        return this.currentStepIndex + 1;
      }
      if (
        targetId === "stop" ||
        targetId === "complete" ||
        targetId === "abort"
      ) {
        return -1;
      }
      const targetIdx = this.steps.findIndex((s) => s.id === targetId);
      if (targetIdx !== -1) return targetIdx;
    }

    if (isSuccess) {
      return this.currentStepIndex + 1;
    }

    return null;
  }

  resume() {
    if (this._pauseResolve) {
      const resolve = this._pauseResolve;
      this._pauseResolve = null;
      resolve();
    }
  }

  async cancel() {
    this._cancelled = true;
    if (this.status === ChainStatus.PAUSED) {
      this.resume();
    }
  }

  async _rollback() {
    const stepsToRollback = [...this.executedSteps]
      .reverse()
      .map((id) => this.getStepById(id))
      .filter((s) => s && s.rollback_command);

    if (stepsToRollback.length === 0) return;

    this.status = ChainStatus.ROLLING_BACK;
    if (this.options.onRollbackStart) {
      this.options.onRollbackStart(stepsToRollback);
    }

    for (const step of stepsToRollback) {
      step.status = StepStatus.ROLLING_BACK;
      try {
        await this.executor(this._substitute(step.rollback_command), step);
        step.status = StepStatus.ROLLED_BACK;
      } catch (e) {
        step.status = StepStatus.FAILED;
      }
    }

    this.status = ChainStatus.ROLLED_BACK;
    if (this.options.onRollbackComplete) {
      this.options.onRollbackComplete();
    }
  }
}
