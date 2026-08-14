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
