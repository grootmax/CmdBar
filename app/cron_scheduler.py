"""
CmdBar Cron Scheduler Module
Handles cron expression parsing, timezone-aware schedule matching,
overlap prevention, error handling, email reporting, and job execution history.
"""

import os
import re
import sys
import time
import json
import shlex
import smtplib
import subprocess
from datetime import datetime, timezone, timedelta
from email.message import EmailMessage

try:
    from zoneinfo import ZoneInfo
except ImportError:
    try:
        from backports.zoneinfo import ZoneInfo
    except ImportError:
        ZoneInfo = None

MONTH_NAMES = {"JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6, "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12}
DAY_NAMES = {"SUN": 0, "MON": 1, "TUE": 2, "WED": 3, "THU": 4, "FRI": 5, "SAT": 6}


def expand_shorthand(expression: str) -> str:
    """
    Expands cron shorthands like @daily or @hourly into standard 5-part cron expressions.
    :visibility: public
    """
    expr = str(expression).strip()
    shorthands = {
        "@yearly": "0 0 1 1 *",
        "@annually": "0 0 1 1 *",
        "@monthly": "0 0 1 * *",
        "@weekly": "0 0 * * 0",
        "@daily": "0 0 * * *",
        "@midnight": "0 0 * * *",
        "@hourly": "0 * * * *",
        "@minutely": "* * * * *"
    }
    return shorthands.get(expr.lower(), expr)


def parse_cron_field(field_str: str, min_val: int, max_val: int, name_map: dict = None) -> set:
    """
    Parses a single cron field (e.g. '*', '*/5', '1-5', '1,10,20', 'MON-FRI') into a set of matching integers.
    :visibility: public
    """
    field_str = field_str.strip().upper()
    if name_map:
        for name, num in name_map.items():
            field_str = re.sub(r'\b' + name + r'\b', str(num), field_str)

    results = set()
    parts = field_str.split(',')
    for part in parts:
        part = part.strip()
        if not part:
            continue

        step = 1
        if '/' in part:
            range_part, step_part = part.split('/', 1)
            try:
                step = int(step_part)
                if step <= 0:
                    raise ValueError("Step must be positive")
            except ValueError:
                raise ValueError(f"Invalid step value in '{part}'")
        else:
            range_part = part

        if range_part == '*':
            start_val, end_val = min_val, max_val
        elif '-' in range_part:
            if range_part.count('-') > 1:
                raise ValueError(f"Invalid range syntax in '{part}'")
            start_str, end_str = range_part.split('-', 1)
            try:
                start_val = int(start_str)
                end_val = int(end_str)
            except ValueError:
                raise ValueError(f"Invalid range in '{part}'")
        else:
            try:
                val = int(range_part)
                start_val = end_val = val
            except ValueError:
                raise ValueError(f"Invalid integer value in '{part}'")

        if start_val < min_val or end_val > max_val or start_val > end_val:
            raise ValueError(f"Value range {start_val}-{end_val} out of bounds ({min_val}-{max_val})")

        for v in range(start_val, end_val + 1, step):
            results.add(v)

    return results


def parse_cron_expression(expression: str) -> dict:
    """
    Parses a full cron expression string into sets of allowed integers for each time field.
    Returns dict with keys: minute, hour, dom, month, dow.
    :visibility: public
    """
    expr = expand_shorthand(expression)
    fields = expr.split()
    if len(fields) != 5:
        raise ValueError(f"Invalid cron expression '{expression}'. Expected 5 fields, got {len(fields)}.")

    minute_set = parse_cron_field(fields[0], 0, 59)
    hour_set = parse_cron_field(fields[1], 0, 23)
    dom_set = parse_cron_field(fields[2], 1, 31)
    month_set = parse_cron_field(fields[3], 1, 12, MONTH_NAMES)
    dow_set = parse_cron_field(fields[4], 0, 7, DAY_NAMES)

    if 7 in dow_set:
        dow_set.add(0)

    return {
        "minute": minute_set,
        "hour": hour_set,
        "dom": dom_set,
        "month": month_set,
        "dow": dow_set,
        "raw": expression
    }


def get_timezone_object(tz_str: str = None):
    """
    Resolves a timezone string into a tzinfo object.
    Supports 'UTC', 'Local', standard IANA names (e.g. 'America/New_York'), or defaults to UTC/system.
    :visibility: public
    """
    if not tz_str or tz_str.upper() in ("LOCAL", "SYSTEM"):
        return datetime.now().astimezone().tzinfo
    if tz_str.upper() == "UTC":
        return timezone.utc
    if ZoneInfo is not None:
        try:
            return ZoneInfo(tz_str)
        except Exception:
            pass
    return timezone.utc


def is_cron_due(expression: str, dt: datetime = None, tz_str: str = None) -> bool:
    """
    Checks if the given datetime (or current time if None) matches the cron expression in the specified timezone.
    :visibility: public
    """
    if dt is None:
        dt = datetime.now(timezone.utc)

    tz = get_timezone_object(tz_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    local_dt = dt.astimezone(tz)

    try:
        parsed = parse_cron_expression(expression)
    except ValueError:
        return False

    # Python weekday(): 0=Monday, 6=Sunday. Standard cron dow: 0=Sunday, 1=Monday, ..., 6=Saturday.
    cron_dow = (local_dt.weekday() + 1) % 7

    if local_dt.minute not in parsed["minute"]:
        return False
    if local_dt.hour not in parsed["hour"]:
        return False
    if local_dt.day not in parsed["dom"]:
        return False
    if local_dt.month not in parsed["month"]:
        return False
    if cron_dow not in parsed["dow"]:
        return False

    return True


def get_next_runs(expression: str, start_dt: datetime = None, tz_str: str = None, count: int = 3) -> list:
    """
    Calculates the next projected execution datetimes for a cron expression.
    :visibility: public
    """
    if start_dt is None:
        start_dt = datetime.now(timezone.utc)

    tz = get_timezone_object(tz_str)
    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=timezone.utc)

    current = start_dt.astimezone(tz).replace(second=0, microsecond=0) + timedelta(minutes=1)
    next_runs = []
    max_minutes_search = 525600  # Up to 1 year

    for _ in range(max_minutes_search):
        if is_cron_due(expression, current, tz_str):
            next_runs.append(current)
            if len(next_runs) >= count:
                break
        current += timedelta(minutes=1)

    return next_runs


def format_email_report(job_name: str, command: str, status: str, exit_code: int, stdout: str, stderr: str, duration_sec: float, timestamp: str = None) -> tuple:
    """
    Formats the subject and body for a cron job execution email report.
    Returns (subject, body).
    :visibility: public
    """
    if timestamp is None:
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    status_str = status.upper()
    subject = f"[CmdBar Cron] {status_str}: {job_name}"

    body = (
        f"CmdBar Cron Job Execution Report\n"
        f"=================================\n\n"
        f"Job Name:     {job_name}\n"
        f"Status:       {status_str}\n"
        f"Exit Code:    {exit_code}\n"
        f"Duration:     {duration_sec:.2f} seconds\n"
        f"Timestamp:    {timestamp}\n"
        f"Command:      {command}\n\n"
        f"--- Standard Output ---\n"
        f"{stdout if stdout else '(None)'}\n\n"
        f"--- Standard Error ---\n"
        f"{stderr if stderr else '(None)'}\n"
    )
    return subject, body


def send_email_report(job_name: str, command: str, status: str, exit_code: int, stdout: str, stderr: str, duration_sec: float, recipient: str, smtp_config: dict = None) -> bool:
    """
    Sends an email execution report for a cron job.
    Catches exceptions and returns True if successful, False otherwise.
    :visibility: public
    """
    if not recipient or not recipient.strip():
        return False

    subject, body = format_email_report(job_name, command, status, exit_code, stdout, stderr, duration_sec)

    msg = EmailMessage()
    msg['Subject'] = subject
    msg['To'] = recipient.strip()

    smtp_cfg = smtp_config or {}
    from_addr = smtp_cfg.get("from_addr") or "cmdbar-cron@localhost"
    msg['From'] = from_addr
    msg.set_content(body)

    smtp_host = smtp_cfg.get("smtp_host", "localhost")
    smtp_port = int(smtp_cfg.get("smtp_port", 25))
    smtp_user = smtp_cfg.get("smtp_user")
    smtp_password = smtp_cfg.get("smtp_password")

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
            if smtp_cfg.get("use_tls", False):
                server.starttls()
            if smtp_user and smtp_password:
                server.login(smtp_user, smtp_password)
            server.send_message(msg)
        return True
    except Exception as e:
        print(f"CmdBar Cron: Failed to send email report to {recipient}: {e}", file=sys.stderr)
        return False


class CronJob:
    """
    Represents a scheduled cron command configuration and execution state.
    :visibility: public
    """
    def __init__(self, job_id: str, name: str, command: str, cron_expression: str,
                 timezone: str = "UTC", overlap_prevention: bool = True,
                 email_reports: dict = None, enabled: bool = True,
                 last_run: str = None, last_status: str = "never",
                 last_output: dict = None, history: list = None):
        self.job_id = str(job_id)
        self.name = str(name)
        self.command = str(command)
        self.cron_expression = str(cron_expression)
        self.timezone = str(timezone) if timezone else "UTC"
        self.overlap_prevention = bool(overlap_prevention)
        self.email_reports = email_reports or {
            "enabled": False,
            "recipient": "",
            "on_success": False,
            "on_failure": True
        }
        self.enabled = bool(enabled)
        self.is_running = False
        self.last_run = last_run
        self.last_status = last_status
        self.last_output = last_output or {}
        self.history = history or []

    def to_dict(self) -> dict:
        return {
            "id": self.job_id,
            "name": self.name,
            "command": self.command,
            "cron_expression": self.cron_expression,
            "timezone": self.timezone,
            "overlap_prevention": self.overlap_prevention,
            "email_reports": self.email_reports,
            "enabled": self.enabled,
            "last_run": self.last_run,
            "last_status": self.last_status,
            "last_output": self.last_output,
            "history": self.history[-50:]
        }

    @classmethod
    def from_dict(cls, data: dict):
        return cls(
            job_id=data.get("id") or data.get("job_id") or f"job-{int(time.time()*1000)}",
            name=data.get("name", "Unnamed Job"),
            command=data.get("command", ""),
            cron_expression=data.get("cron_expression") or data.get("schedule", "* * * * *"),
            timezone=data.get("timezone", "UTC"),
            overlap_prevention=data.get("overlap_prevention", True),
            email_reports=data.get("email_reports"),
            enabled=data.get("enabled", True),
            last_run=data.get("last_run"),
            last_status=data.get("last_status", "never"),
            last_output=data.get("last_output"),
            history=data.get("history")
        )


class CronScheduler:
    """
    Manages loading, execution, overlap prevention, and status tracking for scheduled cron jobs.
    :visibility: public
    """
    def __init__(self, smtp_config: dict = None):
        self.jobs = {}
        self.smtp_config = smtp_config or {}

    def add_job(self, job: CronJob):
        self.jobs[job.job_id] = job

    def remove_job(self, job_id: str) -> bool:
        if job_id in self.jobs:
            del self.jobs[job_id]
            return True
        return False

    def get_job(self, job_id: str) -> CronJob:
        return self.jobs.get(job_id)

    def get_jobs(self) -> list:
        return list(self.jobs.values())

    def load_from_config(self, config_data: dict):
        self.jobs = {}
        cron_list = config_data.get("cron_jobs", [])
        for item in cron_list:
            if isinstance(item, dict):
                job = CronJob.from_dict(item)
                self.jobs[job.job_id] = job

        for cat in config_data.get("categories", []):
            for cmd in cat.get("commands", []):
                if isinstance(cmd, dict) and ("schedule" in cmd or "cron_expression" in cmd):
                    job_id = f"cmd-{cmd.get('name', 'job')}"
                    job_data = {
                        "id": job_id,
                        "name": cmd.get("name", "Scheduled Command"),
                        "command": cmd.get("template") or cmd.get("command", ""),
                        "cron_expression": cmd.get("schedule") or cmd.get("cron_expression"),
                        "timezone": cmd.get("timezone", "UTC"),
                        "overlap_prevention": cmd.get("overlap_prevention", True),
                        "email_reports": cmd.get("email_reports"),
                        "enabled": cmd.get("enabled", True)
                    }
                    if job_id not in self.jobs:
                        self.jobs[job_id] = CronJob.from_dict(job_data)

    def save_to_config(self, config_data: dict) -> dict:
        config_data["cron_jobs"] = [job.to_dict() for job in self.jobs.values()]
        return config_data

    def run_job(self, job: CronJob, force: bool = False) -> dict:
        """
        Executes a single cron job, managing overlap prevention, history logging, and email reporting.
        :visibility: public
        """
        now_utc = datetime.now(timezone.utc)
        timestamp_str = now_utc.strftime("%Y-%m-%d %H:%M:%S UTC")

        if job.overlap_prevention and job.is_running and not force:
            result = {
                "job_id": job.job_id,
                "name": job.name,
                "status": "skipped_overlap",
                "exit_code": -1,
                "stdout": "",
                "stderr": "Execution skipped: Previous instance is still running (overlap prevention).",
                "duration_sec": 0.0,
                "timestamp": timestamp_str
            }
            job.last_run = timestamp_str
            job.last_status = "skipped_overlap"
            job.last_output = result
            job.history.append(result)
            return result

        job.is_running = True
        start_time = time.time()

        code = -1
        stdout = ""
        stderr = ""
        status = "error"

        try:
            res = subprocess.run(
                job.command,
                shell=True,
                text=True,
                capture_output=True,
                timeout=3600
            )
            code = res.returncode
            stdout = res.stdout
            stderr = res.stderr
            status = "success" if code == 0 else "failed"
        except subprocess.TimeoutExpired:
            code = 124
            stderr = "Error: Job execution timed out after 3600 seconds."
            status = "failed"
        except Exception as e:
            code = -1
            stderr = f"Execution exception: {str(e)}"
            status = "error"
        finally:
            job.is_running = False

        duration = time.time() - start_time

        result = {
            "job_id": job.job_id,
            "name": job.name,
            "status": status,
            "exit_code": code,
            "stdout": stdout,
            "stderr": stderr,
            "duration_sec": duration,
            "timestamp": timestamp_str
        }

        job.last_run = timestamp_str
        job.last_status = status
        job.last_output = result
        job.history.append(result)

        email_cfg = job.email_reports or {}
        if email_cfg.get("enabled"):
            recipient = email_cfg.get("recipient")
            on_success = email_cfg.get("on_success", False)
            on_failure = email_cfg.get("on_failure", True)

            should_send = (status == "success" and on_success) or (status in ("failed", "error") and on_failure)
            if should_send and recipient:
                send_email_report(
                    job_name=job.name,
                    command=job.command,
                    status=status,
                    exit_code=code,
                    stdout=stdout,
                    stderr=stderr,
                    duration_sec=duration,
                    recipient=recipient,
                    smtp_config=self.smtp_config
                )

        return result

    def check_and_run_due_jobs(self, now_dt: datetime = None) -> list:
        """
        Evaluates all registered jobs against current time and executes those that are due.
        :visibility: public
        """
        if now_dt is None:
            now_dt = datetime.now(timezone.utc)

        results = []
        for job in list(self.jobs.values()):
            if not job.enabled:
                continue
            if is_cron_due(job.cron_expression, dt=now_dt, tz_str=job.timezone):
                res = self.run_job(job)
                results.append(res)
        return results
