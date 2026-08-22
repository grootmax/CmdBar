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


