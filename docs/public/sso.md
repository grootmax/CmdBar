# Enterprise SSO Integration (SAML 2.0 & OIDC)

CmdBar Enterprise provides Single Sign-On (SSO) integration supporting **Azure Active Directory (Entra ID)**, **Okta**, and **Google Workspace SSO**, as well as generic **SAML 2.0** and **OpenID Connect (OIDC 1.0)** identity providers.

---

## Features

- **Multi-Provider Support**: Preset adapters for Azure AD, Okta, and Google SSO.
- **SAML 2.0 Protocol**: Service Provider (SP) metadata generation, AuthnRequest creation, and SAML Response assertion validation.
- **OIDC 1.0 & PKCE**: OAuth 2.0 / OIDC authorization code flow with Proof Key for Code Exchange (PKCE) for secure authentication.
- **Just-In-Time (JIT) Provisioning**: Automatic profile provisioning and permission setup on first login, with email domain allowlists.
- **Role & Group Mapping**: Flexible mapping rules matching IdP groups/roles to CmdBar permissions and category access.
- **Session Management**: Secure session lifecycle tracking, TTL validation, token refresh, and single logout (SLO).

---

## Configuration Example

Below is an example configuration in `~/.config/cmdbar/config.json`:

```json
{
  "sso": {
    "enabled": true,
    "default_provider": "azure",
    "auto_provision": true,
    "allowed_domains": ["company.com", "example.com"],
    "default_role": "user",
    "providers": {
      "azure": {
        "name": "Azure Active Directory",
        "type": "azure",
        "protocol": "oidc",
        "tenant_id": "your-tenant-id",
        "client_id": "your-client-id",
        "client_secret": "your-client-secret",
        "redirect_uri": "http://localhost:8080/callback/sso"
      },
      "okta": {
        "name": "Okta Workforce Identity",
        "type": "okta",
        "protocol": "oidc",
        "domain": "company.okta.com",
        "client_id": "your-okta-client-id"
      },
      "google": {
        "name": "Google Workspace SSO",
        "type": "google",
        "protocol": "oidc",
        "client_id": "your-google-client-id"
      }
    },
    "group_mappings": [
      {
        "id": "admin-rule",
        "group_pattern": "Azure-Admins",
        "match_type": "contains",
        "role": "admin",
        "categories": ["System Utilities", "Infrastructure", "AI Assistant", "Projects"]
      },
      {
        "id": "dev-rule",
        "group_pattern": "Developers",
        "match_type": "contains",
        "role": "developer",
        "categories": ["Projects", "AI Assistant"]
      }
    ],
    "session": {
      "max_ttl_seconds": 28800,
      "refresh_threshold_seconds": 300
    }
  }
}
```

---

## JIT Provisioning & Group Mapping

When users sign in via SSO:
1. **Domain Checking**: The user's email domain is verified against `allowed_domains`.
2. **Profile Creation**: Profile details (`email`, `name`, `groups`) are extracted from claims/assertions.
3. **Group Evaluation**: Rules in `group_mappings` are evaluated in sequence (`exact`, `contains`, `prefix`, `wildcard`, `regex`) to assign the role (`admin`, `developer`, `user`) and category access.
4. **Session Activation**: A session token with TTL is generated and stored securely.
