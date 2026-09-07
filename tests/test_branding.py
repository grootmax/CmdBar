import os
import json
import pytest
import tempfile
from app.config_schema import (
    validate_branding_config,
    get_effective_branding,
    get_effective_domain_url,
    get_ssl_context,
    load_config,
    save_config,
    DEFAULT_CONFIG
)
from companion.dbus_service import CmdBarDBusService

def test_validate_branding_config_valid():
    valid = {
        "enabled": True,
        "app_name": "AcmeCmd",
        "logo_path": "/opt/acme/logo.png",
        "brand_colors": {
            "primary": "#1e3a8a",
            "accent": "#3b82f6",
            "background": "#0f172a",
            "text": "#ffffff"
        },
        "domain_alias": "cmd.acme.corp",
        "custom_ssl": {
            "cert_path": "/etc/ssl/acme.crt",
            "key_path": "/etc/ssl/acme.key",
            "ca_path": "/etc/ssl/ca.crt",
            "verify_ssl": True
        },
        "enterprise_identity": {
            "organization_name": "Acme Corp",
            "support_url": "https://support.acme.corp",
            "support_email": "ops@acme.corp",
            "footer_text": "Internal Acme Corporate Tooling"
        }
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
            "domain_alias": "console.acme.corp"
        }
    }
    effective_custom = get_effective_branding(custom_config)
    assert effective_custom["enabled"] is True
    assert effective_custom["app_name"] == "AcmeConsole"
    assert effective_custom["brand_colors"]["primary"] == "#002288"
    assert effective_custom["domain_alias"] == "console.acme.corp"


def test_get_effective_domain_url():
    branding = {"domain_alias": "cmd.acme.corp"}
    assert get_effective_domain_url(branding, "/api/v1/status") == "https://cmd.acme.corp/api/v1/status"
    assert get_effective_domain_url(branding, "api/v1/status") == "https://cmd.acme.corp/api/v1/status"
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
            "domain_alias": "system.acme.corp"
        }

        success = service.set_branding(json.dumps(new_branding))
        assert success is True

        assert service.get_effective_app_name() == "AcmeSystem"

        retrieved = service.get_branding()
        assert retrieved["enabled"] is True
        assert retrieved["app_name"] == "AcmeSystem"
        assert retrieved["domain_alias"] == "system.acme.corp"
