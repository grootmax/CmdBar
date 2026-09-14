# Enterprise SSO Integration (SAML 2.0 & OIDC)

CmdBar supports Enterprise Single Sign-On (SSO) integration with major Identity Providers (IdPs) including **Azure AD / Microsoft Entra ID**, **Okta**, and **Google Workspace SSO**, utilizing SAML 2.0 and OpenID Connect (OIDC) protocols.

---

## Features Overview

- **Identity Providers**: Native preset support for Azure AD (Entra ID), Okta, Google SSO, and generic SAML 2.0 / OIDC providers.
- **SAML 2.0 & OIDC Protocols**:
  - **OIDC**: Authorization Code Flow with PKCE (`S256`), discovery endpoints, ID Token JWT claim parsing & validation (`exp`, `nbf`, `iss`, `aud`, `nonce`), UserInfo claim fetching.
  - **SAML 2.0**: AuthnRequest XML generation, SAML response assertion parsing, status verification, x509 signature validation, timestamp bounds checking (`NotOnOrAfter`), NameID & attribute claim extraction.
- **Just-In-Time (JIT) Provisioning**: Automatically provisions local enterprise user profiles on first SSO login and synchronizes user attributes and group memberships.
- **Group Mapping Engine**: Maps Identity Provider group claims (e.g., `CmdBar-Admins`, `DevOps-Team`, `Engineers`) to CmdBar roles and category access permissions.
- **Session Management**: Session token persistence, idle timeout tracking, automatic token refresh, and Single Logout (SLO) session revocation.

---

## Configuration Example (`~/.config/cmdbar/config.json`)

```json
{
  "sso": {
    "enabled": true,
    "default_provider": "azuread",
    "session_timeout_minutes": 480,
    "idle_timeout_minutes": 120,
    "jit_provisioning": {
      "enabled": true,
      "default_role": "user",
      "attribute_mapping": {
        "email": "email",
        "name": "name",
        "groups": "groups"
      }
    },
    "providers": {
      "azuread": {
        "preset": "azuread",
        "tenant": "YOUR_AZURE_TENANT_ID",
        "client_id": "YOUR_CLIENT_ID"
      },
      "okta": {
        "preset": "okta",
        "domain": "YOUR_OKTA_DOMAIN",
        "client_id": "YOUR_CLIENT_ID"
      },
      "google": {
        "preset": "google",
        "client_id": "YOUR_CLIENT_ID"
      }
    },
    "group_mappings": [
      {
        "sso_group": "CmdBar-Admins",
        "role": "admin",
        "allowed_categories": ["*"]
      },
      {
        "sso_group": "DevOps-Team",
        "role": "devops",
        "allowed_categories": ["Infrastructure", "ECS Tasks"]
      },
      {
        "sso_group": "Engineers",
        "role": "developer",
        "allowed_categories": ["Projects", "System Utilities"]
      }
    ]
  }
}
```

---

## Category Visibility Filtering

When an enterprise user logs in via SSO, CmdBar automatically evaluates their group memberships against the defined `group_mappings`. Only categories allowed for the user's mapped groups will be displayed in the CmdBar top-bar menu. Wildcard `"*"` grants full access to all categories.
