#!/usr/bin/env python3
"""
Screenshot and Screen Capture service for CmdBar app module.

Provides quick screenshot capture (fullscreen, window, region), image annotations,
metadata removal, URL sharing, clipboard copying, and shortcut configuration.
"""

from companion.screenshot_service import (
    DEFAULT_SHORTCUTS,
    generate_screenshot_filename,
    strip_metadata,
    annotate_image,
    generate_share_url,
    ScreenshotService,
)

__all__ = [
    "DEFAULT_SHORTCUTS",
    "generate_screenshot_filename",
    "strip_metadata",
    "annotate_image",
    "generate_share_url",
    "ScreenshotService",
]
