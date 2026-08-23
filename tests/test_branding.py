import unittest
import time
import os
from unittest.mock import MagicMock, patch
from app.config_schema import (
    DEFAULT_BRANDING,
    DEFAULT_CONFIG,
    validate_branding_config,
    get_branding_config
)
from companion.ai_translator import (
    apply_domain_alias,
    build_ai_request,
    http_post_json
)


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
