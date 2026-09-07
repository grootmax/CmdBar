"""
Sandbox Wrapper Module for CmdBar.
Provides command execution isolation using bwrap, flatpak-spawn, or firejail.
"""

AVAILABLE_ENGINES = ["bwrap", "flatpak-spawn", "firejail"]
SECURITY_PROFILES = ["strict", "permissive", "custom"]


def is_sandbox_enabled(cmd_obj):
    """
    Determines whether sandboxing is enabled for a given command object.
    :visibility: public
    """
    if not cmd_obj:
        return False
    if isinstance(cmd_obj, bool):
        return cmd_obj
    if isinstance(cmd_obj, dict):
        if cmd_obj.get("sandbox") is True or cmd_obj.get("sandbox_enabled") is True:
            return True
        sandbox_val = cmd_obj.get("sandbox")
        if isinstance(sandbox_val, dict):
            return sandbox_val.get("enabled") is not False
    return False


def get_sandbox_config(cmd_obj):
    """
    Normalizes and extracts sandbox configuration options from a command object.
    :visibility: public
    """
    if not is_sandbox_enabled(cmd_obj):
        return {"enabled": False}

    cfg = {
        "enabled": True,
        "engine": "bwrap",
        "profile": "strict",
        "filesystem": "read-only",
        "network": False,
    }

    if isinstance(cmd_obj, dict):
        sandbox = cmd_obj.get("sandbox")
        if isinstance(sandbox, dict):
            cfg["enabled"] = sandbox.get("enabled") is not False
            cfg["engine"] = sandbox.get("engine") or cmd_obj.get("sandbox_engine") or cfg["engine"]
            cfg["profile"] = sandbox.get("profile") or cmd_obj.get("sandbox_profile") or cfg["profile"]
            if "filesystem" in sandbox:
                cfg["filesystem"] = sandbox["filesystem"]
            elif "sandbox_filesystem" in cmd_obj:
                cfg["filesystem"] = cmd_obj["sandbox_filesystem"]
            if "network" in sandbox:
                cfg["network"] = sandbox["network"]
            elif "sandbox_network" in cmd_obj:
                cfg["network"] = cmd_obj["sandbox_network"]
        else:
            if "sandbox_engine" in cmd_obj:
                cfg["engine"] = cmd_obj["sandbox_engine"]
            if "sandbox_profile" in cmd_obj:
                cfg["profile"] = cmd_obj["sandbox_profile"]
            if "sandbox_filesystem" in cmd_obj:
                cfg["filesystem"] = cmd_obj["sandbox_filesystem"]
            if "sandbox_network" in cmd_obj:
                cfg["network"] = cmd_obj["sandbox_network"]

    if cfg["engine"] not in AVAILABLE_ENGINES:
        cfg["engine"] = "bwrap"

    return cfg


def wrap_command_in_sandbox(argv, sandbox_config_or_cmd):
    """
    Wraps an argument list in a sandbox invocation based on sandbox options.
    :visibility: public
    """
    if isinstance(argv, str):
        import shlex
        try:
            original_argv = shlex.split(argv)
        except Exception:
            original_argv = argv.split()
    elif isinstance(argv, list):
        original_argv = list(argv)
    else:
        original_argv = [str(argv)]

    if not original_argv:
        return []

    config = get_sandbox_config(sandbox_config_or_cmd)
    if not config.get("enabled"):
        return original_argv

    engine = config.get("engine", "bwrap")
    profile = config.get("profile", "strict")
    fs_mode = config.get("filesystem", "read-only")
    network = config.get("network", False)
    net_allowed = network is True or network in ("allow", "host")

    wrapper = []

    if engine == "bwrap":
        wrapper = ["bwrap"]
        if profile == "strict":
            wrapper.extend([
                "--ro-bind", "/usr", "/usr",
                "--ro-bind-try", "/lib", "/lib",
                "--ro-bind-try", "/lib64", "/lib64",
                "--ro-bind-try", "/bin", "/bin",
                "--ro-bind-try", "/sbin", "/sbin",
                "--proc", "/proc",
                "--dev", "/dev",
                "--tmpfs", "/tmp"
            ])
            if not net_allowed:
                wrapper.append("--unshare-net")
            wrapper.append("--unshare-all")
        elif profile == "permissive":
            wrapper.extend(["--bind", "/", "/"])
            if not net_allowed:
                wrapper.append("--unshare-net")
        else:
            wrapper.extend([
                "--ro-bind", "/usr", "/usr",
                "--ro-bind-try", "/lib", "/lib",
                "--ro-bind-try", "/lib64", "/lib64",
                "--ro-bind-try", "/bin", "/bin",
                "--ro-bind-try", "/sbin", "/sbin",
                "--proc", "/proc",
                "--dev", "/dev"
            ])
            if fs_mode in ("read-only", "strict"):
                wrapper.extend(["--ro-bind", "/", "/", "--tmpfs", "/tmp"])
            elif fs_mode in ("tmpfs", "isolated"):
                wrapper.extend(["--tmpfs", "/tmp", "--tmpfs", "/home"])
            elif fs_mode == "full":
                wrapper.extend(["--bind", "/", "/"])
            elif isinstance(fs_mode, list):
                for p in fs_mode:
                    wrapper.extend(["--bind", p, p])
            else:
                wrapper.extend(["--tmpfs", "/tmp"])

            if not net_allowed:
                wrapper.append("--unshare-net")

        wrapper.append("--")
        wrapper.extend(original_argv)

    elif engine == "flatpak-spawn":
        wrapper = ["flatpak-spawn", "--sandbox"]
        if not net_allowed:
            wrapper.append("--no-network")

        if profile == "strict" or fs_mode in ("read-only", "strict"):
            wrapper.append("--sandbox-expose-path-ro=/usr")
        elif fs_mode == "full" or profile == "permissive":
            wrapper.append("--sandbox-expose-path=/")
        elif isinstance(fs_mode, list):
            for p in fs_mode:
                wrapper.append(f"--sandbox-expose-path={p}")

        wrapper.append("--")
        wrapper.extend(original_argv)

    elif engine == "firejail":
        wrapper = ["firejail"]
        if not net_allowed:
            wrapper.append("--net=none")

        if profile == "strict":
            wrapper.extend(["--seccomp", "--nodbus", "--caps.drop=all"])
            if fs_mode in ("tmpfs", "isolated"):
                wrapper.extend(["--private", "--private-tmp"])
            else:
                wrapper.append("--read-only=/")
        elif profile == "permissive":
            wrapper.append("--noprofile")
        else:
            if fs_mode in ("read-only", "strict"):
                wrapper.append("--read-only=/")
            elif fs_mode in ("tmpfs", "isolated"):
                wrapper.extend(["--private", "--private-tmp"])

        wrapper.append("--")
        wrapper.extend(original_argv)

    return wrapper


build_sandbox_command = wrap_command_in_sandbox
