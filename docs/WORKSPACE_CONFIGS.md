# Workspace-Specific Configurations Specification

## Overview

CmdBar supports workspace-specific configuration files (`.cmdbar.json` or `.cmdbar/config.json`) placed within project directories. This enables project-tailored shortcuts, environment-specific command overrides, and seamless context switching.

## Features

1. **Auto-Detection from CWD**:
   When launched or when switching working directories, CmdBar traverses upwards from the current working directory (`cwd`) to locate workspace configuration files (`.cmdbar.json` or `.cmdbar/config.json`).

2. **Git Repository Integration**:
   Detects `.git` repository boundaries and stops traversal at the project root or filesystem root.

3. **Project Templates**:
   Provides built-in project templates to instantly initialize project configs:
   - `node`: NPM install, test, start, build, lint
   - `python`: Pytest, python main.py, pip install, ruff
   - `rust`: Cargo build, test, run, check
   - `go`: Go build, test, run
   - `docker`: Docker compose up, down, logs, build
   - `generic`: Custom project make & build commands

4. **Configuration Merging & Smooth Switching**:
   Workspace commands and categories take priority and extend global configuration. Context switching dynamically updates effective configuration.

5. **CLI & DBus Integration**:
   - `cmdbar-companion --init-workspace <dir> --template <template_name>`
   - `cmdbar-companion --cwd <dir> --show-effective`
   - DBus API methods: `GetEffectiveConfig(cwd)`, `SwitchWorkspace(cwd)`, `InitWorkspace(dir, template)`
