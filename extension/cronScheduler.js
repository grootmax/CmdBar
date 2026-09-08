/**
 * Cron Scheduling Support for CmdBar (JavaScript/GJS/Node environment).
 * Handles cron expression parsing, timezone calculation, overlap prevention, and schedule execution ticks.
 */

export const PRESET_CRON_MAP = {
  "@every_minute": "* * * * *",
  "@minutely": "* * * * *",
  "@every_5_minutes": "*/5 * * * *",
  "@every_15_minutes": "*/15 * * * *",
  "@every_30_minutes": "*/30 * * * *",
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
};

export function parseCronField(fieldStr, minVal, maxVal) {
  if (!fieldStr || typeof fieldStr !== "string") {
    throw new Error("Invalid cron field string");
  }
  const clean = fieldStr.trim();
  if (!clean) throw new Error("Empty cron field");

  const result = new Set();
  const parts = clean.split(",");

  for (let part of parts) {
    part = part.trim();
    if (!part) throw new Error(`Invalid subfield in '${clean}'`);

    let step = 1;
    let rangePart = part;
    if (part.includes("/")) {
      const subparts = part.split("/");
      if (subparts.length !== 2) throw new Error(`Invalid step syntax in '${part}'`);
      rangePart = subparts[0];
      step = parseInt(subparts[1], 10);
      if (isNaN(step) || step <= 0) throw new Error(`Invalid step value '${subparts[1]}'`);
    }

    let start = minVal;
    let end = maxVal;

    if (rangePart === "*") {
      start = minVal;
      end = maxVal;
    } else if (rangePart.includes("-")) {
      const rParts = rangePart.split("-");
      if (rParts.length !== 2) throw new Error(`Invalid range syntax in '${rangePart}'`);
      start = parseInt(rParts[0], 10);
      end = parseInt(rParts[1], 10);
      if (isNaN(start) || isNaN(end) || start > end || start < minVal || end > maxVal) {
        throw new Error(`Range ${start}-${end} out of bounds (${minVal}-${maxVal})`);
      }
    } else if (/^\d+$/.test(rangePart)) {
      const val = parseInt(rangePart, 10);
      if (val < minVal || val > maxVal) {
        throw new Error(`Value ${val} out of bounds (${minVal}-${maxVal})`);
      }
      start = val;
      end = val;
    } else {
      throw new Error(`Invalid characters in cron field '${rangePart}'`);
    }

    for (let v = start; v <= end; v += step) {
      if (v >= minVal && v <= maxVal) {
        result.add(v);
      }
    }
  }

  if (result.size === 0) {
    throw new Error(`Field '${fieldStr}' produced no valid values`);
  }

  return result;
}

export function parseCronExpression(expr) {
  if (!expr || typeof expr !== "string") {
    throw new Error("Cron expression must be a non-empty string");
  }
  let cleanExpr = expr.trim();
  const macroKey = cleanExpr.toLowerCase();
  if (PRESET_CRON_MAP[macroKey]) {
    cleanExpr = PRESET_CRON_MAP[macroKey];
  }

  const parts = cleanExpr.split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Cron expression must contain 5 fields, got ${parts.length}: '${expr}'`);
  }

  const minute = parseCronField(parts[0], 0, 59);
  const hour = parseCronField(parts[1], 0, 23);
  const day = parseCronField(parts[2], 1, 31);
  const month = parseCronField(parts[3], 1, 12);
  const rawWeekday = parseCronField(parts[4], 0, 7);

  const weekday = new Set();
  for (let w of rawWeekday) {
    weekday.add(w === 7 ? 0 : w);
  }

  return {
    minute,
    hour,
    day,
    month,
    weekday,
    rawExpression: cleanExpr,
  };
}

export function isValidCronExpression(expr) {
  try {
    parseCronExpression(expr);
    return true;
  } catch (e) {
    return false;
  }
}

export function getNextRunTime(expr, baseTime = null, tzStr = "Local") {
  const parsed = parseCronExpression(expr);
  let base = baseTime ? new Date(baseTime) : new Date();
  if (isNaN(base.getTime())) base = new Date();

  // Search forward minute by minute
  let candidate = new Date(base.getTime() + 60000);
  candidate.setSeconds(0, 0);

  const maxMinutes = 5 * 365 * 24 * 60;
  let searched = 0;

  while (searched < maxMinutes) {
    const curMonth = candidate.getMonth() + 1; // 1-12
    const curDay = candidate.getDate();
    const curWeekday = candidate.getDay(); // 0 (Sun) - 6 (Sat)
    const curHour = candidate.getHours();
    const curMinute = candidate.getMinutes();

    if (!parsed.month.has(curMonth)) {
      candidate.setMonth(candidate.getMonth() + 1, 1);
      candidate.setHours(0, 0, 0, 0);
      searched += 60;
      continue;
    }

    if (!parsed.day.has(curDay) || !parsed.weekday.has(curWeekday)) {
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(0, 0, 0, 0);
      searched += 60;
      continue;
    }

    if (!parsed.hour.has(curHour)) {
      candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
      searched += 60;
      continue;
    }

    if (parsed.minute.has(curMinute)) {
      return candidate;
    }

    candidate.setMinutes(candidate.getMinutes() + 1);
    searched++;
  }

  throw new Error(`Unable to find next run time for expression '${expr}'`);
}

export function shouldJobRunNow(expr, currentTime = null, tzStr = "Local", lastRun = null) {
  const cur = currentTime ? new Date(currentTime) : new Date();
  if (lastRun) {
    const lr = new Date(lastRun);
    if (
      lr.getFullYear() === cur.getFullYear() &&
      lr.getMonth() === cur.getMonth() &&
      lr.getDate() === cur.getDate() &&
      lr.getHours() === cur.getHours() &&
      lr.getMinutes() === cur.getMinutes()
    ) {
      return false;
    }
  }

  const parsed = parseCronExpression(expr);
  const curMonth = cur.getMonth() + 1;
  const curDay = cur.getDate();
  const curWeekday = cur.getDay();
  const curHour = cur.getHours();
  const curMinute = cur.getMinutes();

  return (
    parsed.minute.has(curMinute) &&
    parsed.hour.has(curHour) &&
    parsed.day.has(curDay) &&
    parsed.month.has(curMonth) &&
    parsed.weekday.has(curWeekday)
  );
}

export class CronJobRunnerJS {
  constructor() {
    this._activeJobs = new Set();
  }

  isJobRunning(jobId) {
    return this._activeJobs.has(jobId);
  }

  async executeJob(job, executeCmdFn) {
    const jobId = job.id || job.name || "unknown_job";
    const preventOverlap = job.prevent_overlap !== false;

    if (preventOverlap && this._activeJobs.has(jobId)) {
      return {
        status: "skipped",
        reason: "overlap_prevented",
        stdout: "",
        stderr: `Execution skipped for job '${job.name || jobId}': overlap prevention active.`,
        exitCode: -1,
        durationMs: 0,
        timestamp: new Date().toISOString(),
      };
    }

    this._activeJobs.add(jobId);
    const startTime = Date.now();

    try {
      let result;
      if (typeof executeCmdFn === "function") {
        result = await executeCmdFn(job.command);
      } else {
        result = { stdout: "executed", stderr: "", exitCode: 0 };
      }

      const durationMs = Date.now() - startTime;
      const status = result.exitCode === 0 ? "success" : "failed";

      return {
        status,
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        status: "failed",
        exitCode: -1,
        stdout: "",
        stderr: `Execution failed: ${err.message}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } finally {
      this._activeJobs.delete(jobId);
    }
  }
}

export class CronSchedulerJS {
  constructor(executeCmdFn = null) {
    this._executeCmdFn = executeCmdFn;
    this._runner = new CronJobRunnerJS();
    this._schedules = [];
    this._timerId = null;
  }

  setSchedules(schedules) {
    this._schedules = Array.isArray(schedules) ? [...schedules] : [];
  }

  getSchedules() {
    return [...this._schedules];
  }

  addOrUpdateSchedule(schedule) {
    if (!schedule || typeof schedule !== "object") return null;
    const sId = schedule.id || `sched-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    schedule.id = sId;

    if (!isValidCronExpression(schedule.schedule || "")) {
      throw new Error(`Invalid cron expression: '${schedule.schedule}'`);
    }

    const nextRun = getNextRunTime(schedule.schedule, null, schedule.timezone || "Local");
    schedule.next_run = nextRun.toISOString();

    const idx = this._schedules.findIndex((s) => s.id === sId || s.name === schedule.name);
    if (idx >= 0) {
      this._schedules[idx] = schedule;
    } else {
      this._schedules.push(schedule);
    }
    return schedule;
  }

  deleteSchedule(sIdOrName) {
    const initLen = this._schedules.length;
    this._schedules = this._schedules.filter((s) => s.id !== sIdOrName && s.name !== sIdOrName);
    return this._schedules.length < initLen;
  }

  async runJobNow(sIdOrName) {
    const target = this._schedules.find((s) => s.id === sIdOrName || s.name === sIdOrName);
    if (!target) {
      return {
        status: "failed",
        exitCode: -1,
        stdout: "",
        stderr: `Schedule '${sIdOrName}' not found.`,
        durationMs: 0,
        timestamp: new Date().toISOString(),
      };
    }

    const res = await this._runner.executeJob(target, this._executeCmdFn);
    target.last_run = res.timestamp;
    target.last_status = res.status;
    target.last_output = res.stdout;
    target.last_error = res.stderr;
    return res;
  }

  async tick(checkTime = null) {
    const curTime = checkTime || new Date();
    const activeSchedules = this._schedules.filter((s) => s.enabled !== false);

    for (let s of activeSchedules) {
      if (shouldJobRunNow(s.schedule, curTime, s.timezone || "Local", s.last_run)) {
        this.runJobNow(s.id).catch((err) => console.error(`CmdBar JS Cron Error: ${err.message}`));
      }
    }
  }
}
