import os
import re
import pytest

# Emulates the JavaScript and GJS logic inside the GNOME extension

def gjs_shell_quote(s):
    """
    Emulates GJS/GLib.shell_quote(s) behavior in Python.
    GLib.shell_quote wraps strings in single quotes and replaces each ' with '\''
    """
    if not s:
        return "''"
    # GLib.shell_quote always quotes if there are shell-unsafe chars, or simply always wraps.
    # To be extremely secure and simple, wrapping in single quotes and replacing ' is the standard.
    return "'" + s.replace("'", "'\\''") + "'"


def validate_input_gjs(value, pattern=None):
    """
    Emulates the JavaScript RegExp validation used in extension.js.
    """
    if not pattern:
        pattern = "^[a-zA-Z0-9_\\-]+$"
    try:
        # In JS: new RegExp(pattern).test(value)
        # In Python, we do search to match JS test().
        # JS RegExp.test matches anywhere in the string unless anchored.
        regex = re.compile(pattern)
        return bool(regex.search(value))
    except re.error:
        return False


def substitute_template_gjs(template, values, placeholders):
    """
    Emulates the substitution loop inside extension.js.
    """
    final_cmd = template
    for ph in placeholders:
        escaped_val = gjs_shell_quote(values[ph])
        # Replace all occurrences of {ph}
        final_cmd = final_cmd.replace(f"{{{ph}}}", escaped_val)
    return final_cmd


def test_gjs_shell_quote():
    # Test spaces
    assert gjs_shell_quote("hello world") == "'hello world'"
    
    # Test special characters
    assert gjs_shell_quote("hello; rm -rf /") == "'hello; rm -rf /'"
    
    # Test quotes inside values
    assert gjs_shell_quote("don't panic") == "'don'\\''t panic'"


def test_gjs_validation_rules():
    # Test default alphanumeric pattern
    assert validate_input_gjs("validSub") is True
    assert validate_input_gjs("valid-sub_1") is True
    assert validate_input_gjs("invalid;sub") is False
    assert validate_input_gjs("invalid space") is False
    
    # Test custom patterns
    custom_pattern = "^[a-z]+$"
    assert validate_input_gjs("abc", custom_pattern) is True
    assert validate_input_gjs("abc1", custom_pattern) is False
    assert validate_input_gjs("ABC", custom_pattern) is False


def test_gjs_substitution():
    template = "git checkout {branch} && git pull origin {branch}"
    placeholders = ["branch"]
    values = {"branch": "feature/safe-quoting"}
    
    final_cmd = substitute_template_gjs(template, values, placeholders)
    # Both placeholders should be replaced and quoted
    assert "feature/safe-quoting" in final_cmd
    assert "'feature/safe-quoting'" in final_cmd
    
    # Verify exact substitution structure
    expected = "git checkout 'feature/safe-quoting' && git pull origin 'feature/safe-quoting'"
    assert final_cmd == expected


def test_gjs_subprocess_unpacking_behavior():
    """
    Emulates the 2-tuple returned by Gio.Subprocess.communicate_utf8_finish in GJS.
    It returns [stdout, stderr] without a 'success' boolean.
    """
    def mock_communicate_utf8_finish(result):
        # returns [stdout, stderr]
        return ["user-entered-parameter", ""]

    res = mock_communicate_utf8_finish(None)
    assert len(res) == 2
    
    # Legacy incorrect unpacking logic:
    # let [success, stdout, stderr] = res;
    success = res[0]  # "user-entered-parameter"
    stdout = res[1] if len(res) > 1 else ""  # ""
    
    # This caused stdout to be empty, which incorrectly failed parameter validation!
    assert stdout == ""
    
    # Corrected unpacking logic:
    # let [stdout, stderr] = res;
    stdout_corrected = res[0]
    stderr_corrected = res[1]
    
    assert stdout_corrected == "user-entered-parameter"
    assert stderr_corrected == ""


class SimulatedCmdBarIndicator:
    def __init__(self):
        self._init_job_tracking()
        self.menu_items = []

    def _init_job_tracking(self):
        self._next_job_id = 1
        self._active_jobs = {}
        self._job_menu_items = {}
        self._jobs_section = []
        self._jobs_section_separator = None
        self._jobs_section_header = None

    def execute_command(self, name, template, params=None):
        job_id = str(self._next_job_id)
        self._next_job_id += 1
        job_name = f"{name} ({template})"
        job = {"id": job_id, "name": job_name, "cancelled": False}
        self._active_jobs[job_id] = job

        if len(self._active_jobs) == 1:
            self._jobs_section_separator = "Separator"
            self._jobs_section_header = "Active Background Jobs"

        job_item = f"JobItem-{job_id}: {job_name}"
        self._jobs_section.append(job_item)
        self._job_menu_items[job_id] = job_item
        return job_id

    def reload_menu(self):
        self.menu_items = ["Category: Default", "Command: Echo"]
        self._restore_jobs_ui()

    def _restore_jobs_ui(self):
        self._jobs_section = []
        self._job_menu_items.clear()
        self._jobs_section_separator = None
        self._jobs_section_header = None

        if self._active_jobs:
            self._jobs_section_separator = "Separator"
            self._jobs_section_header = "Active Background Jobs"
            for job_id, job in self._active_jobs.items():
                job_item = f"JobItem-{job_id}: {job['name']}"
                self._jobs_section.append(job_item)
                self._job_menu_items[job_id] = job_item

    def on_job_finished(self, job_id):
        if job_id not in self._active_jobs:
            return
        if job_id in self._job_menu_items:
            item = self._job_menu_items[job_id]
            if item in self._jobs_section:
                self._jobs_section.remove(item)
            del self._job_menu_items[job_id]
        del self._active_jobs[job_id]

        if not self._active_jobs:
            self._jobs_section_separator = None
            self._jobs_section_header = None


def test_background_job_tracking_and_numeric_ids():
    indicator = SimulatedCmdBarIndicator()
    id1 = indicator.execute_command("Task 1", "sleep 10")
    id2 = indicator.execute_command("Task 2", "sleep 20")
    assert id1 == "1"
    assert id2 == "2"
    assert id1 != "NaN" and id2 != "NaN"
    assert len(indicator._active_jobs) == 2
    assert len(indicator._jobs_section) == 2


def test_menu_reload_job_persistence():
    indicator = SimulatedCmdBarIndicator()
    id1 = indicator.execute_command("Long Task", "ping localhost")
    assert len(indicator._active_jobs) == 1

    # Reload menu
    indicator.reload_menu()

    # Verify active background job remains visible
    assert len(indicator._active_jobs) == 1
    assert id1 in indicator._job_menu_items
    assert indicator._jobs_section_header == "Active Background Jobs"


def test_job_completion_cleanup():
    indicator = SimulatedCmdBarIndicator()
    id1 = indicator.execute_command("Task 1", "echo 1")
    id2 = indicator.execute_command("Task 2", "echo 2")

    indicator.on_job_finished(id1)
    assert id1 not in indicator._active_jobs
    assert id2 in indicator._active_jobs
    assert len(indicator._jobs_section) == 1

    indicator.on_job_finished(id2)
    assert len(indicator._active_jobs) == 0
    assert indicator._jobs_section_header is None


class SimulatedCommandMenuItem:
    def __init__(self, command_name, command_template, cmd_obj=None):
        self.command_name = command_name
        self.command_template = command_template
        self.cmd_obj = cmd_obj or {}
        self.output_label = {"text": "", "style_class": "", "visible": False}
        self.interval_ms = self._get_refresh_interval_ms()

    def _get_refresh_interval_ms(self):
        val = (
            self.cmd_obj.get("interval")
            or self.cmd_obj.get("refreshInterval")
            or self.cmd_obj.get("intervalMs")
            or self.cmd_obj.get("intervalSec")
            or self.cmd_obj.get("interval_sec")
            or self.cmd_obj.get("interval_ms")
        )
        if isinstance(val, (int, float)) and val > 0:
            return int(val * 1000 if val <= 100 else val)
        if isinstance(val, str) and val.isdigit():
            num = int(val)
            if num > 0:
                return num * 1000 if num <= 100 else num
        if self.cmd_obj.get("output") is True or self.cmd_obj.get("showOutput") is True:
            return 5000
        return 0

    def format_output_text(self, raw_output, is_success):
        lines = [line.strip() for line in (raw_output or "").splitlines() if line.strip()]
        if lines:
            summary = lines[-1]
        else:
            summary = "OK" if is_success else "Error"

        if len(summary) > 50:
            summary = summary[:47] + "..."
        return summary

    def set_status_running(self):
        self.output_label["text"] = "Running..."
        self.output_label["style_class"] = "cmdbar-output-running"
        self.output_label["visible"] = True

    def set_status_success(self, text):
        self.output_label["text"] = text
        self.output_label["style_class"] = "cmdbar-output-success"
        self.output_label["visible"] = True

    def set_status_error(self, text):
        self.output_label["text"] = text
        self.output_label["style_class"] = "cmdbar-output-error"
        self.output_label["visible"] = True

    def refresh_output(self, simulated_stdout="", simulated_stderr="", success=True):
        self.set_status_running()
        raw_output = simulated_stdout if success else (simulated_stderr or simulated_stdout)
        formatted = self.format_output_text(raw_output, success)
        if success:
            self.set_status_success(formatted)
        else:
            self.set_status_error(formatted)


def test_command_menu_item_interval_parsing():
    item1 = SimulatedCommandMenuItem("Test 1", "uptime", {"interval": 5})
    assert item1.interval_ms == 5000

    item2 = SimulatedCommandMenuItem("Test 2", "df -h", {"refreshInterval": 10000})
    assert item2.interval_ms == 10000

    item3 = SimulatedCommandMenuItem("Test 3", "whoami", {"output": True})
    assert item3.interval_ms == 5000

    item4 = SimulatedCommandMenuItem("Test 4", "date", {})
    assert item4.interval_ms == 0


def test_command_menu_item_output_formatting_and_truncation():
    item = SimulatedCommandMenuItem("Disk Usage", "df -h", {"output": True})

    # Multiline output - pick last non-empty line
    multiline = "Filesystem Size Used Avail Use%\n/dev/sda1 100G 20G 80G 20%\n"
    formatted = item.format_output_text(multiline, is_success=True)
    assert formatted == "/dev/sda1 100G 20G 80G 20%"

    # Long line truncation to 50 chars
    long_line = "A" * 60
    formatted_long = item.format_output_text(long_line, is_success=True)
    assert len(formatted_long) == 50
    assert formatted_long.endswith("...")
    assert formatted_long == ("A" * 47) + "..."

    # Empty output fallback
    assert item.format_output_text("", is_success=True) == "OK"
    assert item.format_output_text("", is_success=False) == "Error"


def test_command_menu_item_status_colors_and_refresh():
    item = SimulatedCommandMenuItem("Service Status", "systemctl status app", {"output": True})

    # Success state (green)
    item.refresh_output(simulated_stdout="active (running)", success=True)
    assert item.output_label["text"] == "active (running)"
    assert item.output_label["style_class"] == "cmdbar-output-success"

    # Error state (red)
    item.refresh_output(simulated_stderr="Job for app.service failed", success=False)
    assert item.output_label["text"] == "Job for app.service failed"
    assert item.output_label["style_class"] == "cmdbar-output-error"



