# Cron Scheduling Support in CmdBar

CmdBar includes built-in cron scheduling support for automating background tasks and recurring terminal commands. With CmdBar's scheduling engine, you can schedule commands with standard cron syntax or shorthands, configure timezone offsets, prevent concurrent overlaps, log execution history, and receive email reports upon completion or failure.

---

## Features

- **Cron Expression Parsing**: Supports standard 5-part cron expressions (`minute hour dom month dow`) as well as shorthands like `@hourly`, `@daily`, `@weekly`, `@monthly`, `@yearly`, step intervals (`*/5`), ranges (`1-5`), and lists (`1,15,30`).
- **Visual Editor**: Integrated Libadwaita / GTK graphical editor in `app/main.py` with schedule presets, real-time expression validation, and projected run-time previews.
- **Timezone Support**: Schedule jobs in `UTC`, local desktop timezone, or specific IANA timezones (e.g. `America/New_York`, `Europe/London`, `Asia/Tokyo`).
- **Overlap Prevention**: Automatically prevents concurrent execution if a previous instance of a scheduled job is still running.
- **Error Handling & History**: Captures exit codes, stdout, stderr, and execution duration without crashing the background daemon. Maintains historical execution records.
- **Email Reports**: Sends customizable email reports on execution completion or failure via SMTP.

---

## Configuration Schema

Cron jobs are stored in `~/.config/cmdbar/config.json` under the `"cron_jobs"` key:

```json
{
  "cron_jobs": [
    {
      "id": "job-1700000000",
      "name": "Nightly Database Backup",
      "command": "pg_dump mydb > /backups/mydb.sql",
      "cron_expression": "0 2 * * *",
      "timezone": "America/New_York",
      "overlap_prevention": true,
      "email_reports": {
        "enabled": true,
        "recipient": "devops@example.com",
        "on_failure": true,
        "on_success": false
      },
      "enabled": true
    }
  ]
}
```

---

## Usage in Management Apps

### 1. Visual Editor (Libadwaita Companion)
Launch the management app:
```bash
python3 app/main.py
```
Click the **Alarm Icon** in the sidebar header to open the **Cron Schedule Editor**.
- Click **Add Scheduled Job** to open the visual dialog.
- Select a preset (e.g. "Every 5 Minutes", "Daily at Midnight") or enter a custom expression.
- Set the target timezone, toggle overlap prevention, and configure email notification settings.
- Click **Run Job Now** to trigger manual execution or **Run Due Jobs Now** to evaluate schedules.

### 2. CLI Companion App
Run CLI companion mode:
```bash
python3 companion/companion_app.py
```
Select **7. Manage Cron Schedules** from the main menu to list, add, edit, delete, or run scheduled jobs.

---

## D-Bus API Integration

CmdBar exposes D-Bus methods for managing and evaluating cron jobs programmatically on Session Bus `org.gnome.CmdBar`:

| Method | Parameters | Return Type | Description |
|--------|------------|-------------|-------------|
| `GetCronJobs` | *None* | `string` (JSON) | Get all configured cron jobs |
| `AddCronJob` | `string job_json` | `boolean` | Add or update a cron job |
| `RemoveCronJob` | `string job_id` | `boolean` | Remove a cron job by ID |
| `RunCronJob` | `string job_id` | `boolean` | Manually run a cron job by ID |
| `CheckAndRunDueCronJobs` | *None* | `string` (JSON) | Evaluate and execute all due cron jobs |

---

## Python & JavaScript API

### Python API (`app/cron_scheduler.py`)
```python
from app.cron_scheduler import CronScheduler, CronJob

scheduler = CronScheduler()
scheduler.load_from_config(config_data)

# Check and execute due jobs
results = scheduler.check_and_run_due_jobs()
```

### JavaScript API (`extension/cronScheduler.js`)
```javascript
import { CronSchedulerJS, isCronDue } from './extension/cronScheduler.js';

const scheduler = new CronSchedulerJS();
scheduler.addJob({
  id: 'backup-1',
  name: 'Backup',
  command: 'tar -czf backup.tar.gz /data',
  cron_expression: '0 0 * * *',
  timezone: 'UTC'
});
```
