"""
Unit and Integration tests for CmdBar Enterprise SSO Integration (SAML 2.0 & OIDC).
"""

import os
import json
import time
import base64
import pytest
from companion.sso_manager import (
    PKCEUtil,
    SSOProviderConfig,
    SAMLHandler,
    OIDCHandler,
    JITProvisioner,
    GroupMapper,
    SessionManager,
    SSOManager,
)
from companion.dbus_service import CmdBarDBusService


def test_pkce_util_generation():
    verifier = PKCEUtil.generate_code_verifier(64)
    assert len(verifier) == 64
    challenge = PKCEUtil.generate_code_challenge(verifier)
    assert len(challenge) > 20
    assert "=" not in challenge


def test_sso_provider_config_presets():
    azure_cfg = SSOProviderConfig.create_preset("azure", {"client_id": "az_123"})
    assert azure_cfg.name == "Azure Active Directory"
    assert azure_cfg.protocol == "oidc"
    assert "login.microsoftonline.com" in azure_cfg.authorization_endpoint
    assert azure_cfg.client_id == "az_123"

    okta_cfg = SSOProviderConfig.create_preset("okta", {"domain": "dev.okta.com", "client_id": "ok_456"})
    assert "dev.okta.com" in okta_cfg.authorization_endpoint
    assert okta_cfg.client_id == "ok_456"

    google_cfg = SSOProviderConfig.create_preset("google", {"client_id": "goog_789"})
    assert "accounts.google.com" in google_cfg.authorization_endpoint
    assert google_cfg.client_id == "goog_789"


def test_saml_handler():
    saml = SAMLHandler(sp_entity_id="https://test.cmdbar.org/metadata", acs_url="http://localhost:8080/acs")
    metadata = saml.generate_sp_metadata()
    assert "<md:EntityDescriptor" in metadata
    assert "https://test.cmdbar.org/metadata" in metadata

    authn = saml.generate_authn_request(destination="https://idp.example.com/sso", relay_state="state_123")
    assert authn["saml_request_b64"]
    assert authn["relay_state"] == "state_123"
    assert "https://idp.example.com/sso" in authn["redirect_url"]

    # Mock SAML Response
    sample_xml = """<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
  <saml:Assertion>
    <saml:Issuer>https://idp.example.com</saml:Issuer>
    <saml:Subject><saml:NameID>user@company.com</saml:NameID></saml:Subject>
    <saml:AttributeStatement>
      <saml:Attribute Name="email"><saml:AttributeValue>user@company.com</saml:AttributeValue></saml:Attribute>
      <saml:Attribute Name="groups">
        <saml:AttributeValue>Azure-Admins</saml:AttributeValue>
        <saml:AttributeValue>Developers</saml:AttributeValue>
      </saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>"""
    saml_b64 = base64.b64encode(sample_xml.encode("utf-8")).decode("utf-8")
    parsed = saml.parse_saml_response(saml_b64)

    assert parsed["success"] is True
    assert parsed["email"] == "user@company.com"
    assert parsed["issuer"] == "https://idp.example.com"
    assert "Azure-Admins" in parsed["groups"]
    assert "Developers" in parsed["groups"]


def test_oidc_handler():
    provider_cfg = SSOProviderConfig.create_preset("azure", {"client_id": "test_client"})
    auth_data = OIDCHandler.generate_authorization_url(provider_cfg)

    assert "test_client" in auth_data["url"]
    assert "code_challenge=" in auth_data["url"]
    assert auth_data["code_verifier"]

    # Test JWT payload parsing and claim verification
    header = base64.b64encode(json.dumps({"alg": "none"}).encode("utf-8")).decode("utf-8")
    payload_data = {
        "sub": "usr_999",
        "email": "alice@company.com",
        "aud": "test_client",
        "exp": int(time.time()) + 3600,
        "iss": "https://login.microsoftonline.com/common/v2.0",
    }
    payload = base64.b64encode(json.dumps(payload_data).encode("utf-8")).decode("utf-8")
    mock_jwt = f"{header}.{payload}."

    decoded = OIDCHandler.decode_jwt_unverified(mock_jwt)
    assert decoded["sub"] == "usr_999"
    assert decoded["email"] == "alice@company.com"

    verified = OIDCHandler.verify_id_token_claims(mock_jwt, expected_client_id="test_client")
    assert verified["valid"] is True
    assert verified["claims"]["email"] == "alice@company.com"


def test_jit_provisioner():
    config = {
        "auto_provision": True,
        "allowed_domains": ["company.com", "example.com"],
        "default_role": "user",
    }
    jit = JITProvisioner(config)

    assert jit.is_domain_allowed("bob@company.com") is True
    assert jit.is_domain_allowed("charlie@other.com") is False

    res = jit.provisionUser({"email": "bob@company.com", "name": "Bob Smith", "groups": ["Admins"]})
    assert res["success"] is True
    assert res["profile"]["email"] == "bob@company.com"
    assert res["profile"]["name"] == "Bob Smith"

    blocked = jit.provisionUser({"email": "evil@untrusted.com"})
    assert blocked["success"] is False
    assert "not authorized" in blocked["error"]


def test_group_mapper():
    rules = [
        {
            "id": "rule-admin",
            "group_pattern": "Admins",
            "match_type": "contains",
            "role": "admin",
            "categories": ["System Utilities", "Infrastructure"],
        },
        {
            "id": "rule-dev",
            "group_pattern": "Dev-*",
            "match_type": "wildcard",
            "role": "developer",
            "categories": ["Projects"],
        },
    ]

    mapper = GroupMapper(rules)
    res_admin = mapper.evaluate(["Azure-Admins", "Dev-Backend"])
    assert res_admin["role"] == "admin"
    assert "System Utilities" in res_admin["assigned_categories"]
    assert "Infrastructure" in res_admin["assigned_categories"]
    assert "Projects" in res_admin["assigned_categories"]

    res_dev = mapper.evaluate(["Dev-Frontend"])
    assert res_dev["role"] == "developer"
    assert "Projects" in res_dev["assigned_categories"]


def test_session_manager(tmp_path):
    session_file = os.path.join(tmp_path, "sso_sessions.json")
    mgr = SessionManager(session_file_path=session_file, max_ttl=3600)

    user = {"user_id": "u1", "email": "test@company.com", "name": "Test User", "groups": ["Admins"]}
    sess = mgr.create_session(user, role="admin", assigned_categories=["Projects"], provider="azure")

    assert sess["session_id"]
    assert sess["status"] == "active"

    val = mgr.validate_session(sess["session_id"])
    assert val["valid"] is True
    assert val["session"]["email"] == "test@company.com"

    mgr.revoke_session(sess["session_id"])
    val_revoked = mgr.validate_session(sess["session_id"])
    assert val_revoked["valid"] is False


def test_sso_manager_facade_and_dbus(tmp_path):
    config = {
        "sso": {
            "enabled": True,
            "allowed_domains": ["company.com"],
            "group_mappings": [
                {
                    "id": "rule1",
                    "group_pattern": "Admins",
                    "match_type": "contains",
                    "role": "admin",
                    "categories": ["Infrastructure"],
                }
            ],
        }
    }
    sso_mgr = SSOManager(config, session_file_path=os.path.join(tmp_path, "sess.json"))

    # OIDC Login test
    claims = {"email": "dev@company.com", "name": "Dev User", "groups": ["Admins"]}
    oidc_res = sso_mgr.login_oidc_claims("azure", claims)

    assert oidc_res["success"] is True
    sess_id = oidc_res["session"]["session_id"]

    assert sso_mgr.validate_category_access(sess_id, "Infrastructure") is True

    # Test DBus service wrappers
    dbus_svc = CmdBarDBusService()
    dbus_svc._sso_manager = sso_mgr

    sso_info = dbus_svc.get_sso_session(sess_id)
    assert "dev@company.com" in sso_info

    providers = dbus_svc.get_sso_providers()
    assert "Azure Active Directory" in providers

    assert dbus_svc.validate_sso_access(sess_id, "Infrastructure") is True
    assert dbus_svc.sso_logout(sess_id) is True
