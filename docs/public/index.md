# CmdBar User Guide

Welcome to CmdBar! CmdBar is a modern GNOME Shell extension and companion app that puts your most-used commands right in your system status area.

## Getting Started

1. **Install the extension**: Run `make install` inside the repository.
2. **Restart GNOME Shell**: Press `Alt + F2`, type `r`, and press Enter (or log out and back in on Wayland).
3. **Configure your commands**: Edit `commands.json` or use our companion management app.
4. **Access your commands**: Click the indicator on your GNOME top-bar and choose a command!

## Core Features

- **Environment Variable Profiles**: Switch named environment variable profiles ("Production", "Staging", "Development") directly from the top bar indicator menu or the command execution confirmation dialog. Filter command visibility using profile arrays.
- **Dynamic Menu**: Fully driven by JSON config files.
- **Command Favorites & Pinning**: Star commands with inline star buttons or keyboard shortcuts (`f` / `*`) to pin them into a dedicated "Favorites" category at the top of the menu.
- **Snippet & Template Library**: Pre-built command templates for Git, Docker, Kubernetes, AWS CLI, npm/pnpm, and System utilities.
- **Import Wizard & Community Sharing**: "Import from Template" wizard in the companion app to browse library or import community JSON templates, plus "Export Template" to share custom commands.
- **Command History & Recents**: Tracks up to 50 executed commands with substituted parameters in `history.json` (with sensitive token/password redaction), providing a "Recent" category at top of menu with one-click re-run, "Clear History" action, and dedicated keyboard shortcut.
- **Command Result Caching**: Cache output of read-only commands (e.g., `git status`, `df -h`) with configurable TTL and manual refresh button in menu items.
- **Clipboard History**: Integrated command palette clipboard manager tracking up to 50 entries with search, pinning, clear history, and click-to-paste functionality.
- **Support for Arguments**: Interactive dialogs for commands requiring user parameters.
- **Command Audit Logging**: Log command executions to `~/.local/share/cmdbar/audit.log` with ISO timestamp, user, exit code, and execution duration. Includes Privacy Mode to automatically exclude sensitive commands and parameters, daily log rotation, and an in-app Audit Log Viewer.
- **YubiKey 2FA Authentication**: Hardware-backed touch to confirm, Yubico OTP, FIDO2/U2F assertion, and emergency access codes for sensitive commands.
- **Local Live Reload**: Configuration changes sync instantly.
- **Mobile Companion App**: iOS and Android companion integration featuring Push Notifications (APNs & FCM), Quick Actions, Home Screen & Lock Screen Widget support, Challenge-Response Biometric Auth, and Persistent Offline Queue.
- **Enterprise White Label & Custom Branding**: Rebrand the top panel indicator with custom enterprise logo, application name, primary brand colors, domain alias endpoints, and custom SSL certificate bundles.
- **Shared Audit Trail**: Enterprise team audit logging with HMAC SHA-256 tamper-evident verification, GDPR privacy controls, automated compliance reports (SOC2, ISO27001, GDPR, HIPAA, PCI-DSS), SIEM export (CEF, LEEF, Syslog, Splunk, Elastic), anomaly detection rules, and real-time security alerts.
