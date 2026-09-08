"""
Integration tests for Python SSO Manager (E2E OIDC, SAML, JIT, Group Mapping, Session lifecycle).
"""

import time
from datetime import datetime, timezone
from app.sso_manager import (
    base64_encode,
    generate_pkce,
    generate_oidc_auth_url,
    parse_and_validate_jwt,
    create_saml_request,
    parse_and_validate_saml_response,
    provision_jit_user,
    map_groups_to_permissions,
    filter_categories_for_user,
    create_sso_session,
)


def test_e2e_oidc_flow():
    # 1. Config
    sso_config = {
        "tenant": "azure-tenant-999",
        "client_id": "cmdbar-client-app",
        "jit_provisioning": {"enabled": True, "default_role": "user"},
        "group_mappings": [
            {
                "sso_group": "DevOps",
                "role": "devops",
                "allowed_categories": ["Infrastructure"],
            },
            {
                "sso_group": "Engineers",
                "role": "developer",
                "allowed_categories": ["Projects"],
            },
        ],
    }

    # 2. PKCE & Auth URL
    pkce = generate_pkce()
    auth_url = generate_oidc_auth_url(
        {
            "preset": "azuread",
            "tenant": sso_config["tenant"],
            "client_id": sso_config["client_id"],
        },
        pkce,
        "https://localhost/callback",
    )
    assert "azure-tenant-999" in auth_url

    # 3. Simulate ID Token
    header = {"alg": "RS256", "typ": "JWT"}
    now_sec = int(time.time())
    payload = {
        "iss": f"https://login.microsoftonline.com/{sso_config['tenant']}/v2.0",
        "aud": sso_config["client_id"],
        "exp": now_sec + 3600,
        "email": "alex@enterprise.com",
        "name": "Alex Mercer",
        "groups": ["DevOps"],
    }
    jwt_str = f"{base64_encode(header, url_safe=True)}.{base64_encode(payload, url_safe=True)}.sig"

    # 4. Parse JWT
    decoded = parse_and_validate_jwt(
        jwt_str,
        {
            "expectedIssuer": f"https://login.microsoftonline.com/{sso_config['tenant']}/v2.0",
            "expectedAudience": sso_config["client_id"],
        },
    )
    assert decoded["payload"]["email"] == "alex@enterprise.com"

    # 5. JIT & Group Mapping
    user_map = {}
    jit_res = provision_jit_user(
        decoded["payload"], sso_config["jit_provisioning"], user_map
    )
    permissions = map_groups_to_permissions(
        jit_res["user"]["groups"], sso_config["group_mappings"]
    )
    assert permissions["allowedCategories"] == ["Infrastructure"]

    # 6. Session & Filtering
    session = create_sso_session(
        jit_res["user"], {"accessToken": "at_123"}, permissions, {"provider": "azuread"}
    )
    assert session.validate()["valid"] is True

    categories = [{"name": "Projects"}, {"name": "Infrastructure"}]
    user_cats = filter_categories_for_user(categories, session.allowed_categories)
    assert len(user_cats) == 1
    assert user_cats[0]["name"] == "Infrastructure"


def test_e2e_saml_flow():
    saml_config = {
        "entity_id": "https://cmdbar.sp",
        "sso_url": "https://idp.okta.com/sso",
        "expectedIssuer": "https://idp.okta.com",
        "group_mappings": [
            {"sso_group": "Admins", "role": "admin", "allowed_categories": ["*"]}
        ],
    }

    req = create_saml_request(saml_config)
    assert req["base64"] is not None

    future_date = datetime.fromtimestamp(time.time() + 3600, timezone.utc).isoformat()
    saml_xml = f"""<?xml version="1.0"?>
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
  <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
  <saml:Issuer>https://idp.okta.com</saml:Issuer>
  <saml:Assertion>
    <saml:Subject>
      <saml:NameID>saml_user@enterprise.com</saml:NameID>
    </saml:Subject>
    <saml:Conditions NotOnOrAfter="{future_date}"/>
    <saml:AttributeStatement>
      <saml:Attribute Name="groups">
        <saml:AttributeValue>Admins</saml:AttributeValue>
      </saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>"""

    claims = parse_and_validate_saml_response(saml_xml, saml_config)
    assert claims["email"] == "saml_user@enterprise.com"

    user_map = {}
    jit_res = provision_jit_user(claims, {"enabled": True}, user_map)
    permissions = map_groups_to_permissions(
        jit_res["user"]["groups"], saml_config["group_mappings"]
    )
    assert "*" in permissions["allowedCategories"]

    session = create_sso_session(
        jit_res["user"], {}, permissions, {"provider": "okta", "protocol": "saml"}
    )
    assert session.status == "active"
    session.revoke()
    assert session.validate()["valid"] is False
