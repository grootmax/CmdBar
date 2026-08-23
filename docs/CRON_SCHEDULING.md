# Cron Scheduling Support

**Automated Command Execution with Visual Editor, Timezone Awareness, Overlap Prevention, and Email Reporting**

CmdBar includes built-in cron scheduling support allowing developers to automate shell commands on periodic schedules directly from the top-bar extension and companion application.

---

## Key Features

- **Standard 5-Part Cron Expressions & Macros**: Supports standard cron syntax (`minute hour day month weekday`) and macros such as `@every_minute`, `@hourly`, `@daily`, `@weekly`, `@monthly`, and `@yearly`.
- **Visual Editor**: Integrated frequency preset picker, live next-run calculation preview, timezone dropdown, and execution history/logs viewer in the companion application.
- **Timezone Support**: Evaluates next run times respecting configured timezones (`UTC`, `America/New_York`, `Europe/London`, `Asia/Tokyo`, `Local`, etc.).
- **Overlap Prevention**: Ensures concurrent executions of the same job are skipped if a previous instance is still active (`prevent_overlap: true`).
- **Email Reporting**: Automated email notification reports detailing execution status, duration, stdout, and stderr. Supports configurable triggers (`on_failure` or `always`).
- **D-Bus Integration**: Programmatic schedule management via D-Bus (`GetSchedules`, `AddSchedule`, `RemoveSchedule`, `RunScheduleNow`) and `ScheduleExecuted` signals.

---

## Configuration Schema

Schedules are stored in `~/.config/cmdbar/config.json` under the `"schedules"` list:

```json
{
  "schedules": [
    {
      "id": "backup-db",
      "name": "Daily Database Backup",
      "command": "/usr/local/bin/backup-db.sh",
      "schedule": "0 0 * * *",
      "timezone": "UTC",
      "enabled": true,
      "prevent_overlap": true,
      "email_reports": {
        "enabled": true,
        "recipients": ["dev-alerts@example.com"],
        "trigger": "on_failure"
      },
      "last_run": "2026-08-23T00:00:00Z",
      "next_run": "2026-08-24T00:00:00Z",
      "last_status": "success",
      "last_output": "Backup completed successfully.",
      "last_error": ""
    }
  ]
}
```

---

## Python API Example

```python
from app.cron_scheduler import CronScheduler, get_next_run_time

scheduler = CronScheduler()

# Calculate next run
next_time = get_next_run_time("0 12 * * *", tz_str="America/New_York")
print(f"Next run time: {next_time}")

# Add and execute a job
scheduler.add_or_update_schedule({
    "id": "job-1",
    "name": "Sync Repos",
    "command": "git pull",
    "schedule": "@hourly"
})

res = scheduler.run_job_now("job-1")
print(f"Execution status: {res['status']}")
```
