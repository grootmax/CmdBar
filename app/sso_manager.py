"""
SSO Manager module for CmdBar application.
Implements SAML 2.0, OpenID Connect (OIDC), JIT Provisioning, Group Mapping, and Session Management.
Supports Azure AD (Entra ID), Okta, Google SSO, and generic SAML/OIDC providers.
"""

import os
import re
import json
import time
import base64
import hashlib
import secrets
from datetime import datetime, timezone
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode, quote

SSO_PROVIDER_PRESETS = {
    "azuread": {
        "name": "Azure AD / Entra ID",
        "protocol": "oidc",
        "issuer": "https://login.microsoftonline.com/{tenant}/v2.0",
        "authorization_endpoint": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
        "token_endpoint": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
        "userinfo_endpoint": "https://graph.microsoft.com/oidc/userinfo",
        "scopes": ["openid", "profile", "email", "User.Read"],
        "attribute_mapping": {
            "email": "email",
            "name": "name",
            "groups": "groups",
        },
    },
    "okta": {
        "name": "Okta SSO",
        "protocol": "oidc",
        "issuer": "https://{domain}.okta.com",
        "authorization_endpoint": "https://{domain}.okta.com/oauth2/v1/authorize",
        "token_endpoint": "https://{domain}.okta.com/oauth2/v1/token",
        "userinfo_endpoint": "https://{domain}.okta.com/oauth2/v1/userinfo",
        "scopes": ["openid", "profile", "email", "groups"],
        "attribute_mapping": {
            "email": "email",
            "name": "name",
            "groups": "groups",
        },
    },
    "google": {
        "name": "Google Workspace SSO",
        "protocol": "oidc",
        "issuer": "https://accounts.google.com",
        "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_endpoint": "https://oauth2.googleapis.com/token",
        "userinfo_endpoint": "https://openidconnect.googleapis.com/v1/userinfo",
        "scopes": ["openid", "profile", "email"],
        "attribute_mapping": {
            "email": "email",
            "name": "name",
            "groups": "hd",
        },
    },
}


def base64_encode(data, url_safe=False):
    """
    Encodes bytes, dict, or string to Base64 (standard or URL-safe).
    :visibility: public
    """
    if isinstance(data, (dict, list)):
        data_bytes = json.dumps(data).encode("utf-8")
    elif isinstance(data, str):
        data_bytes = data.encode("utf-8")
    elif isinstance(data, bytes):
        data_bytes = data
    else:
        data_bytes = str(data).encode("utf-8")

    if url_safe:
        encoded = base64.urlsafe_b64encode(data_bytes).decode("utf-8")
        return encoded.rstrip("=")
    return base64.b64encode(data_bytes).decode("utf-8")


def base64_decode(b64str, url_safe=False):
    """
    Decodes Base64 string (standard or URL-safe) to UTF-8 string.
    :visibility: public
    """
    normalized = b64str.strip()
    if url_safe:
        normalized = normalized.replace("-", "+").replace("_", "/")
    padding = len(normalized) % 4
    if padding:
        normalized += "=" * (4 - padding)
    return base64.b64decode(normalized).decode("utf-8")


def generate_pkce():
    """
    Generates PKCE code_verifier and code_challenge (S256).
    :visibility: public
    """
    verifier = secrets.token_hex(32)
    hash_bytes = hashlib.sha256(verifier.encode("utf-8")).digest()
    challenge = base64_encode(hash_bytes, url_safe=True)
    return {
        "code_verifier": verifier,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }


def resolve_oidc_provider_config(provider_config):
    """
    Resolves OIDC Provider Configuration endpoints from presets or discovery.
    :visibility: public
    """
    preset_key = (
        provider_config.get("preset") or provider_config.get("provider") or ""
    ).lower()
    preset = SSO_PROVIDER_PRESETS.get(preset_key, {})

    config = dict(preset)
    config.update(provider_config)

    tenant = config.get("tenant")
    if tenant and isinstance(tenant, str):
        for k in [
            "issuer",
            "authorization_endpoint",
            "token_endpoint",
            "userinfo_endpoint",
        ]:
            if config.get(k):
                config[k] = config[k].replace("{tenant}", tenant)

    domain = config.get("domain")
    if domain and isinstance(domain, str):
        for k in [
            "issuer",
            "authorization_endpoint",
            "token_endpoint",
            "userinfo_endpoint",
        ]:
            if config.get(k):
                config[k] = config[k].replace("{domain}", domain)

    return config


def generate_oidc_auth_url(provider_config, pkce, redirect_uri, state=""):
    """
    Generates OIDC Authorization URL with PKCE and state parameter.
    :visibility: public
    """
    config = resolve_oidc_provider_config(provider_config)
    auth_endpoint = config.get("authorization_endpoint")
    if not auth_endpoint:
        raise ValueError("Missing authorization_endpoint in OIDC configuration")

    client_id = config.get("client_id") or config.get("clientId") or ""
    scopes = config.get("scopes") or ["openid", "profile", "email"]
    scope_str = " ".join(scopes) if isinstance(scopes, list) else str(scopes)
    st = state or ("state_" + secrets.token_hex(8))

    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": scope_str,
        "state": st,
    }
    if pkce:
        params["code_challenge"] = pkce["code_challenge"]
        params["code_challenge_method"] = pkce.get("code_challenge_method", "S256")

    parsed = urlparse(auth_endpoint)
    query_dict = parse_qs(parsed.query)
    for k, v in params.items():
        query_dict[k] = [v]

    flattened = {k: v[0] for k, v in query_dict.items()}
    new_query = urlencode(flattened)
    return urlunparse(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            parsed.params,
            new_query,
            parsed.fragment,
        )
    )


def parse_and_validate_jwt(id_token, options=None):
    """
    Parses and validates JWT ID Token payload and claims.
    :visibility: public
    """
    if options is None:
        options = {}

    if not id_token or not isinstance(id_token, str):
        raise ValueError("Invalid JWT token string")

    parts = id_token.split(".")
    if len(parts) != 3:
        raise ValueError("Malformed JWT token format")

    try:
        header_str = base64_decode(parts[0], url_safe=True)
        payload_str = base64_decode(parts[1], url_safe=True)
        header = json.loads(header_str)
        payload = json.loads(payload_str)
    except Exception as e:
        raise ValueError(f"Failed to parse JWT header or payload: {e}")

    now = int(time.time())
    clock_skew = options.get("clockSkewSeconds", 300)

    # Validate Expiration (exp)
    if "exp" in payload and isinstance(payload["exp"], (int, float)):
        if now > payload["exp"] + clock_skew:
            raise ValueError(f"JWT token expired at {payload['exp']}")

    # Validate Not Before (nbf)
    if "nbf" in payload and isinstance(payload["nbf"], (int, float)):
        if now + clock_skew < payload["nbf"]:
            raise ValueError(f"JWT token not active before {payload['nbf']}")

    # Validate Issuer (iss)
    expected_issuer = options.get("expectedIssuer")
    if expected_issuer and "iss" in payload:
        if expected_issuer.rstrip("/") != payload["iss"].rstrip("/"):
            raise ValueError(
                f"JWT issuer mismatch: expected '{expected_issuer}', got '{payload['iss']}'"
            )

    # Validate Audience (aud)
    expected_aud = options.get("expectedAudience")
    if expected_aud and "aud" in payload:
        aud_list = (
            payload["aud"] if isinstance(payload["aud"], list) else [payload["aud"]]
        )
        if expected_aud not in aud_list:
            raise ValueError(f"JWT audience mismatch: expected '{expected_aud}'")

    # Validate Nonce (nonce)
    expected_nonce = options.get("expectedNonce")
    if expected_nonce and "nonce" in payload:
        if payload["nonce"] != expected_nonce:
            raise ValueError(f"JWT nonce mismatch: expected '{expected_nonce}'")

    return {"header": header, "payload": payload}


def create_saml_request(saml_config, options=None):
    """
    Builds SAML 2.0 AuthnRequest XML string and Base64 request.
    :visibility: public
    """
    if options is None:
        options = {}

    issuer = (
        saml_config.get("entity_id")
        or saml_config.get("issuer")
        or "https://cmdbar.enterprise.local/sp"
    )
    sso_url = saml_config.get("sso_url") or saml_config.get("ssoUrl") or ""
    request_id = "_" + secrets.token_hex(16)
    issue_instant = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
  ID="{request_id}"
  Version="2.0"
  IssueInstant="{issue_instant}"
  Destination="{sso_url}"
  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
  AssertionConsumerServiceURL="{saml_config.get('acs_url', 'https://cmdbar.enterprise.local/saml/acs')}">
  <saml:Issuer>{issuer}</saml:Issuer>
  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>
</samlp:AuthnRequest>"""

    b64_str = base64_encode(xml)
    return {
        "xml": xml,
        "base64": b64_str,
        "requestId": request_id,
        "issueInstant": issue_instant,
    }


def parse_and_validate_saml_response(saml_response_input, saml_config=None):
    """
    Parses SAML 2.0 Response XML / Base64 payload and validates assertions.
    :visibility: public
    """
    if saml_config is None:
        saml_config = {}

    if not saml_response_input or not isinstance(saml_response_input, str):
        raise ValueError("Invalid SAML response payload")

    xml_str = saml_response_input.strip()
    if not xml_str.startswith("<"):
        try:
            xml_str = base64_decode(xml_str)
        except Exception as e:
            raise ValueError(f"Failed to decode Base64 SAML response: {e}")

    # Check StatusCode
    status_match = re.search(
        r'<samlp:StatusCode\s+Value="([^"]+)"', xml_str, re.IGNORECASE
    ) or re.search(r'<StatusCode\s+Value="([^"]+)"', xml_str, re.IGNORECASE)
    if status_match and not status_match.group(1).endswith(":Success"):
        raise ValueError(
            f"SAML Authentication Failed with status: {status_match.group(1)}"
        )

    # Extract Issuer
    issuer_match = re.search(
        r"<saml:Issuer[^>]*>([^<]+)</saml:Issuer>", xml_str, re.IGNORECASE
    ) or re.search(r"<Issuer[^>]*>([^<]+)</Issuer>", xml_str, re.IGNORECASE)
    issuer = issuer_match.group(1).strip() if issuer_match else ""

    if (
        saml_config.get("expectedIssuer")
        and issuer
        and saml_config["expectedIssuer"] != issuer
    ):
        raise ValueError(
            f"SAML Issuer mismatch: expected '{saml_config['expectedIssuer']}', got '{issuer}'"
        )

    # Extract NameID
    nameid_match = re.search(
        r"<saml:NameID[^>]*>([^<]+)</saml:NameID>", xml_str, re.IGNORECASE
    ) or re.search(r"<NameID[^>]*>([^<]+)</NameID>", xml_str, re.IGNORECASE)
    name_id = nameid_match.group(1).strip() if nameid_match else ""

    # Check Timestamps
    not_on_or_after = re.search(r'NotOnOrAfter="([^"]+)"', xml_str, re.IGNORECASE)
    if not_on_or_after:
        ts_str = not_on_or_after.group(1)
        try:
            # Parse ISO timestamp
            dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            ts_sec = dt.timestamp()
            clock_skew = saml_config.get("clockSkewSeconds", 300)
            if time.time() > ts_sec + clock_skew:
                raise ValueError(f"SAML Assertion expired at {ts_str}")
        except Exception as e:
            if isinstance(e, ValueError) and "SAML Assertion expired" in str(e):
                raise e

    # Audience Restriction
    aud_match = re.search(
        r"<saml:Audience[^>]*>([^<]+)</saml:Audience>", xml_str, re.IGNORECASE
    ) or re.search(r"<Audience[^>]*>([^<]+)</Audience>", xml_str, re.IGNORECASE)
    audience = aud_match.group(1).strip() if aud_match else ""
    if (
        saml_config.get("expectedAudience")
        and audience
        and saml_config["expectedAudience"] != audience
    ):
        raise ValueError(
            f"SAML Audience mismatch: expected '{saml_config['expectedAudience']}', got '{audience}'"
        )

    # Attributes
    attributes = {}
    groups = []

    attr_matches = re.finditer(
        r'<saml:Attribute\s+Name="([^"]+)"[^>]*>(.*?)</saml:Attribute>',
        xml_str,
        re.DOTALL | re.IGNORECASE,
    )
    for m in attr_matches:
        attr_name = m.group(1)
        attr_block = m.group(2)
        vals = re.findall(
            r"<saml:AttributeValue[^>]*>([^<]+)</saml:AttributeValue>",
            attr_block,
            re.IGNORECASE,
        )
        clean_vals = [v.strip() for v in vals]

        if "group" in attr_name.lower() or "role" in attr_name.lower():
            groups.extend(clean_vals)
        else:
            attributes[attr_name] = (
                clean_vals[0] if len(clean_vals) == 1 else clean_vals
            )

    email = (
        attributes.get("email")
        or attributes.get("mail")
        or attributes.get(
            "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
        )
        or name_id
    )
    name = (
        attributes.get("displayName")
        or attributes.get("name")
        or attributes.get("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name")
        or (email.split("@")[0] if email else "")
    )

    return {
        "nameID": name_id,
        "issuer": issuer,
        "audience": audience,
        "email": email,
        "name": name,
        "groups": list(set(groups)),
        "attributes": attributes,
    }


def provision_jit_user(sso_claims, jit_config=None, existing_users_map=None):
    """
    Performs Just-In-Time (JIT) Provisioning for authenticated SSO users.
    :visibility: public
    """
    if jit_config is None:
        jit_config = {}
    if existing_users_map is None:
        existing_users_map = {}

    is_jit_enabled = jit_config.get("enabled", True)
    email = sso_claims.get("email") or sso_claims.get("nameID")
    if not is_jit_enabled:
        if email not in existing_users_map:
            raise ValueError(
                f"JIT Provisioning is disabled and user '{email}' does not exist."
            )
        return {"user": existing_users_map[email], "isNew": False}

    mapping = jit_config.get("attribute_mapping", {})
    email_key = mapping.get("email", "email")
    name_key = mapping.get("name", "name")
    groups_key = mapping.get("groups", "groups")

    email = (
        sso_claims.get(email_key)
        or sso_claims.get("email")
        or sso_claims.get("nameID")
        or "unknown@enterprise.com"
    )
    name = (
        sso_claims.get(name_key)
        or sso_claims.get("name")
        or sso_claims.get("displayName")
        or email.split("@")[0]
    )
    groups = sso_claims.get(groups_key) or sso_claims.get("groups") or []
    if not isinstance(groups, list):
        groups = [groups] if isinstance(groups, str) else []

    default_role = jit_config.get("default_role", "user")
    is_new = email not in existing_users_map
    user_id = (
        existing_users_map[email].get("id")
        if not is_new
        else "usr_" + base64_encode(email, url_safe=True)[:12]
    )

    user_record = {
        "id": user_id,
        "email": email,
        "name": name,
        "groups": list(set(groups)),
        "role": (
            existing_users_map[email].get("role", default_role)
            if not is_new
            else default_role
        ),
        "created_at": (
            existing_users_map[email].get("created_at")
            if not is_new
            else datetime.now(timezone.utc).isoformat()
        ),
        "last_login_at": datetime.now(timezone.utc).isoformat(),
        "is_jit_provisioned": True,
    }

    existing_users_map[email] = user_record
    return {"user": user_record, "isNew": is_new}


def map_groups_to_permissions(user_groups=None, group_mappings=None):
    """
    Maps SSO groups to CmdBar enterprise roles and category access rules.
    :visibility: public
    """
    if user_groups is None:
        user_groups = []
    if group_mappings is None:
        group_mappings = []

    if not isinstance(user_groups, list):
        user_groups = [user_groups]

    roles = set()
    allowed_categories = set()

    for mapping in group_mappings:
        if not isinstance(mapping, dict):
            continue

        group_pattern = mapping.get("sso_group")
        is_wildcard = group_pattern == "*"
        is_matched = is_wildcard or (group_pattern in user_groups)

        if is_matched:
            if mapping.get("role"):
                roles.add(mapping["role"])
            cats = mapping.get("allowed_categories")
            if isinstance(cats, list):
                for cat in cats:
                    allowed_categories.add(cat)

    return {
        "roles": list(roles),
        "allowedCategories": list(allowed_categories),
    }


def filter_categories_for_user(categories=None, allowed_categories=None):
    """
    Filters visible CmdBar categories and commands based on user session's allowed categories.
    :visibility: public
    """
    if categories is None:
        categories = []
    if (
        allowed_categories is None
        or "*" in allowed_categories
        or len(allowed_categories) == 0
    ):
        return categories

    filtered = []
    for cat in categories:
        if isinstance(cat, dict) and cat.get("name") in allowed_categories:
            filtered.append(cat)
    return filtered


class SSOSession:
    """
    SSOSession representation and session management logic.
    :visibility: public
    """

    def __init__(self, session_data=None):
        if session_data is None:
            session_data = {}

        self.session_id = session_data.get("sessionId") or (
            "sess_" + secrets.token_hex(16)
        )
        self.user_id = session_data.get("userId", "")
        self.email = session_data.get("email", "")
        self.display_name = session_data.get("displayName", "")
        self.provider = session_data.get("provider", "azuread")
        self.protocol = session_data.get("protocol", "oidc")
        self.sso_groups = session_data.get("ssoGroups", [])
        self.roles = session_data.get("roles", [])
        self.allowed_categories = session_data.get("allowedCategories", [])
        self.access_token = session_data.get("accessToken", "")
        self.refresh_token = session_data.get("refreshToken", "")
        self.id_token = session_data.get("idToken", "")
        self.created_at = (
            session_data.get("createdAt") or datetime.now(timezone.utc).isoformat()
        )
        self.last_active_at = (
            session_data.get("lastActiveAt") or datetime.now(timezone.utc).isoformat()
        )
        self.expires_at = (
            session_data.get("expiresAt")
            or datetime.fromtimestamp(time.time() + 8 * 3600, timezone.utc).isoformat()
        )
        self.status = session_data.get("status", "active")

    def validate(self, session_timeout_minutes=480, idle_timeout_minutes=120):
        """
        Validates session status, expiry, and idle timeout.
        :visibility: public
        """
        if self.status != "active":
            return {"valid": False, "reason": f"Session status is '{self.status}'"}

        now = time.time()
        try:
            exp_dt = datetime.fromisoformat(self.expires_at.replace("Z", "+00:00"))
            if now >= exp_dt.timestamp():
                self.status = "expired"
                return {"valid": False, "reason": "Session has expired"}
        except Exception:
            pass

        try:
            last_dt = datetime.fromisoformat(self.last_active_at.replace("Z", "+00:00"))
            if now - last_dt.timestamp() > idle_timeout_minutes * 60:
                self.status = "expired"
                return {"valid": False, "reason": "Session idle timeout exceeded"}
        except Exception:
            pass

        return {"valid": True}

    def touch(self):
        """
        Touches activity timestamp to prevent idle timeout.
        :visibility: public
        """
        self.last_active_at = datetime.now(timezone.utc).isoformat()

    def refresh(self, new_tokens=None, extension_minutes=480):
        """
        Refreshes session tokens and extends expiration time.
        :visibility: public
        """
        if new_tokens is None:
            new_tokens = {}

        if "accessToken" in new_tokens:
            self.access_token = new_tokens["accessToken"]
        if "refreshToken" in new_tokens:
            self.refresh_token = new_tokens["refreshToken"]
        if "idToken" in new_tokens:
            self.id_token = new_tokens["idToken"]

        self.last_active_at = datetime.now(timezone.utc).isoformat()
        self.expires_at = datetime.fromtimestamp(
            time.time() + extension_minutes * 60, timezone.utc
        ).isoformat()
        self.status = "active"

    def revoke(self):
        """
        Revokes / logs out current session.
        :visibility: public
        """
        self.status = "revoked"


def create_sso_session(user, tokens=None, permissions=None, options=None):
    """
    Creates a new SSO Session from authenticated user and token claims.
    :visibility: public
    """
    if tokens is None:
        tokens = {}
    if permissions is None:
        permissions = {}
    if options is None:
        options = {}

    timeout_mins = options.get("sessionTimeoutMinutes", 480)
    exp_iso = datetime.fromtimestamp(
        time.time() + timeout_mins * 60, timezone.utc
    ).isoformat()

    return SSOSession(
        {
            "userId": user.get("id") or user.get("email"),
            "email": user.get("email"),
            "displayName": user.get("name") or user.get("email"),
            "provider": options.get("provider", "azuread"),
            "protocol": options.get("protocol", "oidc"),
            "ssoGroups": user.get("groups", []),
            "roles": permissions.get("roles", []),
            "allowedCategories": permissions.get("allowedCategories", []),
            "accessToken": tokens.get("accessToken") or tokens.get("access_token", ""),
            "refreshToken": tokens.get("refreshToken")
            or tokens.get("refresh_token", ""),
            "idToken": tokens.get("idToken") or tokens.get("id_token", ""),
            "expiresAt": exp_iso,
            "status": "active",
        }
    )
