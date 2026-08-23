#!/usr/bin/env python3
"""
Unit and integration tests for Python ScreenshotService and D-Bus integration.
"""

import os
import json
import tempfile
import pytest
from companion.screenshot_service import (
    DEFAULT_SHORTCUTS,
    generate_screenshot_filename,
    strip_metadata,
    annotate_image,
    generate_share_url,
    ScreenshotService,
)
from companion.dbus_service import CmdBarDBusService


def test_generate_screenshot_filename():
    filename_png = generate_screenshot_filename(prefix="test_cap", extension="png")
    assert filename_png.startswith("test_cap_")
    assert filename_png.endswith(".png")

    filename_jpg = generate_screenshot_filename(extension="jpeg")
    assert filename_jpg.endswith(".jpg") or filename_jpg.endswith(".jpeg")


def test_strip_metadata_png():
    # PNG signature + IHDR + tEXt metadata + IEND
    raw_png = (
        b'\x89PNG\r\n\x1a\n'
        b'\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89'
        b'\x00\x00\x00\x0ftEXtSoftware\x00CmdBar\x00\x00\x00\x00'
        b'\x00\x00\x00\x00IEND\xaeB`\x82'
    )
    stripped, modified = strip_metadata(raw_png)
    assert modified is True
    assert len(stripped) < len(raw_png)
    assert b'tEXt' not in stripped
    assert b'Software' not in stripped


def test_strip_metadata_jpeg():
    raw_jpeg = (
        b'\xff\xd8'
        b'\xff\xe1\x00\x08Exif\x00\x00'
        b'\xff\xd9'
    )
    stripped, modified = strip_metadata(raw_jpeg)
    assert modified is True
    assert len(stripped) < len(raw_jpeg)


def test_strip_metadata_empty_or_plain():
    raw = b"12345"
    stripped, modified = strip_metadata(raw)
    assert modified is False
    assert stripped == raw


def test_annotate_image():
    raw_bytes = b"sample_image_buffer"
    annotations = [
        {"type": "text", "text": "Label 1", "x": 10, "y": 20, "color": "#ff0000", "font_size": 18},
        {"type": "rectangle", "x": 10, "y": 10, "width": 100, "height": 50, "color": "#00ff00"},
        {"type": "arrow", "x1": 0, "y1": 0, "x2": 50, "y2": 50, "color": "#0000ff"},
        {"type": "highlight", "x": 20, "y": 20, "width": 80, "height": 30, "color": "#ffff00", "opacity": 0.5}
    ]

    bytes_out, count, processed_list = annotate_image(raw_bytes, annotations)
    assert count == 4
    assert len(processed_list) == 4
    assert processed_list[0]["text"] == "Label 1"
    assert processed_list[1]["type"] == "rectangle"
    assert processed_list[2]["type"] == "arrow"
    assert processed_list[3]["type"] == "highlight"


def test_generate_share_url():
    raw_bytes = b"sample_data"
    res = generate_share_url(raw_bytes, service_url="https://share.test.org/api")
    assert res["success"] is True
    assert res["share_url"].startswith("https://share.test.org/api/scr_")
    assert res["share_id"].startswith("scr_")
    assert "timestamp" in res
    assert "expires_at" in res


def test_screenshot_service_class():
    with tempfile.TemporaryDirectory() as tmpdir:
        service = ScreenshotService(save_dir=tmpdir)

        assert service.get_shortcut("fullscreen") == "<Super><Shift>3"
        assert service.get_shortcut("window") == "<Super><Shift>4"
        assert service.get_shortcut("region") == "<Super><Shift>5"

        assert service.set_shortcut("fullscreen", "<Ctrl><Alt>S") is True
        assert service.get_shortcut("fullscreen") == "<Ctrl><Alt>S"

        # Capture fullscreen
        res_full = service.capture(
            mode="fullscreen",
            annotate=[{"type": "text", "text": "Fullscreen Test"}],
            share=True,
            strip_meta=True
        )
        assert res_full["success"] is True
        assert res_full["mode"] == "fullscreen"
        assert os.path.exists(res_full["save_path"])
        assert res_full["annotations_count"] == 1
        assert res_full["metadata_stripped"] is True
        assert res_full["share_url"].startswith("https://cmdbar.share/upload/scr_")

        # Capture region
        res_reg = service.capture(
            mode="region",
            region=[50, 60, 400, 300],
            copy_to_clipboard=False
        )
        assert res_reg["success"] is True
        assert res_reg["mode"] == "region"
        assert res_reg["region"] == {"x": 50, "y": 60, "width": 400, "height": 300}
        assert res_reg["copy_to_clipboard"] is False


def test_dbus_screenshot_api():
    with tempfile.TemporaryDirectory() as tmpdir:
        dbus = CmdBarDBusService()
        dbus._screenshot_service.save_dir = tmpdir

        # Test capture_screenshot over DBus
        ann_json = json.dumps([{"type": "text", "text": "D-Bus Annotation", "x": 5, "y": 5}])
        cap_json = dbus.capture_screenshot(
            mode="window",
            save_path=os.path.join(tmpdir, "dbus_snap.png"),
            copy_to_clipboard=True,
            annotate_json=ann_json,
            share=True,
            strip_meta=True
        )
        cap_res = json.loads(cap_json)
        assert cap_res["success"] is True
        assert cap_res["mode"] == "window"
        assert cap_res["save_path"] == os.path.join(tmpdir, "dbus_snap.png")
        assert cap_res["annotations_count"] == 1
        assert cap_res["share_url"] is not None

        # Test annotate_screenshot over DBus
        ann_res_json = dbus.annotate_screenshot("base64_sample", ann_json)
        ann_res = json.loads(ann_res_json)
        assert ann_res["success"] is True
        assert ann_res["annotations_applied"] == 1

        # Test upload_screenshot over DBus
        opts_json = json.dumps({"service_url": "https://upload.custom.org"})
        up_res_json = dbus.upload_screenshot("base64_sample", opts_json)
        up_res = json.loads(up_res_json)
        assert up_res["success"] is True
        assert up_res["share_url"].startswith("https://upload.custom.org/scr_")
