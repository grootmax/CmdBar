"""
Unit tests for app.sso_manager (Python SSO Integration).
"""

import time
import pytest
from datetime import datetime, timezone
from app.sso_manager import (
    SSO_PROVIDER_PRESETS,
    base64_encode,
    base64_decode,
    generate_pkce,
    resolve_oidc_provider_config,
    generate_oidc_auth_url,
    parse_and_validate_jwt,
    create_saml_request,
    parse_and_validate_saml_response,
    provision_jit_user,
    map_groups_to_permissions,
    filter_categories_for_user,
    SSOSession,
    create_sso_session,
)


def test_sso_provider_presets():
    assert "azuread" in SSO_PROVIDER_PRESETS
    assert "okta" in SSO_PROVIDER_PRESETS
    assert "google" in SSO_PROVIDER_PRESETS
    assert SSO_PROVIDER_PRESETS["azuread"]["protocol"] == "oidc"


def test_base64_encode_decode():
    raw = "CmdBar Enterprise Python SSO Test 456!"
    std_enc = base64_encode(raw, url_safe=False)
    assert base64_decode(std_enc, url_safe=False) == raw

    url_enc = base64_encode(raw, url_safe=True)
    assert "=" not in url_enc
    assert base64_decode(url_enc, url_safe=True) == raw


def test_generate_pkce():
    pkce = generate_pkce()
    assert "code_verifier" in pkce
    assert "code_challenge" in pkce
    assert pkce["code_challenge_method"] == "S256"
    assert len(pkce["code_verifier"]) >= 32


def test_resolve_oidc_provider_config():
    cfg = resolve_oidc_provider_config(
        {"preset": "azuread", "tenant": "my-azure-tenant-id"}
    )
    assert "my-azure-tenant-id" in cfg["issuer"]
    assert "my-azure-tenant-id" in cfg["authorization_endpoint"]


def test_generate_oidc_auth_url():
    pkce = generate_pkce()
    url = generate_oidc_auth_url(
        {"preset": "okta", "domain": "dev-9999", "client_id": "okta-client-id"},
        pkce,
        "https://localhost/callback",
        "test-state-123",
    )
    assert "https://dev-9999.okta.com/oauth2/v1/authorize" in url
    assert "response_type=code" in url
    assert "client_id=okta-client-id" in url
    assert "code_challenge=" in url


def test_parse_and_validate_jwt():
    header = {"alg": "RS256", "typ": "JWT"}
    now_sec = int(time.time())
    payload = {
        "iss": "https://accounts.google.com",
        "aud": "google-client-app",
        "exp": now_sec + 3600,
        "nbf": now_sec - 60,
        "email": "dan@enterprise.com",
        "name": "Dan Miller",
        "groups": ["Engineering"],
    }

    jwt_str = f"{base64_encode(header, url_safe=True)}.{base64_encode(payload, url_safe=True)}.mock_sig"
    decoded = parse_and_validate_jwt(
        jwt_str,
        {
            "expectedIssuer": "https://accounts.google.com",
            "expectedAudience": "google-client-app",
        },
    )

    assert decoded["payload"]["email"] == "dan@enterprise.com"
    assert decoded["payload"]["groups"] == ["Engineering"]


def test_parse_and_validate_jwt_errors():
    header = {"alg": "RS256"}
    now_sec = int(time.time())

    # Expired token
    expired_payload = {"exp": now_sec - 3600}
    jwt_exp = f"{base64_encode(header, url_safe=True)}.{base64_encode(expired_payload, url_safe=True)}.sig"
    with pytest.raises(ValueError, match="expired"):
        parse_and_validate_jwt(jwt_exp)

    # Issuer mismatch
    valid_payload = {"exp": now_sec + 3600, "iss": "https://idp.com"}
    jwt_valid = f"{base64_encode(header, url_safe=True)}.{base64_encode(valid_payload, url_safe=True)}.sig"
    with pytest.raises(ValueError, match="issuer mismatch"):
        parse_and_validate_jwt(jwt_valid, {"expectedIssuer": "https://other.com"})


def test_create_saml_request():
    req = create_saml_request(
        {"entity_id": "https://cmdbar.app", "sso_url": "https://idp.example.com/sso"}
    )
    assert "<samlp:AuthnRequest" in req["xml"]
    assert "https://idp.example.com/sso" in req["xml"]
    assert len(req["base64"]) > 0


def test_parse_and_validate_saml_response():
    future_date = datetime.fromtimestamp(time.time() + 3600, timezone.utc).isoformat()
    saml_xml = f"""<?xml version="1.0"?>
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
  <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
  <saml:Issuer>https://saml-idp.com</saml:Issuer>
  <saml:Assertion>
    <saml:Subject>
      <saml:NameID>eve@enterprise.com</saml:NameID>
    </saml:Subject>
    <saml:Conditions NotOnOrAfter="{future_date}">
      <saml:AudienceRestriction>
        <saml:Audience>https://cmdbar.app</saml:Audience>
      </saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AttributeStatement>
      <saml:Attribute Name="displayName">
        <saml:AttributeValue>Eve Adams</saml:AttributeValue>
      </saml:Attribute>
      <saml:Attribute Name="groups">
        <saml:AttributeValue>CmdBar-Admins</saml:AttributeValue>
      </saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>"""

    parsed = parse_and_validate_saml_response(
        saml_xml,
        {
            "expectedIssuer": "https://saml-idp.com",
            "expectedAudience": "https://cmdbar.app",
        },
    )

    assert parsed["email"] == "eve@enterprise.com"
    assert parsed["name"] == "Eve Adams"
    assert parsed["groups"] == ["CmdBar-Admins"]


def test_provision_jit_user():
    users_map = {}
    claims = {
        "email": "frank@enterprise.com",
        "name": "Frank Wright",
        "groups": ["DevOps"],
    }

    res1 = provision_jit_user(
        claims, {"enabled": True, "default_role": "operator"}, users_map
    )
    assert res1["isNew"] is True
    assert res1["user"]["email"] == "frank@enterprise.com"
    assert res1["user"]["role"] == "operator"

    res2 = provision_jit_user(claims, {"enabled": True}, users_map)
    assert res2["isNew"] is False

    with pytest.raises(ValueError, match="disabled"):
        provision_jit_user(
            {"email": "ghost@enterprise.com"}, {"enabled": False}, users_map
        )


def test_map_groups_to_permissions():
    mappings = [
        {"sso_group": "CmdBar-Admins", "role": "admin", "allowed_categories": ["*"]},
        {
            "sso_group": "DevOps",
            "role": "devops",
            "allowed_categories": ["Infrastructure"],
        },
    ]

    res1 = map_groups_to_permissions(["DevOps"], mappings)
    assert "devops" in res1["roles"]
    assert res1["allowedCategories"] == ["Infrastructure"]

    res2 = map_groups_to_permissions(["CmdBar-Admins"], mappings)
    assert "admin" in res2["roles"]
    assert "*" in res2["allowedCategories"]


def test_filter_categories_for_user():
    categories = [
        {"name": "Projects"},
        {"name": "Infrastructure"},
        {"name": "Admin Tasks"},
    ]

    assert filter_categories_for_user(categories, ["*"]) == categories
    filtered = filter_categories_for_user(categories, ["Projects"])
    assert len(filtered) == 1
    assert filtered[0]["name"] == "Projects"


def test_sso_session_lifecycle():
    user = {
        "id": "usr_777",
        "email": "grace@enterprise.com",
        "name": "Grace Hopper",
        "groups": ["DevOps"],
    }
    tokens = {"accessToken": "access_xyz", "refreshToken": "refresh_abc"}
    permissions = {"roles": ["devops"], "allowedCategories": ["Infrastructure"]}

    session = create_sso_session(
        user, tokens, permissions, {"provider": "azuread", "sessionTimeoutMinutes": 120}
    )

    assert session.email == "grace@enterprise.com"
    assert session.status == "active"

    val = session.validate(120, 60)
    assert val["valid"] is True

    session.touch()
    assert session.last_active_at is not None

    session.refresh({"accessToken": "new_access_xyz"})
    assert session.access_token == "new_access_xyz"

    session.revoke()
    assert session.status == "revoked"
    assert session.validate()["valid"] is False
