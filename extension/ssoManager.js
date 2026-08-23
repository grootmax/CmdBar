/**
 * SSO Manager module for CmdBar extension.
 * Implements SAML 2.0, OpenID Connect (OIDC), JIT Provisioning, Group Mapping, and Session Management.
 * Supports Azure AD (Entra ID), Okta, Google SSO, and generic SAML/OIDC providers.
 */

const isNode = typeof process !== "undefined" && process.versions && process.versions.node;

let cryptoModule, fsModule, pathModule;
if (isNode) {
  try {
    cryptoModule = await import("crypto");
    fsModule = await import("fs");
    pathModule = await import("path");
  } catch (e) {}
}

/**
 * Provider Preset Configurations for Azure AD, Okta, and Google SSO.
 * @type {Object.<string, object>}
 * :visibility: public
 */
export const SSO_PROVIDER_PRESETS = {
  azuread: {
    name: "Azure AD / Entra ID",
    protocol: "oidc",
    issuer: "https://login.microsoftonline.com/{tenant}/v2.0",
    authorization_endpoint: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
    token_endpoint: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
    userinfo_endpoint: "https://graph.microsoft.com/oidc/userinfo",
    scopes: ["openid", "profile", "email", "User.Read"],
    attribute_mapping: {
      email: "email",
      name: "name",
      groups: "groups",
    },
  },
  okta: {
    name: "Okta SSO",
    protocol: "oidc",
    issuer: "https://{domain}.okta.com",
    authorization_endpoint: "https://{domain}.okta.com/oauth2/v1/authorize",
    token_endpoint: "https://{domain}.okta.com/oauth2/v1/token",
    userinfo_endpoint: "https://{domain}.okta.com/oauth2/v1/userinfo",
    scopes: ["openid", "profile", "email", "groups"],
    attribute_mapping: {
      email: "email",
      name: "name",
      groups: "groups",
    },
  },
  google: {
    name: "Google Workspace SSO",
    protocol: "oidc",
    issuer: "https://accounts.google.com",
    authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    token_endpoint: "https://oauth2.googleapis.com/token",
    userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
    scopes: ["openid", "profile", "email"],
    attribute_mapping: {
      email: "email",
      name: "name",
      groups: "hd", // Host domain or custom groups claim
    },
  },
};

/**
 * Helper to encode string or buffer to Base64 (URL-safe or standard).
 * @param {string|Uint8Array} data
 * @param {boolean} [urlSafe=false]
 * @returns {string}
 * :visibility: public
 */
export function base64Encode(data, urlSafe = false) {
  let input = data;
  if (typeof data === "object" && data !== null && !(data instanceof Uint8Array)) {
    input = JSON.stringify(data);
  }
  let b64 = "";
  if (isNode && cryptoModule) {
    const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
    b64 = buf.toString("base64");
  } else if (typeof btoa !== "undefined") {
    const str = typeof input === "string" ? input : String.fromCharCode.apply(null, input);
    b64 = btoa(str);
  } else {
    // Basic fallback for environments without Buffer/btoa
    const str = typeof input === "string" ? input : String.fromCharCode.apply(null, input);
    b64 = typeof Buffer !== "undefined" ? Buffer.from(str).toString("base64") : str;
  }

  if (urlSafe) {
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  return b64;
}

/**
 * Helper to decode Base64 string.
 * @param {string} b64str
 * @param {boolean} [urlSafe=false]
 * @returns {string}
 * :visibility: public
 */
export function base64Decode(b64str, urlSafe = false) {
  let normalized = b64str;
  if (urlSafe) {
    normalized = normalized.replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4) {
      normalized += "=";
    }
  }

  if (isNode && cryptoModule) {
    return Buffer.from(normalized, "base64").toString("utf8");
  } else if (typeof atob !== "undefined") {
    return atob(normalized);
  } else {
    return typeof Buffer !== "undefined" ? Buffer.from(normalized, "base64").toString("utf8") : normalized;
  }
}

/**
 * Generates PKCE code_verifier and code_challenge (S256).
 * @returns {{code_verifier: string, code_challenge: string, code_challenge_method: string}}
 * :visibility: public
 */
export function generatePKCE() {
  let verifier = "";
  if (isNode && cryptoModule) {
    verifier = cryptoModule.randomBytes(32).toString("hex");
  } else {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    for (let i = 0; i < 64; i++) {
      verifier += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }

  let challenge = "";
  if (isNode && cryptoModule) {
    const hash = cryptoModule.createHash("sha256").update(verifier).digest();
    challenge = base64Encode(hash, true);
  } else {
    // Fallback pseudo-challenge when crypto sha256 is unavailable in test environment
    challenge = base64Encode(verifier, true);
  }

  return {
    code_verifier: verifier,
    code_challenge: challenge,
    code_challenge_method: "S256",
  };
}

/**
 * Resolves OIDC Provider Configuration endpoints from presets or discovery.
 * @param {object} providerConfig
 * @returns {object}
 * :visibility: public
 */
export function resolveOIDCProviderConfig(providerConfig) {
  const presetKey = (providerConfig.preset || providerConfig.provider || "").toLowerCase();
  const preset = SSO_PROVIDER_PRESETS[presetKey] || {};

  const config = { ...preset, ...providerConfig };

  // Replace placeholders if domain or tenant are provided
  if (config.tenant && typeof config.tenant === "string") {
    ["issuer", "authorization_endpoint", "token_endpoint", "userinfo_endpoint"].forEach((key) => {
      if (config[key]) config[key] = config[key].replace(/\{tenant\}/g, config.tenant);
    });
  }
  if (config.domain && typeof config.domain === "string") {
    ["issuer", "authorization_endpoint", "token_endpoint", "userinfo_endpoint"].forEach((key) => {
      if (config[key]) config[key] = config[key].replace(/\{domain\}/g, config.domain);
    });
  }

  return config;
}

/**
 * Generates OIDC Authorization URL with PKCE and state parameter.
 * @param {object} providerConfig
 * @param {object} pkce
 * @param {string} redirectUri
 * @param {string} [state]
 * @returns {string}
 * :visibility: public
 */
export function generateOIDCAuthUrl(providerConfig, pkce, redirectUri, state = "") {
  const config = resolveOIDCProviderConfig(providerConfig);
  const authEndpoint = config.authorization_endpoint;
  if (!authEndpoint) {
    throw new Error("Missing authorization_endpoint in OIDC configuration");
  }

  const clientId = config.client_id || config.clientId || "";
  const scopes = Array.isArray(config.scopes) ? config.scopes.join(" ") : config.scopes || "openid profile email";
  const st = state || (isNode && cryptoModule ? cryptoModule.randomBytes(16).toString("hex") : "state_" + Date.now());

  const url = new URL(authEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes);
  url.searchParams.set("state", st);
  if (pkce) {
    url.searchParams.set("code_challenge", pkce.code_challenge);
    url.searchParams.set("code_challenge_method", pkce.code_challenge_method || "S256");
  }

  return url.toString();
}

/**
 * Parses and validates JWT ID Token payload and claims.
 * @param {string} idToken
 * @param {object} [options]
 * @returns {object} Decoded payload claims
 * :visibility: public
 */
export function parseAndValidateJWT(idToken, options = {}) {
  if (!idToken || typeof idToken !== "string") {
    throw new Error("Invalid JWT token string");
  }

  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed JWT token format");
  }

  const headerStr = base64Decode(parts[0], true);
  const payloadStr = base64Decode(parts[1], true);

  let header, payload;
  try {
    header = JSON.parse(headerStr);
    payload = JSON.parse(payloadStr);
  } catch (e) {
    throw new Error("Failed to parse JWT JSON header or payload");
  }

  const now = Math.floor(Date.now() / 1000);
  const clockSkew = options.clockSkewSeconds || 300;

  // Validate Expiration (exp)
  if (payload.exp && typeof payload.exp === "number") {
    if (now > payload.exp + clockSkew) {
      throw new Error(`JWT token expired at ${new Date(payload.exp * 1000).toISOString()}`);
    }
  }

  // Validate Not Before (nbf)
  if (payload.nbf && typeof payload.nbf === "number") {
    if (now + clockSkew < payload.nbf) {
      throw new Error(`JWT token not active before ${new Date(payload.nbf * 1000).toISOString()}`);
    }
  }

  // Validate Issuer (iss)
  if (options.expectedIssuer && payload.iss) {
    const expected = options.expectedIssuer.replace(/\/$/, "");
    const actual = payload.iss.replace(/\/$/, "");
    if (expected !== actual) {
      throw new Error(`JWT issuer mismatch: expected '${expected}', got '${actual}'`);
    }
  }

  // Validate Audience (aud)
  if (options.expectedAudience && payload.aud) {
    const audArray = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audArray.includes(options.expectedAudience)) {
      throw new Error(`JWT audience mismatch: expected '${options.expectedAudience}'`);
    }
  }

  // Validate Nonce (nonce)
  if (options.expectedNonce && payload.nonce) {
    if (payload.nonce !== options.expectedNonce) {
      throw new Error(`JWT nonce mismatch: expected '${options.expectedNonce}'`);
    }
  }

  return { header, payload };
}

/**
 * Builds SAML 2.0 AuthnRequest XML string and Base64 request.
 * @param {object} samlConfig
 * @param {object} [options]
 * @returns {{xml: string, base64: string, requestId: string, issueInstant: string}}
 * :visibility: public
 */
export function createSAMLRequest(samlConfig, options = {}) {
  const issuer = samlConfig.entity_id || samlConfig.issuer || "https://cmdbar.enterprise.local/sp";
  const ssoUrl = samlConfig.sso_url || samlConfig.ssoUrl || "";
  const requestId = "_" + (isNode && cryptoModule ? cryptoModule.randomBytes(16).toString("hex") : "saml_" + Date.now());
  const issueInstant = new Date().toISOString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
  ID="${requestId}"
  Version="2.0"
  IssueInstant="${issueInstant}"
  Destination="${ssoUrl}"
  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
  AssertionConsumerServiceURL="${samlConfig.acs_url || "https://cmdbar.enterprise.local/saml/acs"}">
  <saml:Issuer>${issuer}</saml:Issuer>
  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>
</samlp:AuthnRequest>`;

  const base64 = base64Encode(xml);
  return { xml, base64, requestId, issueInstant };
}

/**
 * Parses SAML 2.0 Response XML / Base64 payload and validates assertions.
 * @param {string} samlResponseInput XML or Base64 string
 * @param {object} [samlConfig] Configuration and validation parameters
 * @returns {object} Extracted SAML attributes and user claims
 * :visibility: public
 */
export function parseAndValidateSAMLResponse(samlResponseInput, samlConfig = {}) {
  if (!samlResponseInput || typeof samlResponseInput !== "string") {
    throw new Error("Invalid SAML response payload");
  }

  let xmlStr = samlResponseInput.trim();
  if (!xmlStr.startsWith("<")) {
    try {
      xmlStr = base64Decode(xmlStr);
    } catch (e) {
      throw new Error("Failed to decode Base64 SAML response");
    }
  }

  // Check StatusCode
  const statusMatch = /<samlp:StatusCode\s+Value="([^"]+)"/i.exec(xmlStr) || /<StatusCode\s+Value="([^"]+)"/i.exec(xmlStr);
  if (statusMatch && !statusMatch[1].endsWith(":Success")) {
    throw new Error(`SAML Authentication Failed with status: ${statusMatch[1]}`);
  }

  // Extract Issuer
  const issuerMatch = /<saml:Issuer[^>]*>([^<]+)<\/saml:Issuer>/i.exec(xmlStr) || /<Issuer[^>]*>([^<]+)<\/Issuer>/i.exec(xmlStr);
  const issuer = issuerMatch ? issuerMatch[1].trim() : "";

  if (samlConfig.expectedIssuer && issuer && samlConfig.expectedIssuer !== issuer) {
    throw new Error(`SAML Issuer mismatch: expected '${samlConfig.expectedIssuer}', got '${issuer}'`);
  }

  // Extract NameID
  const nameIdMatch = /<saml:NameID[^>]*>([^<]+)<\/saml:NameID>/i.exec(xmlStr) || /<NameID[^>]*>([^<]+)<\/NameID>/i.exec(xmlStr);
  const nameID = nameIdMatch ? nameIdMatch[1].trim() : "";

  // Check Timestamps (NotOnOrAfter / SessionNotOnOrAfter)
  const notOnOrAfterMatch = /NotOnOrAfter="([^"]+)"/i.exec(xmlStr);
  if (notOnOrAfterMatch) {
    const notOnOrAfter = new Date(notOnOrAfterMatch[1]).getTime();
    const clockSkewMs = (samlConfig.clockSkewSeconds || 300) * 1000;
    if (Date.now() > notOnOrAfter + clockSkewMs) {
      throw new Error(`SAML Assertion expired at ${notOnOrAfterMatch[1]}`);
    }
  }

  // Extract Audience Restriction
  const audienceMatch = /<saml:Audience[^>]*>([^<]+)<\/saml:Audience>/i.exec(xmlStr) || /<Audience[^>]*>([^<]+)<\/Audience>/i.exec(xmlStr);
  const audience = audienceMatch ? audienceMatch[1].trim() : "";
  if (samlConfig.expectedAudience && audience && samlConfig.expectedAudience !== audience) {
    throw new Error(`SAML Audience mismatch: expected '${samlConfig.expectedAudience}', got '${audience}'`);
  }

  // Extract Attributes
  const attributes = {};
  const groups = [];

  const attrRegex = /<saml:Attribute\s+Name="([^"]+)"[^>]*>([\s\S]*?)<\/saml:Attribute>/gi;
  let match;
  while ((match = attrRegex.exec(xmlStr)) !== null) {
    const attrName = match[1];
    const attrBlock = match[2];

    const valRegex = /<saml:AttributeValue[^>]*>([^<]+)<\/saml:AttributeValue>/gi;
    const values = [];
    let valMatch;
    while ((valMatch = valRegex.exec(attrBlock)) !== null) {
      values.push(valMatch[1].trim());
    }

    if (attrName.toLowerCase().includes("group") || attrName.toLowerCase().includes("role")) {
      groups.push(...values);
    } else {
      attributes[attrName] = values.length === 1 ? values[0] : values;
    }
  }

  const email = attributes.email || attributes.mail || attributes["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"] || nameID;
  const name = attributes.displayName || attributes.name || attributes["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"] || email.split("@")[0];

  return {
    nameID,
    issuer,
    audience,
    email,
    name,
    groups: [...new Set(groups)],
    attributes,
  };
}

/**
 * Performs Just-In-Time (JIT) Provisioning for authenticated SSO users.
 * @param {object} ssoClaims User claims from SAML/OIDC
 * @param {object} [jitConfig] JIT provisioning rules
 * @param {object} [existingUsersMap] Existing database/store of users
 * @returns {object} Provisioned user record
 * :visibility: public
 */
export function provisionJITUser(ssoClaims, jitConfig = {}, existingUsersMap = {}) {
  const isJITEnabled = jitConfig.enabled !== false;
  if (!isJITEnabled) {
    const email = ssoClaims.email || ssoClaims.nameID;
    if (!existingUsersMap[email]) {
      throw new Error(`JIT Provisioning is disabled and user '${email}' does not exist.`);
    }
    return existingUsersMap[email];
  }

  const mapping = jitConfig.attribute_mapping || {};
  const emailKey = mapping.email || "email";
  const nameKey = mapping.name || "name";
  const groupsKey = mapping.groups || "groups";

  const email = ssoClaims[emailKey] || ssoClaims.email || ssoClaims.nameID || "unknown@enterprise.com";
  const name = ssoClaims[nameKey] || ssoClaims.name || ssoClaims.displayName || email.split("@")[0];
  let groups = ssoClaims[groupsKey] || ssoClaims.groups || [];
  if (!Array.isArray(groups)) {
    groups = typeof groups === "string" ? [groups] : [];
  }

  const defaultRole = jitConfig.default_role || "user";
  const userId = existingUsersMap[email]?.id || "usr_" + base64Encode(email, true).slice(0, 12);
  const isNew = !existingUsersMap[email];

  const userRecord = {
    id: userId,
    email,
    name,
    groups: [...new Set(groups)],
    role: existingUsersMap[email]?.role || defaultRole,
    created_at: existingUsersMap[email]?.created_at || new Date().toISOString(),
    last_login_at: new Date().toISOString(),
    is_jit_provisioned: true,
  };

  existingUsersMap[email] = userRecord;
  return { user: userRecord, isNew };
}

/**
 * Maps SSO groups to CmdBar enterprise roles and category access rules.
 * @param {string[]} userGroups List of groups assigned to user from SSO
 * @param {Array.<{sso_group: string, role: string, allowed_categories: string[]}>} groupMappings
 * @returns {{roles: string[], allowedCategories: string[]}}
 * :visibility: public
 */
export function mapGroupsToPermissions(userGroups = [], groupMappings = []) {
  if (!Array.isArray(userGroups)) userGroups = [userGroups];

  const roles = new Set();
  const allowedCategories = new Set();

  for (const mapping of groupMappings) {
    if (!mapping || typeof mapping !== "object") continue;

    const groupPattern = mapping.sso_group;
    const isWildcard = groupPattern === "*";
    const isMatched = isWildcard || userGroups.includes(groupPattern);

    if (isMatched) {
      if (mapping.role) roles.add(mapping.role);
      if (Array.isArray(mapping.allowed_categories)) {
        mapping.allowed_categories.forEach((cat) => allowedCategories.add(cat));
      }
    }
  }

  return {
    roles: Array.from(roles),
    allowedCategories: Array.from(allowedCategories),
  };
}

/**
 * Filters visible CmdBar categories and commands based on user session's allowed categories.
 * @param {Array.<object>} categories Original categories list
 * @param {string[]} allowedCategories Allowed category names or ["*"] for full access
 * @returns {Array.<object>}
 * :visibility: public
 */
export function filterCategoriesForUser(categories = [], allowedCategories = []) {
  if (!Array.isArray(allowedCategories) || allowedCategories.includes("*") || allowedCategories.length === 0) {
    return categories;
  }

  return categories.filter((cat) => {
    if (!cat || typeof cat.name !== "string") return false;
    return allowedCategories.includes(cat.name);
  });
}

/**
 * SSOSession representation and session management logic.
 * :visibility: public
 */
export class SSOSession {
  /**
   * @param {object} sessionData
   */
  constructor(sessionData = {}) {
    this.sessionId = sessionData.sessionId || "sess_" + (isNode && cryptoModule ? cryptoModule.randomBytes(16).toString("hex") : Date.now());
    this.userId = sessionData.userId || "";
    this.email = sessionData.email || "";
    this.displayName = sessionData.displayName || "";
    this.provider = sessionData.provider || "azuread";
    this.protocol = sessionData.protocol || "oidc";
    this.ssoGroups = Array.isArray(sessionData.ssoGroups) ? sessionData.ssoGroups : [];
    this.roles = Array.isArray(sessionData.roles) ? sessionData.roles : [];
    this.allowedCategories = Array.isArray(sessionData.allowedCategories) ? sessionData.allowedCategories : [];
    this.accessToken = sessionData.accessToken || "";
    this.refreshToken = sessionData.refreshToken || "";
    this.idToken = sessionData.idToken || "";
    this.createdAt = sessionData.createdAt || new Date().toISOString();
    this.lastActiveAt = sessionData.lastActiveAt || new Date().toISOString();
    this.expiresAt = sessionData.expiresAt || new Date(Date.now() + 8 * 3600 * 1000).toISOString();
    this.status = sessionData.status || "active";
  }

  /**
   * Validates session status, expiry, and idle timeout.
   * @param {number} [sessionTimeoutMinutes=480]
   * @param {number} [idleTimeoutMinutes=120]
   * @returns {{valid: boolean, reason?: string}}
   */
  validate(sessionTimeoutMinutes = 480, idleTimeoutMinutes = 120) {
    if (this.status !== "active") {
      return { valid: false, reason: `Session status is '${this.status}'` };
    }

    const now = Date.now();
    const expiryTime = new Date(this.expiresAt).getTime();
    if (now >= expiryTime) {
      this.status = "expired";
      return { valid: false, reason: "Session has expired" };
    }

    const lastActiveTime = new Date(this.lastActiveAt).getTime();
    const idleTimeoutMs = idleTimeoutMinutes * 60 * 1000;
    if (now - lastActiveTime > idleTimeoutMs) {
      this.status = "expired";
      return { valid: false, reason: "Session idle timeout exceeded" };
    }

    return { valid: true };
  }

  /**
   * Touches activity timestamp to prevent idle timeout.
   */
  touch() {
    this.lastActiveAt = new Date().toISOString();
  }

  /**
   * Refreshes session tokens and extends expiration time.
   * @param {object} newTokens
   * @param {number} [extensionMinutes=480]
   */
  refresh(newTokens = {}, extensionMinutes = 480) {
    if (newTokens.accessToken) this.accessToken = newTokens.accessToken;
    if (newTokens.refreshToken) this.refreshToken = newTokens.refreshToken;
    if (newTokens.idToken) this.idToken = newTokens.idToken;

    this.lastActiveAt = new Date().toISOString();
    this.expiresAt = new Date(Date.now() + extensionMinutes * 60 * 1000).toISOString();
    this.status = "active";
  }

  /**
   * Revokes / logs out current session.
   */
  revoke() {
    this.status = "revoked";
  }
}

/**
 * Creates a new SSO Session from authenticated user and token claims.
 * @param {object} user User profile
 * @param {object} tokens Auth tokens
 * @param {object} permissions Mapped roles and categories
 * @param {object} [options]
 * @returns {SSOSession}
 * :visibility: public
 */
export function createSSOSession(user, tokens = {}, permissions = {}, options = {}) {
  const timeoutMins = options.sessionTimeoutMinutes || 480;
  const session = new SSOSession({
    userId: user.id || user.email,
    email: user.email,
    displayName: user.name || user.email,
    provider: options.provider || "azuread",
    protocol: options.protocol || "oidc",
    ssoGroups: user.groups || [],
    roles: permissions.roles || [],
    allowedCategories: permissions.allowedCategories || [],
    accessToken: tokens.accessToken || tokens.access_token || "",
    refreshToken: tokens.refreshToken || tokens.refresh_token || "",
    idToken: tokens.idToken || tokens.id_token || "",
    expiresAt: new Date(Date.now() + timeoutMins * 60 * 1000).toISOString(),
    status: "active",
  });

  return session;
}
