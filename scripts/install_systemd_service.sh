#!/usr/bin/env bash
set -e

SERVICE_NAME="cmdbar-server.service"
USER_SYSTEMD_DIR="${HOME}/.config/systemd/user"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "${SCRIPT_DIR}")"
SERVICE_SRC="${REPO_DIR}/systemd/${SERVICE_NAME}"

echo "Installing CmdBar Headless Server systemd user service..."

mkdir -p "${USER_SYSTEMD_DIR}"
cp "${SERVICE_SRC}" "${USER_SYSTEMD_DIR}/${SERVICE_NAME}"

echo "Reloading systemd user daemon..."
if command -v systemctl &>/dev/null; then
    systemctl --user daemon-reload
    echo "CmdBar server systemd service installed successfully!"
    echo "To enable and start the service:"
    echo "  systemctl --user enable --now ${SERVICE_NAME}"
    echo "To check service status:"
    echo "  systemctl --user status ${SERVICE_NAME}"
else
    echo "Service file copied to ${USER_SYSTEMD_DIR}/${SERVICE_NAME}."
    echo "systemctl is not available in current environment."
fi
