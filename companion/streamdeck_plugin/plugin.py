#!/usr/bin/env python3
"""
CmdBar Elgato Stream Deck Plugin Entrypoint.
"""

import sys
import json
import argparse
import asyncio
from companion.stream_deck import get_stream_deck_manager, StreamDeckPluginProtocol


async def run_plugin(port: int, plugin_uuid: str, register_event: str, info_json: str):
    manager = get_stream_deck_manager()
    print(f"CmdBar Stream Deck Plugin initialized. UUID: {plugin_uuid}, Port: {port}")


def main():
    parser = argparse.ArgumentParser(description="CmdBar Stream Deck Plugin Executable")
    parser.add_argument("-port", type=int, help="WebSocket connection port")
    parser.add_argument("-pluginUUID", type=str, help="Stream Deck plugin UUID")
    parser.add_argument("-registerEvent", type=str, help="Register event name")
    parser.add_argument("-info", type=str, help="Stream Deck application info JSON")
    
    args = parser.parse_args()
    
    if args.port and args.pluginUUID:
        asyncio.run(run_plugin(args.port, args.pluginUUID, args.registerEvent or "", args.info or ""))
    else:
        print("CmdBar Stream Deck Plugin expects -port and -pluginUUID parameters from Stream Deck application.")


if __name__ == "__main__":
    main()
