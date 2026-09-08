import os
import json
import time
import pytest
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from app.config_schema import (
    DEFAULT_BRANDING,
    DEFAULT_CONFIG,
    validate_branding_config,
    get_effective_branding,
    get_branding_config,
    get_effective_domain_url,
    get_ssl_context,
    load_config,
    save_config,
)
from companion.dbus_service import CmdBarDBusService
from companion.ai_translator import (
    apply_domain_alias,
    build_ai_request,
    http_post_json
)



def test_validate_branding_config_valid():
    valid = {
        "enabled": True,
        "app_name": "AcmeCmd",
        "logo_path": "/opt/acme/logo.png",
        "brand_colors": {
            "primary": "#1e3a8a",
            "accent": "#3b82f6",
            "background": "#0f172a",
            "text": "#ffffff",
        },
        "domain_alias": "cmd.acme.corp",
        "custom_ssl": {
            "cert_path": "/etc/ssl/acme.crt",
            "key_path": "/etc/ssl/acme.key",
            "ca_path": "/etc/ssl/ca.crt",
            "verify_ssl": True,
        },
        "enterprise_identity": {
            "organization_name": "Acme Corp",
            "support_url": "https://support.acme.corp",
            "support_email": "ops@acme.corp",
            "footer_text": "Internal Acme Corporate Tooling",
        },
    }
    assert validate_branding_config(valid) is True
    assert validate_branding_config(None) is True
    assert validate_branding_config({}) is True


def test_validate_branding_config_invalid():
    bad_color = {"brand_colors": {"primary": "invalid-color-code"}}
    assert validate_branding_config(bad_color) is False

    bad_domain = {"domain_alias": "http://invalid domain"}
    assert validate_branding_config(bad_domain) is False

    bad_ssl = {"custom_ssl": {"verify_ssl": "yes"}}
    assert validate_branding_config(bad_ssl) is False

    bad_identity = {"enterprise_identity": {"organization_name": 123}}
    assert validate_branding_config(bad_identity) is False


def test_get_effective_branding():
    effective_default = get_effective_branding({})
    assert effective_default["enabled"] is False
    assert effective_default["app_name"] == "CmdBar"

    custom_config = {
        "branding": {
            "enabled": True,
            "app_name": "AcmeConsole",
            "brand_colors": {"primary": "#002288"},
            "domain_alias": "console.acme.corp",
        }
    }
    effective_custom = get_effective_branding(custom_config)
    assert effective_custom["enabled"] is True
    assert effective_custom["app_name"] == "AcmeConsole"
    assert effective_custom["brand_colors"]["primary"] == "#002288"
    assert effective_custom["domain_alias"] == "console.acme.corp"


def test_get_effective_domain_url():
    branding = {"domain_alias": "cmd.acme.corp"}
    assert (
        get_effective_domain_url(branding, "/api/v1/status")
        == "https://cmd.acme.corp/api/v1/status"
    )
    assert (
        get_effective_domain_url(branding, "api/v1/status")
        == "https://cmd.acme.corp/api/v1/status"
    )
    assert get_effective_domain_url({}, "/api/v1/status") == "/api/v1/status"


def test_get_ssl_context():
    branding_unverified = {"custom_ssl": {"verify_ssl": False}}
    ctx_unverified = get_ssl_context(branding_unverified)
    assert ctx_unverified is not None

    branding_default = {"custom_ssl": {"verify_ssl": True}}
    ctx_default = get_ssl_context(branding_default)
    assert ctx_default is not None


def test_python_dbus_branding_service():
    with tempfile.TemporaryDirectory() as tmpdir:
        config_file = os.path.join(tmpdir, "config.json")
        init_cfg = json.loads(json.dumps(DEFAULT_CONFIG))
        save_config(init_cfg, config_file)

        service = CmdBarDBusService(config_path=config_file)
        assert service.get_effective_app_name() == "CmdBar"

        new_branding = {
            "enabled": True,
            "app_name": "AcmeSystem",
            "logo_path": "acme-logo",
            "brand_colors": {"primary": "#ff1122"},
            "domain_alias": "system.acme.corp",
        }

        success = service.set_branding(json.dumps(new_branding))
        assert success is True

        assert service.get_effective_app_name() == "AcmeSystem"

        retrieved = service.get_branding()
        assert retrieved["enabled"] is True
        assert retrieved["app_name"] == "AcmeSystem"
        assert retrieved["domain_alias"] == "system.acme.corp"


class TestEnterpriseBranding(unittest.TestCase):

    def test_default_branding_schema(self):
        self.assertFalse(DEFAULT_BRANDING["enabled"])
        self.assertFalse(DEFAULT_BRANDING["white_label"])
        self.assertEqual(DEFAULT_BRANDING["organization_name"], "CmdBar Enterprise")
        self.assertEqual(DEFAULT_BRANDING["brand_color"], "#0055ff")
        self.assertEqual(DEFAULT_BRANDING["accent_color"], "#00aaff")

    def test_validate_branding_config(self):
        # Valid
        self.assertTrue(validate_branding_config(None))
        self.assertTrue(validate_branding_config({}))
        self.assertTrue(validate_branding_config({
            "enabled": True,
            "white_label": True,
            "organization_name": "Acme Corp",
            "brand_color": "#ff0000",
            "domain_alias": "cmdbar.acme.corp",
            "custom_ssl": {"verify_ssl": False}
        }))

        # Invalid types
        self.assertFalse(validate_branding_config("not-a-dict"))
        self.assertFalse(validate_branding_config({"enabled": "not-a-bool"}))
        self.assertFalse(validate_branding_config({"organization_name": 12345}))
        self.assertFalse(validate_branding_config({"brand_color": True}))
        self.assertFalse(validate_branding_config({"custom_ssl": "not-a-dict"}))
        self.assertFalse(validate_branding_config({"custom_ssl": {"verify_ssl": "invalid"}}))

    def test_get_branding_config_resolution(self):
        # Default when missing
        res_default = get_branding_config({})
        self.assertFalse(res_default["enabled"])
        self.assertEqual(res_default["organization_name"], "CmdBar Enterprise")

        # White label enabled
        config = {
            "branding": {
                "white_label": True,
                "organization_name": "Globex Corp",
                "brand_color": "#112233",
                "domain_alias": "commands.globex.internal",
                "custom_ssl": {
                    "cert_path": "/path/to/cert.pem",
                    "verify_ssl": False
                }
            }
        }
        res = get_branding_config(config)
        self.assertTrue(res["enabled"])
        self.assertTrue(res["white_label"])
        self.assertEqual(res["organization_name"], "Globex Corp")
        self.assertEqual(res["brand_color"], "#112233")
        self.assertEqual(res["domain_alias"], "commands.globex.internal")
        self.assertEqual(res["custom_ssl"]["cert_path"], "/path/to/cert.pem")
        self.assertFalse(res["custom_ssl"]["verify_ssl"])

    def test_apply_domain_alias(self):
        # Host replacement
        endpoint = "https://api.openai.com/v1/chat/completions"
        self.assertEqual(
            apply_domain_alias(endpoint, "cmdbar.acme.internal"),
            "https://cmdbar.acme.internal/v1/chat/completions"
        )

        # Full URL override
        self.assertEqual(
            apply_domain_alias(endpoint, "https://custom.endpoint.corp/ai"),
            "https://custom.endpoint.corp/ai/v1/chat/completions"
        )

        # Empty alias returns unmodified
        self.assertEqual(apply_domain_alias(endpoint, ""), endpoint)
        self.assertEqual(apply_domain_alias(endpoint, None), endpoint)

    def test_build_ai_request_with_domain_alias(self):
        options = {
            "branding": {
                "enabled": True,
                "domain_alias": "ai.corp.internal"
            }
        }
        endpoint, headers, body_bytes, prov = build_ai_request("openai", "list docker containers", options)
        self.assertEqual(endpoint, "https://ai.corp.internal/v1/chat/completions")
        self.assertEqual(prov, "openai")

    @patch("urllib.request.urlopen")
    def test_http_post_json_custom_ssl(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"status": "ok"}'
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        ssl_opts = {
            "verify_ssl": False,
            "cert_path": "/nonexistent/cert.crt"
        }
        res = http_post_json("https://cmdbar.acme.internal/api", {"Content-Type": "application/json"}, b'{}', ssl_options=ssl_opts)
        self.assertEqual(res, {"status": "ok"})
        self.assertTrue(mock_urlopen.called)

    def test_branding_resolution_performance_benchmark(self):
        config = {
            "branding": {
                "enabled": True,
                "organization_name": "Initech Systems",
                "brand_color": "#00ff00",
                "domain_alias": "cmd.initech.com"
            }
        }
        start = time.perf_counter()
        for _ in range(1000):
            res = get_branding_config(config)
            self.assertTrue(res["enabled"])
        elapsed_ms = (time.perf_counter() - start) * 1000
        # 1000 iterations must run in under 50ms (<0.05ms per call)
        self.assertLess(elapsed_ms, 50.0)


if __name__ == "__main__":
    unittest.main()

