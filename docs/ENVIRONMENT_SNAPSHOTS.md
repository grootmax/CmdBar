# CmdBar Environment Snapshots

## Overview
CmdBar Environment Snapshots allow enterprise teams and power users to export, import, share, replicate, and backup/restore complete environment states across machines.

An Environment Snapshot encapsulates:
1. **Configuration**: AI settings, categories, command templates, environment profiles, binary allowlists, and shortcuts.
2. **History**: Execution/command usage frequencies and clipboard history.
3. **Themes**: Active theme selection, styling parameters, and custom CSS overrides.
4. **Metadata & Security**: Timestamp, host information, description, schema versioning, and HMAC-SHA256 cryptographic signatures for integrity verification.

---

## Features

### 1. Snapshot Schema & Integrity
Environment Snapshots adhere to a strictly validated JSON structure (`type: "cmdbar_environment_snapshot"`, `version: "1.0"`).
Each exported snapshot includes a cryptographic HMAC-SHA256 signature calculated over the canonical JSON representation of its contents to prevent tampering during transfer or cloud storage.

### 2. Flexible Import Modes
- **Overwrite Mode (`overwrite`)**: Completely replaces local config, history, and theme settings with the snapshot state.
- **Merge Mode (`merge`)**: Intelligently combines snapshot categories, commands, history entries, and env profiles with existing local data while avoiding duplicate entries.

### 3. Automated Backup & Recovery
Before applying any snapshot import, CmdBar automatically creates a timestamped local backup snapshot (`env-snapshot-backup-YYYYMMDD-HHMMSS.json`).
Users can manually trigger backups or restore from existing backup files at any time.

### 4. Cloud Sharing & Replication
Environment Snapshots can be published to or downloaded from cloud endpoints for fast workstation replication or team collaboration:
- Share snapshot payload to remote endpoint, producing a share ID / share URL.
- Fetch and replicate snapshot across new machines with automatic import.

---

## Usage Guide

### JavaScript / Extension API
```javascript
import {
  createSnapshot,
  exportSnapshotToFile,
  importSnapshotFromFile,
  createBackup,
  restoreBackup,
  shareSnapshotToCloud,
  fetchSnapshotFromCloud,
} from './extension/environmentSnapshot.js';

// Export current environment to file
await exportSnapshotToFile('/path/to/my-snapshot.json', { description: 'Dev Workstation' });

// Import snapshot in merge mode
await importSnapshotFromFile('/path/to/team-snapshot.json', { mode: 'merge' });

// Create automated local backup
const backupPath = await createBackup();

// Restore from backup
await restoreBackup(backupPath);
```

### Python Companion CLI
```bash
# Export environment snapshot
python3 -m companion.companion_app --export-snapshot ~/my-snapshot.json

# Import snapshot in merge mode
python3 -m companion.companion_app --import-snapshot ~/team-snapshot.json --snapshot-mode merge

# Create backup
python3 -m companion.companion_app --create-backup

# Restore backup
python3 -m companion.companion_app --restore-backup ~/.config/cmdbar/backups/env-snapshot-backup-...json

# Share snapshot to cloud
python3 -m companion.companion_app --cloud-share

# Fetch & replicate snapshot from cloud
python3 -m companion.companion_app --cloud-fetch snap_123456
```

### D-Bus API Methods
CmdBar exposes D-Bus methods on `org.gnome.CmdBar` at `/org/gnome/CmdBar`:

```xml
<method name="ExportEnvironmentSnapshot">
  <arg name="file_path" type="s" direction="in"/>
  <arg name="description" type="s" direction="in"/>
  <arg name="success" type="b" direction="out"/>
</method>

<method name="ImportEnvironmentSnapshot">
  <arg name="file_path" type="s" direction="in"/>
  <arg name="merge" type="b" direction="in"/>
  <arg name="success" type="b" direction="out"/>
</method>
```

Example calling via `gdbus`:
```bash
gdbus call --session \
  --dest org.gnome.CmdBar \
  --object-path /org/gnome/CmdBar \
  --method org.gnome.CmdBar.ExportEnvironmentSnapshot "/tmp/env.json" "Workstation Snapshot"

gdbus call --session \
  --dest org.gnome.CmdBar \
  --object-path /org/gnome/CmdBar \
  --method org.gnome.CmdBar.ImportEnvironmentSnapshot "/tmp/env.json" true
```
