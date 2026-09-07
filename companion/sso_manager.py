"""
Enterprise SSO Integration Manager for CmdBar.
Provides Azure AD, Okta, Google SSO, SAML 2.0, OIDC, JIT Provisioning,
Group Mapping, and Session Management capabilities.
"""

import os
import json
import time
import base64
import uuid
import hashlib
import hmac
import secrets
import re
import xml.etree.ElementTree as ET
from urllib.parse import urlencode, parse_qs, urlparse


class PKCEUtil:
    """
    Utility for generating PKCE (Proof Key for Code Exchange) code verifiers and challenges.
    :visibility: public
    """

    @staticmethod
    def generate_code_verifier(length: int = 64) -> str:
        """
        Generates a high-entropy cryptographically random code verifier string.
        """
        if length < 43 or length > 128:
            length = 64
        token = secrets.token_urlsafe(length)
        return token[:length]

    @staticmethod
    def generate_code_challenge(code_verifier: str) -> str:
        """
        Generates SHA-256 code challenge for a given PKCE code verifier.
        """
        digest = hashlib.sha256(code_verifier.encode("utf-8")).digest()
        challenge = base64.urlsafe_b64encode(digest).decode("utf-8").rstrip("=")
        return challenge


class SSOProviderConfig:
    """
    Configuration model and preset generator for SSO Providers (Azure AD, Okta, Google, Generic).
    :visibility: public
    """

    PRESETS = {
        "azure": {
            "name": "Azure Active Directory",
            "type": "azure",
            "protocol": "oidc",
            "tenant_id": "common",
            "issuer": "https://login.microsoftonline.com/{tenant_id}/v2.0",
            "authorization_endpoint": "https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/authorize",
            "token_endpoint": "https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
            "userinfo_endpoint": "https://graph.microsoft.com/oidc/userinfo",
            "saml_sso_url": "https://login.microsoftonline.com/{tenant_id}/saml2",
            "saml_entity_id": "https://sts.windows.net/{tenant_id}/",
            "scope": "openid profile email groups",
            "group_claim": "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups",
        },
        "okta": {
            "name": "Okta Workforce Identity",
            "type": "okta",
            "protocol": "oidc",
            "domain": "company.okta.com",
            "issuer": "https://{domain}/oauth2/default",
            "authorization_endpoint": "https://{domain}/oauth2/default/v1/authorize",
            "token_endpoint": "https://{domain}/oauth2/default/v1/token",
            "userinfo_endpoint": "https://{domain}/oauth2/default/v1/userinfo",
            "saml_sso_url": "https://{domain}/app/sso/saml",
            "saml_entity_id": "http://www.okta.com/exk123456789",
            "scope": "openid profile email groups",
            "group_claim": "groups",
        },
        "google": {
            "name": "Google Workspace SSO",
            "type": "google",
            "protocol": "oidc",
            "issuer": "https://accounts.google.com",
            "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
            "token_endpoint": "https://oauth2.googleapis.com/token",
            "userinfo_endpoint": "https://openidconnect.googleapis.com/v1/userinfo",
            "saml_sso_url": "https://accounts.google.com/o/saml2/idp",
            "saml_entity_id": "https://accounts.google.com/o/saml2?idpid=default",
            "scope": "openid profile email",
            "group_claim": "groups",
        },
    }

    def __init__(self, provider_id: str, raw_config: dict):
        self.provider_id = provider_id
        self.raw_config = raw_config or {}
        self.type = self.raw_config.get("type", provider_id)
        self.protocol = self.raw_config.get("protocol", "oidc").lower()
        self.name = self.raw_config.get("name", self.type.title())
        self.client_id = self.raw_config.get("client_id", "")
        self.client_secret = self.raw_config.get("client_secret", "")
        self.redirect_uri = self.raw_config.get(
            "redirect_uri", "http://localhost:8080/callback/sso"
        )
        self.tenant_id = self.raw_config.get("tenant_id", "common")
        self.domain = self.raw_config.get("domain", "")

        # Format endpoints using preset template variables if present
        preset = self.PRESETS.get(self.type, {})
        
        def _fmt(url):
            if not url or not isinstance(url, str):
                return ""
            if "{tenant_id}" in url or "{domain}" in url:
                return url.format(tenant_id=self.tenant_id or "common", domain=self.domain or "")
            return url

        self.issuer = _fmt(self.raw_config.get("issuer") or preset.get("issuer", ""))
        self.authorization_endpoint = _fmt(
            self.raw_config.get("authorization_endpoint") or preset.get("authorization_endpoint", "")
        )
        self.token_endpoint = _fmt(
            self.raw_config.get("token_endpoint") or preset.get("token_endpoint", "")
        )
        self.userinfo_endpoint = _fmt(
            self.raw_config.get("userinfo_endpoint") or preset.get("userinfo_endpoint", "")
        )
        self.saml_sso_url = _fmt(
            self.raw_config.get("saml_sso_url") or preset.get("saml_sso_url", "")
        )
        self.saml_entity_id = _fmt(
            self.raw_config.get("saml_entity_id") or preset.get("saml_entity_id", "")
        )
        self.scope = self.raw_config.get("scope") or preset.get("scope", "openid profile email")
        self.group_claim = self.raw_config.get("group_claim") or preset.get("group_claim", "groups")

    @classmethod
    def create_preset(cls, provider_id: str, custom_overrides: dict = None) -> "SSOProviderConfig":
        """
        Creates an SSOProviderConfig initialized with default preset configurations.
        """
        overrides = custom_overrides or {}
        preset = cls.PRESETS.get(provider_id.lower(), {})
        merged = {**preset, **overrides}
        return cls(provider_id, merged)


class SAMLHandler:
    """
    SAML 2.0 Protocol Handler for Service Provider (SP) operations.
    Supports AuthnRequest generation, SP Metadata generation, and SAMLResponse parsing/validation.
    :visibility: public
    """

    def __init__(self, sp_entity_id: str = "https://cmdbar.gnome.org/saml/metadata", acs_url: str = "http://localhost:8080/saml/acs"):
        self.sp_entity_id = sp_entity_id
        self.acs_url = acs_url

    def generate_sp_metadata(self) -> str:
        """
        Generates SAML 2.0 SP Metadata XML string.
        """
        xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="{self.sp_entity_id}">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="{self.acs_url}" index="0" isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>"""
        return xml.strip()

    def generate_authn_request(self, destination: str, relay_state: str = None) -> dict:
        """
        Generates a SAML 2.0 AuthnRequest and returns base64 encoded request details.
        """
        request_id = f"id_{uuid.uuid4().hex}"
        issue_instant = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        
        xml_request = f"""<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="{request_id}" Version="2.0" IssueInstant="{issue_instant}" Destination="{destination}" AssertionConsumerServiceURL="{self.acs_url}" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
  <saml:Issuer>{self.sp_entity_id}</saml:Issuer>
  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>
</samlp:AuthnRequest>"""

        saml_request_b64 = base64.b64encode(xml_request.encode("utf-8")).decode("utf-8")
        
        params = {"SAMLRequest": saml_request_b64}
        if relay_state:
            params["RelayState"] = relay_state

        redirect_url = f"{destination}?{urlencode(params)}" if destination else ""

        return {
            "id": request_id,
            "saml_request_b64": saml_request_b64,
            "relay_state": relay_state,
            "redirect_url": redirect_url,
            "xml": xml_request,
        }

    def parse_saml_response(self, saml_response_b64: str, expected_audience: str = None) -> dict:
        """
        Parses and validates a base64 SAML 2.0 Response XML, extracting Subject NameID, Attributes, and Issuer.
        """
        try:
            raw_xml = base64.b64decode(saml_response_b64).decode("utf-8")
            root = ET.fromstring(raw_xml)
            
            # Simple namespace stripping for robust parsing across IdPs
            for elem in root.iter():
                if "}" in elem.tag:
                    elem.tag = elem.tag.split("}", 1)[1]

            # Check Status
            status_code = root.find(".//StatusCode")
            if status_code is not None:
                value = status_code.attrib.get("Value", "")
                if "Success" not in value:
                    return {"success": False, "error": f"SAML response failed with status: {value}"}

            # Check Issuer
            issuer_elem = root.find(".//Issuer")
            issuer = issuer_elem.text.strip() if issuer_elem is not None and issuer_elem.text else ""

            # Check NameID / Subject
            name_id_elem = root.find(".//NameID")
            name_id = name_id_elem.text.strip() if name_id_elem is not None and name_id_elem.text else ""

            # Parse Attributes
            attributes = {}
            for attr in root.findall(".//Attribute"):
                name = attr.attrib.get("Name") or attr.attrib.get("FriendlyName")
                if not name:
                    continue
                vals = [v.text.strip() for v in attr.findall(".//AttributeValue") if v.text]
                if len(vals) == 1:
                    attributes[name] = vals[0]
                else:
                    attributes[name] = vals

            # Normalize common email and group attributes
            email = attributes.get("email") or attributes.get("mail") or attributes.get("User.email") or name_id
            groups = attributes.get("groups") or attributes.get("http://schemas.microsoft.com/ws/2008/06/identity/claims/groups") or attributes.get("memberOf") or []
            if isinstance(groups, str):
                groups = [g.strip() for g in groups.split(",") if g.strip()]

            return {
                "success": True,
                "issuer": issuer,
                "name_id": name_id,
                "email": email,
                "attributes": attributes,
                "groups": groups,
                "raw_xml": raw_xml,
            }
        except Exception as e:
            return {"success": False, "error": f"Failed to parse SAML response: {str(e)}"}

    def generate_logout_request(self, name_id: str, destination: str) -> dict:
        """
        Generates SAML Single Logout (SLO) request.
        """
        request_id = f"id_{uuid.uuid4().hex}"
        issue_instant = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        xml = f"""<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="{request_id}" Version="2.0" IssueInstant="{issue_instant}" Destination="{destination}">
  <saml:Issuer>{self.sp_entity_id}</saml:Issuer>
  <saml:NameID>{name_id}</saml:NameID>
</samlp:LogoutRequest>"""
        return {
            "id": request_id,
            "logout_request_b64": base64.b64encode(xml.encode("utf-8")).decode("utf-8"),
            "xml": xml,
        }


class OIDCHandler:
    """
    OpenID Connect (OIDC) 1.0 Handler for authorization code exchange, PKCE, ID token validation, and UserInfo querying.
    :visibility: public
    """

    @staticmethod
    def generate_authorization_url(provider_config: SSOProviderConfig, state: str = None, nonce: str = None) -> dict:
        """
        Generates OIDC authorization URL with PKCE parameters.
        """
        state = state or secrets.token_hex(16)
        nonce = nonce or secrets.token_hex(16)
        code_verifier = PKCEUtil.generate_code_verifier()
        code_challenge = PKCEUtil.generate_code_challenge(code_verifier)

        params = {
            "client_id": provider_config.client_id,
            "response_type": "code",
            "redirect_uri": provider_config.redirect_uri,
            "scope": provider_config.scope,
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }

        url = f"{provider_config.authorization_endpoint}?{urlencode(params)}"
        return {
            "url": url,
            "state": state,
            "nonce": nonce,
            "code_verifier": code_verifier,
        }

    @staticmethod
    def decode_jwt_unverified(jwt_token: str) -> dict:
        """
        Decodes JWT token header and payload without signature verification (for local extraction).
        """
        try:
            parts = jwt_token.split(".")
            if len(parts) < 2:
                return {}
            payload_b64 = parts[1]
            # Add padding if needed
            payload_b64 += "=" * ((4 - len(payload_b64) % 4) % 4)
            decoded_bytes = base64.urlsafe_b64decode(payload_b64)
            return json.loads(decoded_bytes.decode("utf-8"))
        except Exception:
            return {}

    @classmethod
    def verify_id_token_claims(cls, id_token: str, expected_client_id: str, expected_issuer: str = None) -> dict:
        """
        Verifies ID token expiration, audience, and issuer claims.
        """
        claims = cls.decode_jwt_unverified(id_token)
        if not claims:
            return {"valid": False, "error": "Invalid JWT token structure"}

        now = time.time()
        exp = claims.get("exp")
        if exp and now > exp:
            return {"valid": False, "error": "ID token has expired"}

        aud = claims.get("aud")
        if isinstance(aud, list):
            if expected_client_id and expected_client_id not in aud:
                return {"valid": False, "error": f"Audience mismatch: {aud}"}
        elif isinstance(aud, str):
            if expected_client_id and expected_client_id != aud:
                return {"valid": False, "error": f"Audience mismatch: {aud}"}

        if expected_issuer:
            iss = claims.get("iss", "")
            if not iss.startswith(expected_issuer.rstrip("/")):
                return {"valid": False, "error": f"Issuer mismatch: {iss}"}

        return {"valid": True, "claims": claims}


class JITProvisioner:
    """
    Just-In-Time (JIT) Provisioning Engine for creating or updating local user profiles on SSO login.
    :visibility: public
    """

    def __init__(self, sso_config: dict = None):
        self.sso_config = sso_config or {}

    def is_domain_allowed(self, email: str) -> bool:
        """
        Checks if the user's email domain is in the allowed_domains list.
        """
        allowed = self.sso_config.get("allowed_domains", [])
        if not allowed or "*" in allowed:
            return True

        if not email or "@" not in email:
            return False

        domain = email.split("@")[-1].lower().strip()
        return any(d.lower().strip() == domain for d in allowed)

    def provision_user(self, claims_or_attributes: dict) -> dict:
        """
        Provisions user profile based on SSO claims/attributes and configuration rules.
        """
        auto_provision = self.sso_config.get("auto_provision", True)
        email = (
            claims_or_attributes.get("email")
            or claims_or_attributes.get("preferred_username")
            or claims_or_attributes.get("upn")
            or claims_or_attributes.get("sub", "")
        )

        if not email:
            return {"success": False, "error": "No valid email or user identity in SSO claims"}

        if not self.is_domain_allowed(email):
            return {
                "success": False,
                "error": f"Domain '{email.split('@')[-1]}' is not authorized for JIT provisioning",
            }

        name = (
            claims_or_attributes.get("name")
            or claims_or_attributes.get("display_name")
            or claims_or_attributes.get("given_name")
            or email.split("@")[0]
        )

        # Extract groups
        group_claim_key = self.sso_config.get("group_claim", "groups")
        groups = claims_or_attributes.get(group_claim_key) or claims_or_attributes.get("groups") or []
        if isinstance(groups, str):
            groups = [g.strip() for g in groups.split(",") if g.strip()]

        default_role = self.sso_config.get("default_role", "user")

        profile = {
            "user_id": f"usr_{uuid.uuid5(uuid.NAMESPACE_DNS, email).hex[:12]}",
            "email": email,
            "name": name,
            "groups": groups,
            "role": default_role,
            "auto_provisioned": auto_provision,
            "provisioned_at": int(time.time()),
        }

        return {"success": True, "profile": profile}

    provisionUser = provision_user


class GroupMapper:
    """
    Evaluates group & role mapping rules to assign CmdBar roles and category access.
    :visibility: public
    """

    ROLE_PRIORITY = {"admin": 100, "developer": 50, "operator": 25, "user": 10}

    def __init__(self, mapping_rules: list = None):
        self.rules = mapping_rules or []

    def evaluate(self, user_groups: list, default_role: str = "user") -> dict:
        """
        Evaluates user groups against mapping rules and returns assigned role and allowed categories.
        """
        assigned_role = default_role
        assigned_categories = set()
        matched_rules = []

        user_groups_lower = [str(g).lower().strip() for g in user_groups]

        for rule in self.rules:
            pattern = str(rule.get("group_pattern", "")).lower().strip()
            match_type = rule.get("match_type", "exact").lower()
            rule_role = rule.get("role")
            rule_categories = rule.get("categories", [])

            is_match = False
            for group in user_groups_lower:
                if match_type == "exact" and group == pattern:
                    is_match = True
                elif match_type == "contains" and pattern in group:
                    is_match = True
                elif match_type == "prefix" and group.startswith(pattern):
                    is_match = True
                elif match_type == "wildcard":
                    regex_pat = "^" + pattern.replace("*", ".*") + "$"
                    if re.match(regex_pat, group):
                        is_match = True
                elif match_type == "regex":
                    try:
                        if re.search(pattern, group):
                            is_match = True
                    except Exception:
                        pass

                if is_match:
                    break

            if is_match:
                matched_rules.append(rule.get("id", "unnamed_rule"))
                if rule_role:
                    current_prio = self.ROLE_PRIORITY.get(assigned_role, 0)
                    rule_prio = self.ROLE_PRIORITY.get(rule_role, 0)
                    if rule_prio >= current_prio:
                        assigned_role = rule_role
                for cat in rule_categories:
                    assigned_categories.add(cat)

        return {
            "role": assigned_role,
            "assigned_categories": sorted(list(assigned_categories)),
            "matched_rules": matched_rules,
        }


class SessionManager:
    """
    Manages active SSO user sessions, token lifecycles, TTLs, and persistence.
    :visibility: public
    """

    def __init__(self, session_file_path: str = None, max_ttl: int = 28800):
        self.session_file_path = session_file_path or os.path.expanduser(
            "~/.config/cmdbar/sso_sessions.json"
        )
        self.max_ttl = max_ttl
        self.sessions = {}
        self.load_sessions()

    def create_session(
        self,
        user_profile: dict,
        role: str,
        assigned_categories: list,
        provider: str = "azure",
        protocol: str = "oidc",
        tokens: dict = None,
    ) -> dict:
        """
        Creates a new SSO session for a provisioned user profile.
        """
        session_id = f"sso_sess_{uuid.uuid4().hex}"
        now = int(time.time())
        expires_at = now + self.max_ttl

        session = {
            "session_id": session_id,
            "user_id": user_profile.get("user_id"),
            "email": user_profile.get("email"),
            "name": user_profile.get("name"),
            "groups": user_profile.get("groups", []),
            "role": role,
            "assigned_categories": assigned_categories,
            "provider": provider,
            "protocol": protocol,
            "tokens": tokens or {},
            "issued_at": now,
            "expires_at": expires_at,
            "status": "active",
        }

        self.sessions[session_id] = session
        self.save_sessions()
        return session

    def get_session(self, session_id: str) -> dict:
        """
        Retrieves active session details if valid and non-expired.
        """
        session = self.sessions.get(session_id)
        if not session:
            return None

        now = int(time.time())
        if now > session.get("expires_at", 0) or session.get("status") != "active":
            session["status"] = "expired"
            self.save_sessions()
            return None

        return session

    def validate_session(self, session_id: str) -> dict:
        """
        Validates session status and remaining TTL.
        """
        session = self.get_session(session_id)
        if not session:
            return {"valid": False, "reason": "Session missing, revoked, or expired"}

        remaining_ttl = session["expires_at"] - int(time.time())
        return {
            "valid": True,
            "session": session,
            "remaining_ttl": remaining_ttl,
            "requires_refresh": remaining_ttl < 300,
        }

    def revoke_session(self, session_id: str) -> bool:
        """
        Revokes / logs out an active session.
        """
        if session_id in self.sessions:
            self.sessions[session_id]["status"] = "revoked"
            self.save_sessions()
            return True
        return False

    def load_sessions(self):
        """
        Loads persisted sessions from storage file.
        """
        if os.path.exists(self.session_file_path):
            try:
                with open(self.session_file_path, "r", encoding="utf-8") as f:
                    self.sessions = json.load(f)
            except Exception:
                self.sessions = {}

    def save_sessions(self):
        """
        Saves current active sessions to storage file.
        """
        try:
            os.makedirs(os.path.dirname(self.session_file_path), exist_ok=True)
            with open(self.session_file_path, "w", encoding="utf-8") as f:
                json.dump(self.sessions, f, indent=2)
        except Exception:
            pass


class SSOManager:
    """
    High-level facade orchestrating Providers, SAML/OIDC, JIT, Group Mapping, and Session Management.
    :visibility: public
    """

    def __init__(self, config: dict = None, session_file_path: str = None):
        self.config = config.get("sso", {}) if config else {}
        self.session_manager = SessionManager(session_file_path)
        self.jit_provisioner = JITProvisioner(self.config)
        self.group_mapper = GroupMapper(self.config.get("group_mappings", []))
        self.saml_handler = SAMLHandler()

    def get_provider_config(self, provider_id: str) -> SSOProviderConfig:
        """
        Gets SSOProviderConfig for given provider_id.
        """
        providers = self.config.get("providers", {})
        raw_cfg = providers.get(provider_id, {})
        return SSOProviderConfig.create_preset(provider_id, raw_cfg)

    def login_saml(self, provider_id: str, saml_response_b64: str) -> dict:
        """
        Executes SAML 2.0 login flow, JIT provisioning, Group mapping, and session creation.
        """
        parsed = self.saml_handler.parse_saml_response(saml_response_b64)
        if not parsed.get("success"):
            return parsed

        claims = {
            "email": parsed.get("email"),
            "name": parsed.get("name_id"),
            "groups": parsed.get("groups", []),
            **parsed.get("attributes", {}),
        }

        # JIT Provisioning
        provision_res = self.jit_provisioner.provision_user(claims)
        if not provision_res.get("success"):
            return provision_res

        user_profile = provision_res["profile"]

        # Group & Role Mapping
        mapping_res = self.group_mapper.evaluate(
            user_profile["groups"], default_role=self.config.get("default_role", "user")
        )

        session = self.session_manager.create_session(
            user_profile=user_profile,
            role=mapping_res["role"],
            assigned_categories=mapping_res["assigned_categories"],
            provider=provider_id,
            protocol="saml",
        )

        return {"success": True, "session": session, "user": user_profile}

    def login_oidc_claims(self, provider_id: str, claims: dict, tokens: dict = None) -> dict:
        """
        Executes OIDC login flow using verified claims, JIT provisioning, Group mapping, and session creation.
        """
        # JIT Provisioning
        provision_res = self.jit_provisioner.provision_user(claims)
        if not provision_res.get("success"):
            return provision_res

        user_profile = provision_res["profile"]

        # Group & Role Mapping
        mapping_res = self.group_mapper.evaluate(
            user_profile["groups"], default_role=self.config.get("default_role", "user")
        )

        session = self.session_manager.create_session(
            user_profile=user_profile,
            role=mapping_res["role"],
            assigned_categories=mapping_res["assigned_categories"],
            provider=provider_id,
            protocol="oidc",
            tokens=tokens,
        )

        return {"success": True, "session": session, "user": user_profile}

    def validate_category_access(self, session_id: str, category_name: str) -> bool:
        """
        Checks if the active SSO session allows access to a specific CmdBar category.
        """
        session = self.session_manager.get_session(session_id)
        if not session:
            return False

        if session.get("role") == "admin":
            return True

        allowed = session.get("assigned_categories", [])
        return category_name in allowed
