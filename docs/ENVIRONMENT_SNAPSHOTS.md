# Environment Snapshots

## Overview

CmdBar Environment Snapshots allow users to export, import, backup, restore, and share their entire CmdBar configuration, command execution history, custom stylesheets/themes, environment profiles, and favorites across machines or cloud instances.

## Key Features

- **Full Environment Serialization**: Bundles `config.json`, command history, and stylesheet/theme customization into a canonical, signed JSON format (`cmdbar-environment-snapshot/v1`).
- **Cryptographic Integrity & Encryption**: Every snapshot includes an HMAC-SHA256 signature to prevent tampering. Snapshots can optionally be encrypted using AES/PBKDF2 with a passphrase.
- **Flexible Import Modes**:
  - `merge`: Combines imported categories, commands, and history with current settings without overwriting existing unique entries.
  - `replace`: Overwrites local configuration and history with the snapshot's state.
- **Automated Backup & Safety**: Before any snapshot import or restoration, an automatic backup is created under `~/.config/cmdbar/backups/`.
- **D-Bus & CLI Support**: Export and import operations are exposed over D-Bus (`org.gnome.CmdBar`) and CLI (`cmdbar-companion --export-snapshot`, `--import-snapshot`).
- **Cloud & Link Sharing**: Snapshots can be encoded into shareable `cmdbar-snap://` payload URLs or synced to cloud endpoints.

## Snapshot JSON Format

```json
{
  "$schema": "cmdbar-environment-snapshot/v1",
  "version": 1,
  "snapshot_id": "snap_1724416500000_a1b2c3",
  "created_at": "2026-08-23T12:00:00Z",
  "description": "Production Machine Backup",
  "metadata": {
    "app_name": "CmdBar",
    "app_version": "1.0.0",
    "hostname": "workstation-1",
    "platform": "linux",
    "user": "developer"
  },
  "config": {
    "categories": [ ... ],
    "ai": { ... }
  },
  "history": {
    "clipboard": [ ... ]
  },
  "themes": {
    "mode": "dark",
    "custom_stylesheet": "/* Custom CSS */"
  },
  "signature": "3f9b...a10e"
}
```

## Usage

### JavaScript API (`extension/environmentSnapshot.js`)

```javascript
import { exportEnvironmentSnapshot, importEnvironmentSnapshot, createBackup, restoreFromBackup } from './extension/environmentSnapshot.js';

// Export snapshot
const snapshot = await exportEnvironmentSnapshot({
  description: 'My Snapshot',
  outputPath: '/path/to/snapshot.json'
});

// Import snapshot
await importEnvironmentSnapshot('/path/to/snapshot.json', { mode: 'merge' });

// Create & Restore Backup
const backup = await createBackup({ description: 'Pre-update backup' });
await restoreFromBackup(backup.backup_path);
```

### Python API (`companion/environment_snapshot.py`)

```python
from companion.environment_snapshot import export_snapshot, import_snapshot, create_backup, restore_backup

# Export snapshot
snapshot = export_snapshot(output_path='/path/to/snapshot.json')

# Import snapshot
import_snapshot('/path/to/snapshot.json', mode='merge')

# Create & Restore Backup
b_info = create_backup(description='Manual backup')
restore_backup(b_info['backup_path'])
```

### CLI Command Line Options

```bash
# Export snapshot to file
python3 -m companion.companion_app --export-snapshot /path/to/snapshot.json

# Import snapshot with merge mode
python3 -m companion.companion_app --import-snapshot /path/to/snapshot.json --merge

# Create an immediate backup
python3 -m companion.companion_app --backup

# List all available backups
python3 -m companion.companion_app --list-backups

# Restore from a backup ID or path
python3 -m companion.companion_app --restore backup_1724416500000_abc123
```

### D-Bus Interface (`org.gnome.CmdBar`)

Methods exposed on `/org/gnome/CmdBar`:
- `ExportSnapshot(s options_json) -> s snapshot_json`
- `ImportSnapshot(s snapshot_json, s options_json) -> b success`
- `CreateBackup(s description) -> s backup_file_path`
- `RestoreBackup(s backup_path_or_id) -> b success`
- `ListBackups() -> s json_backups_list`
