/**
 * CmdBar Extension Cron Scheduler Module
 * Handles client-side cron parsing, schedule matching, overlap prevention,
 * execution formatting, and timezone awareness in JavaScript.
 *
 * @module extension/cronScheduler
 */

const MONTH_NAMES = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const DAY_NAMES = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

/**
 * Expands cron shorthands like @daily or @hourly into standard 5-part expressions.
 * @param {string} expression
 * @returns {string}
 * @public
 */
export function expandShorthand(expression) {
  if (!expression || typeof expression !== 'string') return '* * * * *';
  const expr = expression.trim();
  const shorthands = {
    '@yearly': '0 0 1 1 *',
    '@annually': '0 0 1 1 *',
    '@monthly': '0 0 1 * *',
    '@weekly': '0 0 * * 0',
    '@daily': '0 0 * * *',
    '@midnight': '0 0 * * *',
    '@hourly': '0 * * * *',
    '@minutely': '* * * * *'
  };
  return shorthands[expr.toLowerCase()] || expr;
}

/**
 * Parses a single cron field string into a set of numbers.
 * @param {string} fieldStr
 * @param {number} minVal
 * @param {number} maxVal
 * @param {Object} [nameMap]
 * @returns {Set<number>}
 * @public
 */
export function parseCronField(fieldStr, minVal, maxVal, nameMap = null) {
  let str = fieldStr.trim().toUpperCase();
  if (nameMap) {
    for (const [name, num] of Object.entries(nameMap)) {
      str = str.replace(new RegExp(`\\b${name}\\b`, 'g'), String(num));
    }
  }

  const results = new Set();
  const parts = str.split(',');

  for (let part of parts) {
    part = part.trim();
    if (!part) continue;

    let step = 1;
    let rangePart = part;

    if (part.includes('/')) {
      const slashParts = part.split('/');
      rangePart = slashParts[0];
      step = parseInt(slashParts[1], 10);
      if (isNaN(step) || step <= 0) {
        throw new Error(`Invalid step value in '${part}'`);
      }
    }

    let startVal, endVal;
    if (rangePart === '*') {
      startVal = minVal;
      endVal = maxVal;
    } else if (rangePart.includes('-')) {
      const rangeParts = rangePart.split('-');
      if (rangeParts.length > 2) throw new Error(`Invalid range in '${part}'`);
      startVal = parseInt(rangeParts[0], 10);
      endVal = parseInt(rangeParts[1], 10);
      if (isNaN(startVal) || isNaN(endVal)) throw new Error(`Invalid range in '${part}'`);
    } else {
      startVal = parseInt(rangePart, 10);
      endVal = startVal;
      if (isNaN(startVal)) throw new Error(`Invalid integer in '${part}'`);
    }

    if (startVal < minVal || endVal > maxVal || startVal > endVal) {
      throw new Error(`Range ${startVal}-${endVal} out of bounds (${minVal}-${maxVal})`);
    }

    for (let v = startVal; v <= endVal; v += step) {
      results.add(v);
    }
  }

  return results;
}

/**
 * Parses a 5-part cron expression string into sets of integers for each time field.
 * @param {string} expression
 * @returns {Object}
 * @public
 */
export function parseCronExpression(expression) {
  const expanded = expandShorthand(expression);
  const fields = expanded.split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression '${expression}'. Expected 5 fields, got ${fields.length}.`);
  }

  const minutes = parseCronField(fields[0], 0, 59);
  const hours = parseCronField(fields[1], 0, 23);
  const dom = parseCronField(fields[2], 1, 31);
  const month = parseCronField(fields[3], 1, 12, MONTH_NAMES);
  const dow = parseCronField(fields[4], 0, 7, DAY_NAMES);

  if (dow.has(7)) dow.add(0);

  return { minutes, hours, dom, month, dow, raw: expression };
}

/**
 * Checks if a date matches a cron expression in the given timezone (or UTC/Local).
 * @param {string} expression
 * @param {Date} [dateObj]
 * @param {string} [tzStr]
 * @returns {boolean}
 * @public
 */
export function isCronDue(expression, dateObj = null, tzStr = 'UTC') {
  const dt = dateObj ? new Date(dateObj) : new Date();
  if (isNaN(dt.getTime())) return false;

  let parsed;
  try {
    parsed = parseCronExpression(expression);
  } catch (e) {
    return false;
  }

  let min, hr, d, m, w;
  if (!tzStr || tzStr.toUpperCase() === 'UTC') {
    min = dt.getUTCMinutes();
    hr = dt.getUTCHours();
    d = dt.getUTCDate();
    m = dt.getUTCMonth() + 1;
    w = dt.getUTCDay();
  } else {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tzStr,
        minute: 'numeric',
        hour: 'numeric',
        day: 'numeric',
        month: 'numeric',
        weekday: 'short',
        hour12: false
      });
      const parts = formatter.formatToParts(dt);
      const partMap = {};
      parts.forEach(p => { partMap[p.type] = p.value; });

      min = parseInt(partMap.minute, 10);
      hr = parseInt(partMap.hour, 10) % 24;
      d = parseInt(partMap.day, 10);
      m = parseInt(partMap.month, 10);
      
      const dayNameMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      w = dayNameMap[partMap.weekday] !== undefined ? dayNameMap[partMap.weekday] : dt.getDay();
    } catch (e) {
      min = dt.getMinutes();
      hr = dt.getHours();
      d = dt.getDate();
      m = dt.getMonth() + 1;
      w = dt.getDay();
    }
  }

  if (!parsed.minutes.has(min)) return false;
  if (!parsed.hours.has(hr)) return false;
  if (!parsed.dom.has(d)) return false;
  if (!parsed.month.has(m)) return false;
  if (!parsed.dow.has(w)) return false;

  return true;
}

/**
 * Formats subject and body for an email report.
 * @param {string} jobName
 * @param {string} command
 * @param {string} status
 * @param {number} exitCode
 * @param {string} stdout
 * @param {string} stderr
 * @param {number} durationSec
 * @returns {Object}
 * @public
 */
export function formatEmailReport(jobName, command, status, exitCode, stdout, stderr, durationSec) {
  const statusUpper = (status || 'UNKNOWN').toUpperCase();
  const subject = `[CmdBar Cron] ${statusUpper}: ${jobName}`;
  const timestamp = new Date().toISOString();

  const body = [
    'CmdBar Cron Job Execution Report',
    '=================================\n',
    `Job Name:     ${jobName}`,
    `Status:       ${statusUpper}`,
    `Exit Code:    ${exitCode}`,
    `Duration:     ${durationSec.toFixed(2)} seconds`,
    `Timestamp:    ${timestamp}`,
    `Command:      ${command}\n`,
    '--- Standard Output ---',
    stdout || '(None)',
    '\n--- Standard Error ---',
    stderr || '(None)'
  ].join('\n');

  return { subject, body };
}

/**
 * CronSchedulerJS class for managing and executing jobs with overlap prevention.
 * @public
 */
export class CronSchedulerJS {
  constructor() {
    this.jobs = new Map();
  }

  addJob(jobData) {
    const job = {
      id: jobData.id || `job-${Date.now()}`,
      name: jobData.name || 'Unnamed Job',
      command: jobData.command || '',
      cronExpression: jobData.cron_expression || jobData.schedule || '* * * * *',
      timezone: jobData.timezone || 'UTC',
      overlapPrevention: jobData.overlap_prevention !== undefined ? jobData.overlap_prevention : true,
      emailReports: jobData.email_reports || { enabled: false, recipient: '', on_success: false, on_failure: true },
      enabled: jobData.enabled !== undefined ? jobData.enabled : true,
      isRunning: false,
      lastRun: jobData.last_run || null,
      lastStatus: jobData.last_status || 'never',
      lastOutput: jobData.last_output || null,
      history: jobData.history || []
    };
    this.jobs.set(job.id, job);
    return job;
  }

  removeJob(jobId) {
    return this.jobs.delete(jobId);
  }

  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  getJobs() {
    return Array.from(this.jobs.values());
  }

  async runJob(jobId, executorFn, force = false) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    if (job.overlapPrevention && job.isRunning && !force) {
      const result = {
        jobId: job.id,
        name: job.name,
        status: 'skipped_overlap',
        exitCode: -1,
        stdout: '',
        stderr: 'Execution skipped: Previous instance is still running.',
        durationSec: 0,
        timestamp: new Date().toISOString()
      };
      job.lastRun = result.timestamp;
      job.lastStatus = result.status;
      job.lastOutput = result;
      job.history.push(result);
      return result;
    }

    job.isRunning = true;
    const startTime = Date.now();
    let code = -1;
    let stdout = '';
    let stderr = '';
    let status = 'error';

    try {
      const execResult = await executorFn(job.command);
      code = execResult.exitCode !== undefined ? execResult.exitCode : 0;
      stdout = execResult.stdout || '';
      stderr = execResult.stderr || '';
      status = code === 0 ? 'success' : 'failed';
    } catch (e) {
      code = -1;
      stderr = `Execution exception: ${e.message}`;
      status = 'error';
    } finally {
      job.isRunning = false;
    }

    const durationSec = (Date.now() - startTime) / 1000;
    const result = {
      jobId: job.id,
      name: job.name,
      status,
      exitCode: code,
      stdout,
      stderr,
      durationSec,
      timestamp: new Date().toISOString()
    };

    job.lastRun = result.timestamp;
    job.lastStatus = status;
    job.lastOutput = result;
    job.history.push(result);

    if (job.history.length > 50) job.history.shift();

    return result;
  }

  checkAndRunDueJobs(dateObj = new Date(), executorFn = null) {
    const dueJobs = [];
    for (const job of this.jobs.values()) {
      if (!job.enabled) continue;
      if (isCronDue(job.cronExpression, dateObj, job.timezone)) {
        dueJobs.push(job);
      }
    }
    return dueJobs;
  }
}
