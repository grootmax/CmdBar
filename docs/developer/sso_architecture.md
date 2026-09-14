# Enterprise SSO Architecture & Implementation Specification

This document details the internal technical architecture of CmdBar's Single Sign-On (SSO) integration module (`extension/ssoManager.js`, `companion/sso_manager.py`, and `app/sso_manager.py`).

---

## Architecture Overview

The SSO subsystem is implemented across both Python (`companion/sso_manager.py` / `app/sso_manager.py`) and JavaScript (`extension/ssoManager.js`) to provide cross-platform compatibility across the GNOME Extension and Companion backend process.

```text
┌────────────────────────────────────────────────────────┐
│                    GNOME Shell Extension              │
│                   (extension/ssoManager.js)           │
└──────────────────────────┬─────────────────────────────┘
                           │ D-Bus API (org.gnome.CmdBar)
┌──────────────────────────▼─────────────────────────────┐
│                    Python Companion Backend            │
│          (companion/sso_manager.py & app/sso_manager.py) │
├────────────────────────────────────────────────────────┤
│ - SAMLHandler (Metadata, AuthnRequest, SAMLResponse)   │
│ - OIDCHandler (PKCE, Discovery, JWT Claims Verification)│
│ - JITProvisioner (Email Domain Validation, Profile)    │
│ - GroupMapper (Exact, Contains, Regex Matching)        │
│ - SessionManager (TTL, Refresh, Persistence)           │
└────────────────────────────────────────────────────────┘
```

---

## Data Flow

```text
+-------------------+        1. Auth Request (PKCE/SAML)      +--------------------+
|  CmdBar Extension | --------------------------------------> |  Identity Provider |
|   (GJS / Node)    |                                         | (AzureAD/Okta/Ggl) |
|         &         | <-------------------------------------- |                    |
|  Management App   |        2. ID Token / SAML Assertion     +--------------------+
|     (Python)      |
+---------+---------+
          |
          | 3. Validate Token / Assertion (exp, iss, aud, sig)
          | 4. JIT Provisioning (User Record & Attribute Sync)
          | 5. Group Mapping Engine (Group Claims -> Roles & Categories)
          v
+-------------------+        6. Filtered Categories
| Active SSOSession | --------------------------------------> UI Menu Presentation
+-------------------+
```

---

## Core Components

### 1. Provider Presets & OIDC Flow
- **Presets**: Pre-configured endpoint templates for `azuread` / `azure`, `okta`, and `google`.
- **PKCE**: Generates `code_verifier` (high-entropy cryptographic random string) and `code_challenge` using SHA-256 (`S256`).
- **JWT ID Token Validation**: Parses header and payload, verifies signature and claims (`exp`, `nbf`, `iss`, `aud`, `nonce`) against clock skew bounds (default 300s).

### 2. SAML 2.0 Module
- **AuthnRequest Builder**: Constructs compliant `samlp:AuthnRequest` XML payloads with `HTTP-POST` binding and Base64 output.
- **Assertion Parser**: Extracts `NameID`, `Issuer`, `Audience`, `NotOnOrAfter` expiration, and attribute claims (`email`, `displayName`, `groups`).

### 3. Just-In-Time (JIT) Provisioning
- Automatically provisions user records upon successful authentication.
- Maps claims dynamically based on configurable `attribute_mapping` and `allowed_domains`.
- Persists user profile metadata (`id`, `email`, `name`, `groups`, `role`, `created_at`, `last_login_at`).

### 4. Group Mapping & Permission Resolver
- Evaluates assigned SSO groups against `group_mappings` rules.
- Resolves aggregated user roles and `allowedCategories`.
- Supports exact group matches, regex / wildcard `"*"` grants, and substring patterns.

### 5. Session Management (`SSOSession`)
- Tracks active sessions with unique session IDs, user claims, tokens, timestamps (`createdAt`, `lastActiveAt`, `expiresAt`), and status (`active`, `expired`, `revoked`).
- Enforces session expiration and idle timeout validation.
- Supports activity keep-alive (`touch()`), token refresh (`refresh()`), and Single Logout revocation (`revoke()`).

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
