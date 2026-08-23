# CmdBar User Guide

Welcome to CmdBar! CmdBar is a modern GNOME Shell extension and companion app that puts your most-used commands right in your system status area.

## Getting Started

1. **Install the extension**: Run `make install` inside the repository.
2. **Restart GNOME Shell**: Press `Alt + F2`, type `r`, and press Enter (or log out and back in on Wayland).
3. **Configure your commands**: Edit `commands.json` or use our companion management app.
4. **Access your commands**: Click the indicator on your GNOME top-bar and choose a command!

## Core Features

- **Dynamic Menu**: Fully driven by JSON config files.
- **Snippet & Template Library**: Pre-built command templates for Git, Docker, Kubernetes, AWS CLI, npm/pnpm, and System utilities.
- **Import Wizard & Community Sharing**: "Import from Template" wizard in the companion app to browse library or import community JSON templates, plus "Export Template" to share custom commands.
- **Clipboard History**: Integrated command palette clipboard manager tracking up to 50 entries with search, pinning, clear history, and click-to-paste functionality.
- **Support for Arguments**: Interactive dialogs for commands requiring user parameters.
- **Command Security Policy**: Enterprise-grade Whitelist/Blacklist command filtering with wildcard, glob, and regex pattern matching.
- **User & Group Scoped Rules**: Restrict command permissions per user or group role.
- **Approval & Override Workflows**: Request and grant temporary command execution overrides.
- **Local Live Reload**: Configuration changes sync instantly.

## Command Security Policy (Whitelist & Blacklist)

CmdBar features a built-in security policy engine to protect enterprise environments from accidental or malicious execution of dangerous system commands.

### Policy Modes

- **Blacklist Mode** (`mode: "blacklist"`): Blocks dangerous commands matching specified blacklisted patterns while allowing standard commands.
- **Whitelist Mode** (`mode: "whitelist"`): Restricts execution to explicitly permitted command patterns only.
- **Combined Mode** (`mode: "combined"`): Enforces blacklist restrictions first, followed by whitelist validation.

### Pattern Matching Syntax

- **Wildcards & Globs**: Use `*` to match any sequence of characters and `?` to match a single character (e.g. `rm -rf *`, `shutdown*`, `ping -c ? 127.0.0.1`).
- **Regular Expressions**: Prefix pattern with `regex:` (e.g. `regex:^rm\s+-rf`).

### User and Group Scoped Rules

Rules can be configured per user or group role in `config.json`:

```json
"policy": {
  "enabled": true,
  "mode": "blacklist",
  "rules": [
    {
      "id": "contractor-aws-deny",
      "user": "alice",
      "action": "deny",
      "pattern": "aws *",
      "reason": "Contractors cannot invoke AWS infrastructure commands"
    }
  ]
}
```

### Approval & Override Workflow

When a command is blocked by security policy, users can submit an approval request. Authorized administrators can issue single-use or time-bound approval tokens to override restrictions.

