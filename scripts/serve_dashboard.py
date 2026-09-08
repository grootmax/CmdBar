#!/usr/bin/env python3
"""
Launcher script for CmdBar Web Dashboard.
"""

import os
import sys
import argparse

# Ensure repository root is in sys.path
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from companion.dashboard_server import run_dashboard_server, DEFAULT_PORT

def main():
    parser = argparse.ArgumentParser(description="CmdBar Web Dashboard Server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port to run web dashboard on (default: 8080)")
    args = parser.parse_args()

    print("\n=============================================")
    print(f" CmdBar Web Dashboard Server Starting...")
    print(f" URL: http://localhost:{args.port}")
    print("=============================================\n")

    try:
        run_dashboard_server(port=args.port)
    except KeyboardInterrupt:
        print("\nStopping CmdBar Web Dashboard Server...")
        sys.exit(0)

if __name__ == "__main__":
    main()
