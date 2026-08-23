import { jest } from '@jest/globals';
import {
  expandShorthand,
  parseCronField,
  parseCronExpression,
  isCronDue,
  formatEmailReport,
  CronSchedulerJS
} from '../extension/cronScheduler.js';

describe('Cron Scheduler JS Module', () => {
  describe('expandShorthand', () => {
    test('expands standard shorthands correctly', () => {
      expect(expandShorthand('@daily')).toBe('0 0 * * *');
      expect(expandShorthand('@hourly')).toBe('0 * * * *');
      expect(expandShorthand('@weekly')).toBe('0 0 * * 0');
      expect(expandShorthand('@monthly')).toBe('0 0 1 * *');
      expect(expandShorthand('@yearly')).toBe('0 0 1 1 *');
      expect(expandShorthand('@minutely')).toBe('* * * * *');
      expect(expandShorthand('*/5 * * * *')).toBe('*/5 * * * *');
    });
  });

  describe('parseCronField', () => {
    test('parses wildcards, steps, ranges, and lists', () => {
      const wildcardSet = parseCronField('*', 0, 5);
      expect(wildcardSet).toEqual(new Set([0, 1, 2, 3, 4, 5]));

      const stepSet = parseCronField('*/2', 0, 5);
      expect(stepSet).toEqual(new Set([0, 2, 4]));

      const rangeSet = parseCronField('1-3', 0, 5);
      expect(rangeSet).toEqual(new Set([1, 2, 3]));

      const listSet = parseCronField('1,3,5', 0, 5);
      expect(listSet).toEqual(new Set([1, 3, 5]));
    });

    test('throws error for invalid values or out of bounds', () => {
      expect(() => parseCronField('10', 0, 5)).toThrow();
      expect(() => parseCronField('*/0', 0, 5)).toThrow();
      expect(() => parseCronField('invalid', 0, 5)).toThrow();
    });
  });

  describe('parseCronExpression', () => {
    test('parses 5-field cron expression with month/dow names', () => {
      const parsed = parseCronExpression('0 12 * JAN MON');
      expect(parsed.minutes.has(0)).toBe(true);
      expect(parsed.hours.has(12)).toBe(true);
      expect(parsed.month.has(1)).toBe(true);
      expect(parsed.dow.has(1)).toBe(true);
    });

    test('throws error for invalid field count', () => {
      expect(() => parseCronExpression('invalid')).toThrow();
    });
  });

  describe('isCronDue', () => {
    test('evaluates UTC cron due time', () => {
      const dt = new Date(Date.UTC(2026, 7, 23, 12, 0, 0)); // 2026-08-23 12:00 UTC
      expect(isCronDue('0 12 * * *', dt, 'UTC')).toBe(true);
      expect(isCronDue('0 13 * * *', dt, 'UTC')).toBe(false);
    });
  });

  describe('formatEmailReport', () => {
    test('formats report subject and body', () => {
      const report = formatEmailReport(
        'Database Backup',
        'pg_dump mydb',
        'success',
        0,
        'Backup complete',
        '',
        2.5
      );

      expect(report.subject).toBe('[CmdBar Cron] SUCCESS: Database Backup');
      expect(report.body).toContain('Job Name:     Database Backup');
      expect(report.body).toContain('Exit Code:    0');
      expect(report.body).toContain('Backup complete');
    });
  });

  describe('CronSchedulerJS Class', () => {
    test('manages jobs and overlap prevention', async () => {
      const scheduler = new CronSchedulerJS();

      const job = scheduler.addJob({
        id: 'job-1',
        name: 'Test Job',
        command: 'echo test',
        cron_expression: '* * * * *',
        overlap_prevention: true
      });

      expect(scheduler.getJobs().length).toBe(1);

      // Simulate execution
      const mockExecutor = jest.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' });
      const res = await scheduler.runJob('job-1', mockExecutor);

      expect(res.status).toBe('success');
      expect(res.exitCode).toBe(0);
      expect(mockExecutor).toHaveBeenCalledWith('echo test');

      // Test overlap prevention
      job.isRunning = true;
      const resOverlap = await scheduler.runJob('job-1', mockExecutor);
      expect(resOverlap.status).toBe('skipped_overlap');

      // Remove job
      expect(scheduler.removeJob('job-1')).toBe(true);
      expect(scheduler.getJobs().length).toBe(0);
    });

    test('checks and returns due jobs', () => {
      const scheduler = new CronSchedulerJS();
      scheduler.addJob({ id: 'due-1', cron_expression: '* * * * *', enabled: true });
      scheduler.addJob({ id: 'disabled-1', cron_expression: '* * * * *', enabled: false });

      const due = scheduler.checkAndRunDueJobs(new Date());
      expect(due.length).toBe(1);
      expect(due[0].id).toBe('due-1');
    });
  });
});
