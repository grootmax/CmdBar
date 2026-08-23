from app.sandbox_wrapper import (
    is_sandbox_enabled,
    get_sandbox_config,
    wrap_command_in_sandbox,
    build_sandbox_command,
    AVAILABLE_ENGINES,
    SECURITY_PROFILES,
)
from app.config_schema import resolve_command_preview


def test_is_sandbox_enabled():
    assert is_sandbox_enabled(None) is False
    assert is_sandbox_enabled({}) is False
    assert is_sandbox_enabled({"sandbox": False}) is False
    assert is_sandbox_enabled({"sandbox": True}) is True
    assert is_sandbox_enabled({"sandbox_enabled": True}) is True
    assert is_sandbox_enabled({"sandbox": {"enabled": True}}) is True
    assert is_sandbox_enabled({"sandbox": {"enabled": False}}) is False


def test_get_sandbox_config():
    cfg = get_sandbox_config({"sandbox": True})
    assert cfg["enabled"] is True
    assert cfg["engine"] == "bwrap"
    assert cfg["profile"] == "strict"
    assert cfg["filesystem"] == "read-only"
    assert cfg["network"] is False

    custom_cfg = get_sandbox_config({
        "sandbox": {
            "enabled": True,
            "engine": "firejail",
            "profile": "custom",
            "filesystem": "tmpfs",
            "network": True,
        }
    })
    assert custom_cfg["engine"] == "firejail"
    assert custom_cfg["profile"] == "custom"
    assert custom_cfg["filesystem"] == "tmpfs"
    assert custom_cfg["network"] is True


def test_wrap_command_bwrap():
    argv = ["ping", "-c", "3", "8.8.8.8"]
    cmd_obj = {
        "sandbox": {
            "enabled": True,
            "engine": "bwrap",
            "profile": "strict",
            "network": False,
        }
    }
    wrapped = wrap_command_in_sandbox(argv, cmd_obj)
    assert wrapped[0] == "bwrap"
    assert "--unshare-net" in wrapped
    assert "--unshare-all" in wrapped
    assert wrapped[-4:] == ["ping", "-c", "3", "8.8.8.8"]


def test_wrap_command_flatpak_spawn():
    argv = ["python3", "app.py"]
    cmd_obj = {
        "sandbox": {
            "enabled": True,
            "engine": "flatpak-spawn",
            "profile": "strict",
            "network": False,
        }
    }
    wrapped = wrap_command_in_sandbox(argv, cmd_obj)
    assert wrapped[0] == "flatpak-spawn"
    assert "--sandbox" in wrapped
    assert "--no-network" in wrapped
    assert wrapped[-2:] == ["python3", "app.py"]


def test_wrap_command_firejail():
    argv = ["make", "build"]
    cmd_obj = {
        "sandbox": {
            "enabled": True,
            "engine": "firejail",
            "profile": "strict",
            "network": False,
        }
    }
    wrapped = wrap_command_in_sandbox(argv, cmd_obj)
    assert wrapped[0] == "firejail"
    assert "--net=none" in wrapped
    assert "--seccomp" in wrapped
    assert wrapped[-2:] == ["make", "build"]


def test_resolve_command_preview_sandboxed():
    cmd_template = "ping -c 3 <host>"
    mode = "shell-quoted"
    vals = {"host": "127.0.0.1"}
    schema = {"host": {"regex": r"^[0-9.]+$"}}
    sb_config = {"sandbox": {"enabled": True, "engine": "bwrap", "network": False}}

    resolved, errors = resolve_command_preview(cmd_template, mode, vals, schema, sandbox_config=sb_config)
    assert errors == {}
    assert "bwrap" in resolved
    assert "--unshare-net" in resolved
    assert "127.0.0.1" in resolved
