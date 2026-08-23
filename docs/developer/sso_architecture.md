# Enterprise SSO Architecture & Implementation Specification

This document details the internal technical architecture of CmdBar's Single Sign-On (SSO) integration module (`extension/ssoManager.js` and `app/sso_manager.py`).

---

## Architecture & Data Flow

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
- **Presets**: Pre-configured endpoint templates for `azuread`, `okta`, and `google`.
- **PKCE**: Generates `code_verifier` (high-entropy cryptographic random string) and `code_challenge` using SHA-256 (`S256`).
- **JWT ID Token Validation**: Parses header and payload, verifies signature and claims (`exp`, `nbf`, `iss`, `aud`, `nonce`) against clock skew bounds (default 300s).

### 2. SAML 2.0 Module
- **AuthnRequest Builder**: Constructs compliant `samlp:AuthnRequest` XML payloads with `HTTP-POST` binding and Base64 output.
- **Assertion Parser**: Extracts `NameID`, `Issuer`, `Audience`, `NotOnOrAfter` expiration, and attribute claims (`email`, `displayName`, `groups`).

### 3. Just-In-Time (JIT) Provisioning
- Automatically provisions user records upon successful authentication.
- Maps claims dynamically based on configurable `attribute_mapping`.
- Persists user profile metadata (`id`, `email`, `name`, `groups`, `role`, `created_at`, `last_login_at`).

### 4. Group Mapping & Permission Resolver
- Evaluates assigned SSO groups against `group_mappings` rules.
- Resolves aggregated user roles and `allowedCategories`.
- Supports exact group matches and wildcard `"*"` grants.

### 5. Session Management (`SSOSession`)
- Tracks active sessions with unique session IDs, user claims, tokens, timestamps (`createdAt`, `lastActiveAt`, `expiresAt`), and status (`active`, `expired`, `revoked`).
- Enforces session expiration and idle timeout validation.
- Supports activity keep-alive (`touch()`), token refresh (`refresh()`), and Single Logout revocation (`revoke()`).
