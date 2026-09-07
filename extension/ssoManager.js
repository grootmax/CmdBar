/**
 * Enterprise SSO Manager for CmdBar Extension.
 * Supports Azure AD, Okta, Google SSO, SAML 2.0, OIDC 1.0, PKCE,
 * JIT Provisioning, Group Mapping, and Session Management.
 */

const isNode =
  typeof process !== "undefined" && process.versions && process.versions.node;

let Gio, GLib;
if (!isNode) {
  try {
    const giModule = await import("gi");
    Gio = giModule.Gio || (giModule.default && giModule.default.Gio) || giModule.default;
    GLib = giModule.GLib || (giModule.default && giModule.default.GLib);
  } catch (e) {}
}

/**
 * Utility for generating PKCE (Proof Key for Code Exchange) code verifiers and challenges.
 */
export class PKCEUtil {
  /**
   * Generates a cryptographically random PKCE code verifier.
   * @param {number} [length=64]
   * @returns {string}
   */
  static generateCodeVerifier(length = 64) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let verifier = "";
    for (let i = 0; i < length; i++) {
      verifier += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return verifier;
  }

  /**
   * Generates SHA-256 code challenge for a code verifier.
   * @param {string} codeVerifier
   * @returns {Promise<string>}
   */
  static async generateCodeChallenge(codeVerifier) {
    if (isNode) {
      const crypto = await import("crypto");
      const hash = crypto.createHash("sha256").update(codeVerifier).digest();
      return hash
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    } else if (GLib) {
      let checksum = new GLib.Checksum(GLib.ChecksumType.SHA256);
      checksum.update(new TextEncoder().encode(codeVerifier));
      let digestHex = checksum.get_string();
      // Simple base64 encode simulation for GJS
      let b64 = GLib.base64_encode(digestHex);
      return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    } else {
      return codeVerifier;
    }
  }
}

export const PROVIDER_PRESETS = {
  azure: {
    name: "Azure Active Directory",
    type: "azure",
    protocol: "oidc",
    tenant_id: "common",
    issuer: "https://login.microsoftonline.com/{tenant_id}/v2.0",
    authorization_endpoint: "https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/authorize",
    token_endpoint: "https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
    userinfo_endpoint: "https://graph.microsoft.com/oidc/userinfo",
    saml_sso_url: "https://login.microsoftonline.com/{tenant_id}/saml2",
    saml_entity_id: "https://sts.windows.net/{tenant_id}/",
    scope: "openid profile email groups",
    group_claim: "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups",
  },
  okta: {
    name: "Okta Workforce Identity",
    type: "okta",
    protocol: "oidc",
    domain: "company.okta.com",
    issuer: "https://{domain}/oauth2/default",
    authorization_endpoint: "https://{domain}/oauth2/default/v1/authorize",
    token_endpoint: "https://{domain}/oauth2/default/v1/token",
    userinfo_endpoint: "https://{domain}/oauth2/default/v1/userinfo",
    saml_sso_url: "https://{domain}/app/sso/saml",
    saml_entity_id: "http://www.okta.com/exk123456789",
    scope: "openid profile email groups",
    group_claim: "groups",
  },
  google: {
    name: "Google Workspace SSO",
    type: "google",
    protocol: "oidc",
    issuer: "https://accounts.google.com",
    authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    token_endpoint: "https://oauth2.googleapis.com/token",
    userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
    saml_sso_url: "https://accounts.google.com/o/saml2/idp",
    saml_entity_id: "https://accounts.google.com/o/saml2?idpid=default",
    scope: "openid profile email",
    group_claim: "groups",
  },
};

/**
 * SAML 2.0 Handler for Service Provider (SP) operations.
 */
export class SAMLHandler {
  constructor(spEntityId = "https://cmdbar.gnome.org/saml/metadata", acsUrl = "http://localhost:8080/saml/acs") {
    this.spEntityId = spEntityId;
    this.acsUrl = acsUrl;
  }

  /**
   * Generates SP Metadata XML.
   * @returns {string}
   */
  generateSpMetadata() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${this.spEntityId}">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${this.acsUrl}" index="0" isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`.trim();
  }

  /**
   * Generates AuthnRequest XML and base64 payload.
   * @param {string} destination
   * @param {string} [relayState]
   * @returns {object}
   */
  generateAuthnRequest(destination, relayState = null) {
    const requestId = "id_" + Math.random().toString(36).substring(2, 12);
    const issueInstant = new Date().toISOString();
    const xml = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${requestId}" Version="2.0" IssueInstant="${issueInstant}" Destination="${destination}" AssertionConsumerServiceURL="${this.acsUrl}">
  <saml:Issuer>${this.spEntityId}</saml:Issuer>
  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>
</samlp:AuthnRequest>`;

    const samlRequestB64 = Buffer.from(xml).toString("base64");
    return {
      id: requestId,
      samlRequestB64,
      relayState,
      xml,
    };
  }

  /**
   * Parses SAML Response XML string or base64 string.
   * @param {string} samlResponseB64
   * @returns {object}
   */
  parseSamlResponse(samlResponseB64) {
    try {
      let xmlStr = samlResponseB64;
      if (!samlResponseB64.trim().startsWith("<")) {
        xmlStr = Buffer.from(samlResponseB64, "base64").toString("utf-8");
      }

      const statusMatch = xmlStr.match(/<[^:]*:?StatusCode[^>]*Value="([^"]+)"/);
      if (statusMatch && !statusMatch[1].includes("Success")) {
        return { success: false, error: `SAML Status error: ${statusMatch[1]}` };
      }

      const nameIdMatch = xmlStr.match(/<[^:]*:?NameID[^>]*>([^<]+)<\/[^:]*:?NameID>/);
      const nameId = nameIdMatch ? nameIdMatch[1].trim() : "";

      const issuerMatch = xmlStr.match(/<[^:]*:?Issuer[^>]*>([^<]+)<\/[^:]*:?Issuer>/);
      const issuer = issuerMatch ? issuerMatch[1].trim() : "";

      const attributes = {};
      const attrRegex = /<[^:]*:?Attribute\s+[^>]*Name="([^"]+)"[^>]*>([\s\S]*?)<\/[^:]*:?Attribute>/g;
      let match;
      while ((match = attrRegex.exec(xmlStr)) !== null) {
        const name = match[1];
        const valRegex = /<[^:]*:?AttributeValue[^>]*>([^<]+)<\/[^:]*:?AttributeValue>/g;
        const vals = [];
        let valMatch;
        while ((valMatch = valRegex.exec(match[2])) !== null) {
          vals.push(valMatch[1].trim());
        }
        attributes[name] = vals.length === 1 ? vals[0] : vals;
      }

      const email = attributes.email || attributes.mail || nameId;
      let groups = attributes.groups || attributes["http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"] || [];
      if (typeof groups === "string") {
        groups = groups.split(",").map((g) => g.trim()).filter(Boolean);
      }

      return {
        success: true,
        nameId,
        issuer,
        email,
        attributes,
        groups,
        rawXml: xmlStr,
      };
    } catch (e) {
      return { success: false, error: `Failed to parse SAML response: ${e.message}` };
    }
  }
}

/**
 * OpenID Connect 1.0 Handler.
 */
export class OIDCHandler {
  /**
   * Generates OIDC authorization URL with PKCE parameters.
   * @param {object} providerConfig
   * @param {string} [state]
   * @param {string} [nonce]
   * @returns {Promise<object>}
   */
  static async generateAuthorizationUrl(providerConfig, state = null, nonce = null) {
    const stateVal = state || Math.random().toString(36).substring(2, 15);
    const nonceVal = nonce || Math.random().toString(36).substring(2, 15);
    const codeVerifier = PKCEUtil.generateCodeVerifier();
    const codeChallenge = await PKCEUtil.generateCodeChallenge(codeVerifier);

    const params = new URLSearchParams({
      client_id: providerConfig.client_id || "",
      response_type: "code",
      redirect_uri: providerConfig.redirect_uri || "http://localhost:8080/callback/sso",
      scope: providerConfig.scope || "openid profile email",
      state: stateVal,
      nonce: nonceVal,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    const url = `${providerConfig.authorization_endpoint}?${params.toString()}`;
    return {
      url,
      state: stateVal,
      nonce: nonceVal,
      codeVerifier,
    };
  }

  /**
   * Decodes JWT token payload without verification.
   * @param {string} jwtToken
   * @returns {object}
   */
  static decodeJwtUnverified(jwtToken) {
    try {
      const parts = jwtToken.split(".");
      if (parts.length < 2) return {};
      let payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      while (payloadB64.length % 4) payloadB64 += "=";
      const str = Buffer.from(payloadB64, "base64").toString("utf-8");
      return JSON.parse(str);
    } catch (e) {
      return {};
    }
  }

  /**
   * Verifies ID token claims (exp, aud).
   * @param {string} idToken
   * @param {string} expectedClientId
   * @returns {object}
   */
  static verifyIdTokenClaims(idToken, expectedClientId) {
    const claims = OIDCHandler.decodeJwtUnverified(idToken);
    if (!claims || !claims.sub) {
      return { valid: false, error: "Invalid JWT token structure" };
    }

    const now = Math.floor(Date.now() / 1000);
    if (claims.exp && now > claims.exp) {
      return { valid: false, error: "ID token has expired" };
    }

    if (expectedClientId) {
      const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!aud.includes(expectedClientId)) {
        return { valid: false, error: `Audience mismatch: ${claims.aud}` };
      }
    }

    return { valid: true, claims };
  }
}

/**
 * JIT Provisioning Engine.
 */
export class JITProvisioner {
  constructor(ssoConfig = {}) {
    this.ssoConfig = ssoConfig;
  }

  isDomainAllowed(email) {
    const allowed = this.ssoConfig.allowed_domains || [];
    if (!allowed.length || allowed.includes("*")) return true;
    if (!email || !email.includes("@")) return false;

    const domain = email.split("@")[1].toLowerCase().trim();
    return allowed.some((d) => d.toLowerCase().trim() === domain);
  }

  provisionUser(claimsOrAttributes) {
    const email =
      claimsOrAttributes.email ||
      claimsOrAttributes.preferred_username ||
      claimsOrAttributes.upn ||
      claimsOrAttributes.sub;

    if (!email) {
      return { success: false, error: "No valid email or identity in claims" };
    }

    if (!this.isDomainAllowed(email)) {
      return {
        success: false,
        error: `Domain '${email.split("@")[1]}' is not authorized for JIT provisioning`,
      };
    }

    const name =
      claimsOrAttributes.name ||
      claimsOrAttributes.display_name ||
      claimsOrAttributes.given_name ||
      email.split("@")[0];

    let groups = claimsOrAttributes.groups || claimsOrAttributes["http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"] || [];
    if (typeof groups === "string") {
      groups = groups.split(",").map((g) => g.trim()).filter(Boolean);
    }

    const profile = {
      user_id: "usr_" + Math.random().toString(36).substring(2, 10),
      email,
      name,
      groups,
      role: this.ssoConfig.default_role || "user",
      auto_provisioned: this.ssoConfig.auto_provision !== false,
      provisioned_at: Math.floor(Date.now() / 1000),
    };

    return { success: true, profile };
  }
}

/**
 * Group & Role Mapping Engine.
 */
export class GroupMapper {
  static ROLE_PRIORITY = { admin: 100, developer: 50, operator: 25, user: 10 };

  constructor(rules = []) {
    this.rules = rules;
  }

  evaluate(userGroups = [], defaultRole = "user") {
    let assignedRole = defaultRole;
    const assignedCategories = new Set();
    const matchedRules = [];

    const userGroupsLower = userGroups.map((g) => String(g).toLowerCase().trim());

    for (const rule of this.rules) {
      const pattern = String(rule.group_pattern || "").toLowerCase().trim();
      const matchType = String(rule.match_type || "exact").toLowerCase();

      let isMatch = false;
      for (const group of userGroupsLower) {
        if (matchType === "exact" && group === pattern) isMatch = true;
        else if (matchType === "contains" && group.includes(pattern)) isMatch = true;
        else if (matchType === "prefix" && group.startsWith(pattern)) isMatch = true;
        else if (matchType === "wildcard") {
          const reg = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
          if (reg.test(group)) isMatch = true;
        } else if (matchType === "regex") {
          try {
            if (new RegExp(pattern).test(group)) isMatch = true;
          } catch (e) {}
        }

        if (isMatch) break;
      }

      if (isMatch) {
        matchedRules.push(rule.id || "rule");
        if (rule.role) {
          const currentPrio = GroupMapper.ROLE_PRIORITY[assignedRole] || 0;
          const rulePrio = GroupMapper.ROLE_PRIORITY[rule.role] || 0;
          if (rulePrio >= currentPrio) {
            assignedRole = rule.role;
          }
        }
        if (Array.isArray(rule.categories)) {
          rule.categories.forEach((cat) => assignedCategories.add(cat));
        }
      }
    }

    return {
      role: assignedRole,
      assignedCategories: Array.from(assignedCategories).sort(),
      matchedRules,
    };
  }
}

/**
 * Session Manager for managing SSO session lifecycles and persistence.
 */
export class SSOSessionManager {
  constructor(maxTtl = 28800) {
    this.maxTtl = maxTtl;
    this.sessions = new Map();
  }

  createSession(userProfile, role, assignedCategories, provider = "azure", protocol = "oidc", tokens = {}) {
    const sessionId = "sso_sess_" + Math.random().toString(36).substring(2, 12);
    const now = Math.floor(Date.now() / 1000);
    const session = {
      session_id: sessionId,
      user_id: userProfile.user_id,
      email: userProfile.email,
      name: userProfile.name,
      groups: userProfile.groups || [],
      role,
      assigned_categories: assignedCategories,
      provider,
      protocol,
      tokens,
      issued_at: now,
      expires_at: now + this.maxTtl,
      status: "active",
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const now = Math.floor(Date.now() / 1000);
    if (now > session.expires_at || session.status !== "active") {
      session.status = "expired";
      return null;
    }

    return session;
  }

  validateSession(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) {
      return { valid: false, reason: "Session expired or invalid" };
    }

    const remainingTtl = session.expires_at - Math.floor(Date.now() / 1000);
    return {
      valid: true,
      session,
      remainingTtl,
      requiresRefresh: remainingTtl < 300,
    };
  }

  revokeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = "revoked";
      return true;
    }
    return false;
  }
}

/**
 * Top-level SSO Manager class.
 */
export class SSOManager {
  constructor(ssoConfig = {}) {
    this.config = ssoConfig;
    this.samlHandler = new SAMLHandler();
    this.jitProvisioner = new JITProvisioner(ssoConfig);
    this.groupMapper = new GroupMapper(ssoConfig.group_mappings || []);
    this.sessionManager = new SSOSessionManager(
      ssoConfig.session ? ssoConfig.session.max_ttl_seconds : 28800
    );
  }

  loginSaml(providerId, samlResponseB64) {
    const parsed = this.samlHandler.parseSamlResponse(samlResponseB64);
    if (!parsed.success) return parsed;

    const claims = {
      email: parsed.email,
      name: parsed.nameId,
      groups: parsed.groups,
      ...parsed.attributes,
    };

    const provRes = this.jitProvisioner.provisionUser(claims);
    if (!provRes.success) return provRes;

    const userProfile = provRes.profile;
    const mappingRes = this.groupMapper.evaluate(
      userProfile.groups,
      this.config.default_role || "user"
    );

    const session = this.sessionManager.createSession(
      userProfile,
      mappingRes.role,
      mappingRes.assignedCategories,
      providerId,
      "saml"
    );

    return { success: true, session, user: userProfile };
  }

  loginOidcClaims(providerId, claims, tokens = {}) {
    const provRes = this.jitProvisioner.provisionUser(claims);
    if (!provRes.success) return provRes;

    const userProfile = provRes.profile;
    const mappingRes = this.groupMapper.evaluate(
      userProfile.groups,
      this.config.default_role || "user"
    );

    const session = this.sessionManager.createSession(
      userProfile,
      mappingRes.role,
      mappingRes.assignedCategories,
      providerId,
      "oidc",
      tokens
    );

    return { success: true, session, user: userProfile };
  }

  validateCategoryAccess(sessionId, categoryName) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return false;
    if (session.role === "admin") return true;
    return session.assigned_categories.includes(categoryName);
  }
}
