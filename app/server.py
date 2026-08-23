#!/usr/bin/env python3
"""
CmdBar Server wrapper module for app package.
Provides entry points for app.server.

:visibility: public
"""

from companion.server import (
    CmdBarServer,
    CmdBarHTTPRequestHandler,
    WebSocketFrame,
    install_systemd_service,
    uninstall_systemd_service,
    status_systemd_service,
    get_systemd_unit_content,
    main
)

if __name__ == "__main__":
    main()
