import {
  parseCronField,
  parseCronExpression,
  isValidCronExpression,
  getNextRunTime,
  shouldJobRunNow,
  CronJobRunnerJS,
  CronSchedulerJS,
  PRESET_CRON_MAP,
} from "../extension/cronScheduler.js";

describe("JS Cron Scheduler Unit Tests", () => {
  test("parseCronField parses range, lists, steps correctly", () => {
    const minSet = parseCronField("*", 0, 59);
    expect(minSet.size).toBe(60);

    const stepSet = parseCronField("*/15", 0, 59);
    expect(Array.from(stepSet)).toEqual([0, 15, 30, 45]);

    const listSet = parseCronField("1,5,10", 0, 59);
    expect(Array.from(listSet)).toEqual([1, 5, 10]);

    expect(() => parseCronField("60", 0, 59)).toThrow();
  });

  test("parseCronExpression and macro handling", () => {
    const parsed = parseCronExpression("0 12 * * 1-5");
    expect(Array.from(parsed.minute)).toEqual([0]);
    expect(Array.from(parsed.hour)).toEqual([12]);
    expect(Array.from(parsed.weekday)).toEqual([1, 2, 3, 4, 5]);

    expect(isValidCronExpression("@daily")).toBe(true);
    expect(isValidCronExpression("@hourly")).toBe(true);
    expect(isValidCronExpression("invalid cron")).toBe(false);
  });

  test("getNextRunTime calculates correct next run", () => {
    const base = new Date("2026-08-23T12:00:00Z");
    const nextMin = getNextRunTime("* * * * *", base);
    expect(nextMin.getMinutes()).toBe(1);

    const nextHour = getNextRunTime("0 * * * *", base);
    expect(nextHour.getHours()).toBe(13);
    expect(nextHour.getMinutes()).toBe(0);
  });

  test("shouldJobRunNow evaluates timing correctly", () => {
    const now = new Date("2026-08-23T12:30:00Z");
    expect(shouldJobRunNow("30 12 * * *", now)).toBe(true);
    expect(shouldJobRunNow("31 12 * * *", now)).toBe(false);

    // Duplicate trigger prevention
    const lastRun = new Date("2026-08-23T12:30:10Z");
    expect(shouldJobRunNow("30 12 * * *", now, "Local", lastRun)).toBe(false);
  });

  test("CronJobRunnerJS overlap prevention", async () => {
    const runner = new CronJobRunnerJS();
    const job = {
      id: "js-slow-job",
      name: "JS Slow Job",
      command: "sleep 1",
      prevent_overlap: true,
    };

    let slowResolve;
    const slowFn = () =>
      new Promise((resolve) => {
        slowResolve = resolve;
      });

    const p1 = runner.executeJob(job, slowFn);
    expect(runner.isJobRunning("js-slow-job")).toBe(true);

    const res2 = await runner.executeJob(job, slowFn);
    expect(res2.status).toBe("skipped");
    expect(res2.reason).toBe("overlap_prevented");

    slowResolve({ stdout: "done", stderr: "", exitCode: 0 });
    const res1 = await p1;
    expect(res1.status).toBe("success");
    expect(runner.isJobRunning("js-slow-job")).toBe(false);
  });

  test("CronSchedulerJS add, run, delete lifecycle", async () => {
    const scheduler = new CronSchedulerJS(async (cmd) => ({
      stdout: `Output: ${cmd}`,
      stderr: "",
      exitCode: 0,
    }));

    const sched = scheduler.addOrUpdateSchedule({
      id: "js-sched-1",
      name: "JS Test Schedule",
      command: "echo test",
      schedule: "* * * * *",
    });

    expect(sched.id).toBe("js-sched-1");
    expect(scheduler.getSchedules().length).toBe(1);

    const res = await scheduler.runJobNow("js-sched-1");
    expect(res.status).toBe("success");
    expect(res.stdout).toContain("Output: echo test");

    const deleted = scheduler.deleteSchedule("js-sched-1");
    expect(deleted).toBe(true);
    expect(scheduler.getSchedules().length).toBe(0);
  });
});
