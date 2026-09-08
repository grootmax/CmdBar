# Live Terminal Sharing User Guide

Welcome to CmdBar **Live Terminal Sharing**! Live Terminal Sharing enables developers and operators to share interactive terminal sessions in real time with end-to-end encryption, multi-user cursor tracking, and permission controls.

## Features

- **Real-Time Collaboration**: Share terminal output, inputs, and window resize events instantly across peers.
- **Role-Based Permissions**: Host control with `admin`, `read-write`, and `read-only` modes.
- **Control Requests**: Read-only participants can request write access from session admins at any time.
- **Cursor Tracking**: See where each participant is focused on screen with unique colored cursors.
- **End-to-End Encryption**: All session traffic is encrypted locally before being transmitted via WebRTC.
- **Session Recording & Replay**: Record full terminal sessions and export them to JSON or standard Asciinema format.

## Getting Started

1. Start a session from the CmdBar top bar indicator.
2. Share the generated session ID and passphrase with your collaborators.
3. Collaborators connect securely using WebRTC data channels.
