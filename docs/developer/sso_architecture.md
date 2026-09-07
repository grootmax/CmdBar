# Enterprise SSO Developer Architecture

This document describes the architectural design and API specifications for CmdBar Enterprise Single Sign-On (SSO).

---

## Architecture Overview

The SSO subsystem is implemented across both Python (`companion/sso_manager.py`) and JavaScript (`extension/ssoManager.js`) to provide cross-platform compatibility across the GNOME Extension and Companion backend process.

```
┌────────────────────────────────────────────────────────┐
│                    GNOME Shell Extension              │
│                   (extension/ssoManager.js)           │
└──────────────────────────┬─────────────────────────────┘
                           │ D-Bus API (org.gnome.CmdBar)
┌──────────────────────────▼─────────────────────────────┐
│                    Python Companion Backend            │
│                   (companion/sso_manager.py)          │
├────────────────────────────────────────────────────────┤
│ - SAMLHandler (Metadata, AuthnRequest, SAMLResponse)   │
│ - OIDCHandler (PKCE, Discovery, JWT Claims Verification)│
│ - JITProvisioner (Email Domain Validation, Profile)    │
│ - GroupMapper (Exact, Contains, Regex Matching)        │
│ - SessionManager (TTL, Refresh, Persistence)           │
└────────────────────────────────────────────────────────┘
```

---

## D-Bus API Specifications (`org.gnome.CmdBar`)

The following methods are exposed via D-Bus:

### `SSOLogin(s provider, s protocol, s credentials_json) -> s response_json`
Executes SSO login for the specified provider (`azure`, `okta`, `google`) and protocol (`oidc`, `saml`), returning session JSON.

### `SSOLogout(s session_id) -> b success`
Revokes active session and logs out the user.

### `GetSSOSession(s session_id) -> s session_json`
Returns active session metadata and remaining TTL.

### `GetSSOProviders() -> s providers_json`
Returns configured provider presets and metadata.

### `ValidateSSOAccess(s session_id, s category_name) -> b allowed`
Validates whether the active session permits access to the specified command category.

---

## Security Architecture

- **PKCE Verification**: Uses standard S256 code challenge method for OIDC code flows.
- **Assertion Validation**: SAML 2.0 responses are checked for status, issue instant, recipient, audience, and signature validities.
- **Isolated Storage**: Sessions are written atomically to `~/.config/cmdbar/sso_sessions.json`.
