import os
import sys
import time
import json
import uuid
import re
import shlex
import subprocess
import threading
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

PRESET_CRON_MAP = {
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
}

PRESET_DESCRIPTIONS = {
    "* * * * *": "Every minute",
    "*/5 * * * *": "Every 5 minutes",
    "*/15 * * * *": "Every 15 minutes",
    "*/30 * * * *": "Every 30 minutes",
    "0 * * * *": "Every hour",
    "0 0 * * *": "Daily at midnight",
    "0 12 * * *": "Daily at 12:00 PM",
    "0 0 * * 0": "Weekly on Sunday at midnight",
    "0 0 1 * *": "Monthly on 1st at midnight",
}


def parse_cron_field(field_str: str, min_val: int, max_val: int) -> set:
    """
    Parses a single cron field (e.g. '*', '*/5', '1,2,5', '10-15', '1-10/2').
    Returns a set of matching integers.
    Raises ValueError on invalid syntax or out-of-bound values.
    """
    field_str = field_str.strip()
    if not field_str:
        raise ValueError("Empty cron field")

    result = set()

    for part in field_str.split(","):
        part = part.strip()
        if not part:
            raise ValueError(f"Invalid subfield in '{field_str}'")

        step = 1
        if "/" in part:
            subparts = part.split("/")
            if len(subparts) != 2:
                raise ValueError(f"Invalid step syntax in '{part}'")
            range_part, step_str = subparts
            if not step_str.isdigit() or int(step_str) <= 0:
                raise ValueError(f"Invalid step value '{step_str}'")
            step = int(step_str)
        else:
            range_part = part

        if range_part == "*":
            start, end = min_val, max_val
        elif "-" in range_part:
            r_parts = range_part.split("-")
            if len(r_parts) != 2 or not r_parts[0].isdigit() or not r_parts[1].isdigit():
                raise ValueError(f"Invalid range syntax in '{range_part}'")
            start, end = int(r_parts[0]), int(r_parts[1])
            if start > end or start < min_val or end > max_val:
                raise ValueError(f"Range {start}-{end} out of bounds ({min_val}-{max_val})")
        elif range_part.isdigit():
            val = int(range_part)
            if val < min_val or val > max_val:
                raise ValueError(f"Value {val} out of bounds ({min_val}-{max_val})")
            start, end = val, val
        else:
            raise ValueError(f"Invalid characters in cron field '{range_part}'")

        for v in range(start, end + 1, step):
            if min_val <= v <= max_val:
                result.add(v)

    if not result:
        raise ValueError(f"Field '{field_str}' produced no valid values")

    return result


def parse_cron_expression(expr: str) -> dict:
    """
    Parses a full 5-part cron expression or shorthand macro into matching integer sets.
    Returns dict: {'minute': set, 'hour': set, 'day': set, 'month': set, 'weekday': set}
    """
    clean_expr = expr.strip()
    if clean_expr.lower() in PRESET_CRON_MAP:
        clean_expr = PRESET_CRON_MAP[clean_expr.lower()]

    parts = clean_expr.split()
    if len(parts) != 5:
        raise ValueError(f"Cron expression must contain exactly 5 space-separated fields, got {len(parts)}: '{expr}'")

    minute = parse_cron_field(parts[0], 0, 59)
    hour = parse_cron_field(parts[1], 0, 23)
    day = parse_cron_field(parts[2], 1, 31)
    month = parse_cron_field(parts[3], 1, 12)
    # 0 or 7 = Sunday in standard cron
    raw_weekday = parse_cron_field(parts[4], 0, 7)
    weekday = set()
    for w in raw_weekday:
        weekday.add(0 if w == 7 else w)

    return {
        "minute": minute,
        "hour": hour,
        "day": day,
        "month": month,
        "weekday": weekday,
        "raw_expression": clean_expr
    }


def is_valid_cron_expression(expr: str) -> bool:
    """Returns True if the string is a valid cron expression or shorthand macro."""
    try:
        parse_cron_expression(expr)
        return True
    except Exception:
        return False


def get_timezone_object(tz_str: str = "Local"):
    """
    Resolves timezone string to a ZoneInfo or timezone object.
    Supports 'Local', 'UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo', etc.
    Defaults safely to Local timezone if tz_str is unrecognized or None.
    """
    if not tz_str or str(tz_str).strip().lower() in ("local", ""):
        return datetime.now().astimezone().tzinfo or timezone.utc

    clean_tz = str(tz_str).strip()
    if clean_tz.upper() == "UTC":
        return timezone.utc

    try:
        return ZoneInfo(clean_tz)
    except (ZoneInfoNotFoundError, Exception):
        return datetime.now().astimezone().tzinfo or timezone.utc


def get_next_run_time(expr: str, base_time: datetime = None, tz_str: str = "Local") -> datetime:
    """
    Calculates the next execution datetime matching the cron expression starting after base_time.
    Respects target timezone tz_str.
    Returns timezone-aware datetime object.
    """
    tz = get_timezone_object(tz_str)

    if base_time is None:
        base_time = datetime.now(tz)
    elif base_time.tzinfo is None:
        base_time = base_time.replace(tzinfo=tz)
    else:
        base_time = base_time.astimezone(tz)

    parsed = parse_cron_expression(expr)

    # Move to start of next minute
    candidate = base_time.replace(second=0, microsecond=0) + timedelta(minutes=1)

    # Search for matching minute (max 5 years into future)
    max_search_minutes = 5 * 365 * 24 * 60
    searched = 0

    while searched < max_search_minutes:
        if candidate.month not in parsed["month"]:
            # Jump to 1st of next month
            if candidate.month == 12:
                candidate = candidate.replace(year=candidate.year + 1, month=1, day=1, hour=0, minute=0)
            else:
                candidate = candidate.replace(month=candidate.month + 1, day=1, hour=0, minute=0)
            searched += 60
            continue

        if candidate.day not in parsed["day"]:
            candidate = (candidate + timedelta(days=1)).replace(hour=0, minute=0)
            searched += 60
            continue

        # Python weekday: Mon=0, Sun=6. Cron weekday: Sun=0, Sat=6.
        cron_weekday = (candidate.weekday() + 1) % 7
        if cron_weekday not in parsed["weekday"]:
            candidate = (candidate + timedelta(days=1)).replace(hour=0, minute=0)
            searched += 60
            continue

        if candidate.hour not in parsed["hour"]:
            candidate = (candidate + timedelta(hours=1)).replace(minute=0)
            searched += 60
            continue

        if candidate.minute in parsed["minute"]:
            return candidate

        candidate += timedelta(minutes=1)
        searched += 1

    raise ValueError(f"Could not calculate next run time within search window for expression '{expr}'")


def should_job_run_now(expr: str, current_time: datetime = None, tz_str: str = "Local", last_run: datetime = None) -> bool:
    """
    Checks if a job with expression `expr` should run at `current_time`.
    Prevents duplicate triggers within the same minute if last_run is within the same minute.
    """
    tz = get_timezone_object(tz_str)
    if current_time is None:
        current_time = datetime.now(tz)
    elif current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=tz)
    else:
        current_time = current_time.astimezone(tz)

    if last_run is not None:
        if last_run.tzinfo is None:
            last_run = last_run.replace(tzinfo=tz)
        else:
            last_run = last_run.astimezone(tz)

        # If last run was in the exact same minute, don't re-trigger
        if (last_run.year == current_time.year and
            last_run.month == current_time.month and
            last_run.day == current_time.day and
            last_run.hour == current_time.hour and
            last_run.minute == current_time.minute):
            return False

    parsed = parse_cron_expression(expr)
    cron_weekday = (current_time.weekday() + 1) % 7

    return (
        current_time.minute in parsed["minute"] and
        current_time.hour in parsed["hour"] and
        current_time.day in parsed["day"] and
        current_time.month in parsed["month"] and
        cron_weekday in parsed["weekday"]
    )


# Custom callback hook for unit testing email reports without network
_EMAIL_SENT_HOOK = None


def set_email_sent_hook(hook):
    """Sets a testing callback function(msg_dict) -> None called when email is sent."""
    global _EMAIL_SENT_HOOK
    _EMAIL_SENT_HOOK = hook


def send_email_report(job: dict, execution_result: dict, smtp_config: dict = None) -> bool:
    """
    Sends an email report detailing scheduled command execution results.
    `smtp_config` can contain: host, port, user, password, use_tls, use_ssl, from_email.
    """
    email_cfg = job.get("email_reports", {})
    if isinstance(email_cfg, bool):
        email_cfg = {"enabled": email_cfg, "recipients": [], "trigger": "on_failure"}

    if not email_cfg.get("enabled"):
        return False

    recipients = email_cfg.get("recipients", [])
    if isinstance(recipients, str):
        recipients = [r.strip() for r in recipients.split(",") if r.strip()]

    if not recipients:
        return False

    trigger = email_cfg.get("trigger", "on_failure")
    status = execution_result.get("status", "unknown")

    if trigger == "on_failure" and status != "failed":
        return False

    job_name = job.get("name", "Unnamed Schedule")
    cmd_str = job.get("command", "")
    exit_code = execution_result.get("exit_code", -1)
    duration_ms = execution_result.get("duration_ms", 0)
    stdout = execution_result.get("stdout", "")
    stderr = execution_result.get("stderr", "")

    subject = f"[CmdBar Schedule Report] {job_name} - {status.upper()}"

    body = f"""CmdBar Cron Schedule Execution Report
==================================================
Schedule Name : {job_name}
Command       : {cmd_str}
Schedule Expr : {job.get('schedule', '')}
Timezone      : {job.get('timezone', 'Local')}
Status        : {status.upper()}
Exit Code     : {exit_code}
Duration      : {duration_ms:.2f} ms
Timestamp     : {datetime.now(timezone.utc).isoformat()}

--- STDOUT ---
{stdout if stdout else '(empty)'}

--- STDERR ---
{stderr if stderr else '(empty)'}
==================================================
"""

    if _EMAIL_SENT_HOOK is not None:
        try:
            _EMAIL_SENT_HOOK({
                "recipients": recipients,
                "subject": subject,
                "body": body,
                "job": job,
                "result": execution_result
            })
            return True
        except Exception:
            pass

    if not smtp_config:
        smtp_config = email_cfg.get("smtp_config", {})

    host = smtp_config.get("host", "localhost")
    port = int(smtp_config.get("port", 25))
    user = smtp_config.get("user", "")
    password = smtp_config.get("password", "")
    use_tls = smtp_config.get("use_tls", False)
    use_ssl = smtp_config.get("use_ssl", False)
    from_email = smtp_config.get("from_email", "cmdbar-cron@localhost")

    try:
        msg = MIMEMultipart()
        msg["From"] = from_email
        msg["To"] = ", ".join(recipients)
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain"))

        if use_ssl:
            server = smtplib.SMTP_SSL(host, port, timeout=10)
        else:
            server = smtplib.SMTP(host, port, timeout=10)
            if use_tls:
                server.starttls()

        if user and password:
            server.login(user, password)

        server.sendmail(from_email, recipients, msg.as_string())
        server.quit()
        return True
    except Exception as e:
        sys.stderr.write(f"CmdBar Cron: Failed to send email report for '{job_name}': {e}\n")
        return False


class CronJobRunner:
    """
    Manages job execution with thread-safe overlap prevention and error capturing.
    """
    def __init__(self):
        self._active_jobs = set()
        self._lock = threading.Lock()

    def is_job_running(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._active_jobs

    def get_active_job_ids(self) -> list:
        with self._lock:
            return list(self._active_jobs)

    def execute_job(self, job: dict, config: dict = None, smtp_config: dict = None, timeout: float = 3600.0) -> dict:
        """
        Executes a scheduled job with overlap prevention, error catching, and email reporting.
        Returns execution result dictionary.
        """
        job_id = job.get("id") or job.get("name") or "unknown_job"
        prevent_overlap = job.get("prevent_overlap", True)

        with self._lock:
            if prevent_overlap and job_id in self._active_jobs:
                msg = f"Execution skipped for job '{job.get('name', job_id)}': previous execution is still in progress (overlap prevention active)."
                return {
                    "status": "skipped",
                    "reason": "overlap_prevented",
                    "stdout": "",
                    "stderr": msg,
                    "exit_code": -1,
                    "duration_ms": 0.0,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
            self._active_jobs.add(job_id)

        start_time = time.time()
        stdout_str = ""
        stderr_str = ""
        exit_code = -1
        status = "failed"

        try:
            cmd_str = job.get("command", "")
            if not cmd_str or not str(cmd_str).strip():
                raise ValueError("Job command is empty")

            proc = subprocess.run(
                cmd_str,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout
            )
            exit_code = proc.returncode
            stdout_str = proc.stdout or ""
            stderr_str = proc.stderr or ""
            status = "success" if exit_code == 0 else "failed"

        except subprocess.TimeoutExpired as te:
            exit_code = -1
            status = "failed"
            stdout_str = te.stdout or "" if isinstance(te.stdout, str) else ""
            stderr_str = f"Execution timed out after {timeout} seconds."
        except Exception as e:
            exit_code = -1
            status = "failed"
            stderr_str = f"Execution error: {str(e)}"

        finally:
            duration_ms = (time.time() - start_time) * 1000.0
            with self._lock:
                self._active_jobs.discard(job_id)

        result = {
            "status": status,
            "exit_code": exit_code,
            "stdout": stdout_str,
            "stderr": stderr_str,
            "duration_ms": duration_ms,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

        # Send email report if enabled
        try:
            send_email_report(job, result, smtp_config)
        except Exception as e:
            sys.stderr.write(f"CmdBar Cron: Error in send_email_report: {e}\n")

        return result


class CronScheduler:
    """
    Scheduler daemon process / thread that manages background scheduling ticks,
    evaluating scheduled jobs and dispatching execution.
    """
    def __init__(self, config_path=None, tick_interval: float = 1.0):
        self.config_path = config_path
        self.tick_interval = tick_interval
        self.runner = CronJobRunner()
        self._thread = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()

        # In-memory schedule state
        self._schedules = []
        self._execution_history = {}

    def set_schedules(self, schedules: list):
        with self._lock:
            self._schedules = list(schedules)

    def get_schedules(self) -> list:
        with self._lock:
            return json.loads(json.dumps(self._schedules))

    def get_execution_history(self) -> dict:
        with self._lock:
            return json.loads(json.dumps(self._execution_history))

    def add_or_update_schedule(self, schedule_dict: dict) -> dict:
        with self._lock:
            s_id = schedule_dict.get("id") or str(uuid.uuid4())
            schedule_dict["id"] = s_id

            # Ensure valid cron expression
            expr = schedule_dict.get("schedule", "0 0 * * *")
            if not is_valid_cron_expression(expr):
                raise ValueError(f"Invalid cron expression or macro: '{expr}'")

            # Default attributes
            schedule_dict.setdefault("name", "Untitled Schedule")
            schedule_dict.setdefault("command", "echo Hello")
            schedule_dict.setdefault("timezone", "Local")
            schedule_dict.setdefault("enabled", True)
            schedule_dict.setdefault("prevent_overlap", True)
            schedule_dict.setdefault("email_reports", {
                "enabled": False,
                "recipients": [],
                "trigger": "on_failure"
            })
            schedule_dict.setdefault("last_run", None)
            schedule_dict.setdefault("next_run", None)
            schedule_dict.setdefault("last_status", "never_run")
            schedule_dict.setdefault("last_output", "")
            schedule_dict.setdefault("last_error", "")

            # Calculate next run
            try:
                next_dt = get_next_run_time(expr, tz_str=schedule_dict["timezone"])
                schedule_dict["next_run"] = next_dt.isoformat()
            except Exception:
                pass

            existing_idx = None
            for idx, item in enumerate(self._schedules):
                if item.get("id") == s_id or item.get("name") == schedule_dict.get("name"):
                    existing_idx = idx
                    break

            if existing_idx is not None:
                self._schedules[existing_idx] = schedule_dict
            else:
                self._schedules.append(schedule_dict)

            return schedule_dict

    def delete_schedule(self, s_id_or_name: str) -> bool:
        with self._lock:
            init_len = len(self._schedules)
            self._schedules = [
                s for s in self._schedules
                if s.get("id") != s_id_or_name and s.get("name") != s_id_or_name
            ]
            return len(self._schedules) < init_len

    def run_job_now(self, s_id_or_name: str) -> dict:
        target = None
        with self._lock:
            for s in self._schedules:
                if s.get("id") == s_id_or_name or s.get("name") == s_id_or_name:
                    target = dict(s)
                    break

        if not target:
            return {
                "status": "failed",
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Schedule '{s_id_or_name}' not found.",
                "duration_ms": 0.0,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }

        res = self.runner.execute_job(target)

        # Update status in memory
        with self._lock:
            for s in self._schedules:
                if s.get("id") == target.get("id"):
                    s["last_run"] = res.get("timestamp")
                    s["last_status"] = res.get("status")
                    s["last_output"] = res.get("stdout")
                    s["last_error"] = res.get("stderr")
                    self._execution_history[s["id"]] = res
                    break

        return res

    def tick(self, now_dt: datetime = None):
        """
        Single scheduler tick. Checks all active schedules against now_dt.
        Triggers execution in background threads if matching.
        """
        with self._lock:
            current_schedules = [dict(s) for s in self._schedules if s.get("enabled", True)]

        for job in current_schedules:
            expr = job.get("schedule", "")
            tz_str = job.get("timezone", "Local")

            if not expr or not is_valid_cron_expression(expr):
                continue

            tz = get_timezone_object(tz_str)
            check_time = now_dt if now_dt is not None else datetime.now(tz)

            last_run_dt = None
            if job.get("last_run"):
                try:
                    last_run_dt = datetime.fromisoformat(job["last_run"])
                except Exception:
                    pass

            if should_job_run_now(expr, check_time, tz_str, last_run_dt):
                # Trigger job execution in worker thread
                def _worker(target_job=job):
                    res = self.runner.execute_job(target_job)
                    with self._lock:
                        for s in self._schedules:
                            if s.get("id") == target_job.get("id"):
                                s["last_run"] = res.get("timestamp")
                                s["last_status"] = res.get("status")
                                s["last_output"] = res.get("stdout")
                                s["last_error"] = res.get("stderr")
                                try:
                                    next_dt = get_next_run_time(s["schedule"], tz_str=s.get("timezone", "Local"))
                                    s["next_run"] = next_dt.isoformat()
                                except Exception:
                                    pass
                                self._execution_history[s["id"]] = res
                                break

                t = threading.Thread(target=_worker, daemon=True)
                t.start()

    def start(self):
        """Starts background daemon scheduler thread."""
        if self._thread is not None and self._thread.is_alive():
            return

        self._stop_event.clear()

        def _loop():
            while not self._stop_event.is_set():
                try:
                    self.tick()
                except Exception as e:
                    sys.stderr.write(f"CmdBar CronScheduler tick error: {e}\n")
                self._stop_event.wait(self.tick_interval)

        self._thread = threading.Thread(target=_loop, daemon=True)
        self._thread.start()

    def stop(self):
        """Stops background daemon scheduler thread cleanly."""
        self._stop_event.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=3.0)
        self._thread = None

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()
