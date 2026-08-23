import { describe, test, expect } from "@jest/globals";
import {
  SSO_PROVIDER_PRESETS,
  base64Encode,
  base64Decode,
  generatePKCE,
  resolveOIDCProviderConfig,
  generateOIDCAuthUrl,
  parseAndValidateJWT,
  createSAMLRequest,
  parseAndValidateSAMLResponse,
  provisionJITUser,
  mapGroupsToPermissions,
  filterCategoriesForUser,
  SSOSession,
  createSSOSession,
} from "../extension/ssoManager.js";

describe("SSO Manager - JS Unit Tests", () => {
  test("SSO Provider Presets contain correct default configurations for Azure AD, Okta, and Google", () => {
    expect(SSO_PROVIDER_PRESETS).toHaveProperty("azuread");
    expect(SSO_PROVIDER_PRESETS).toHaveProperty("okta");
    expect(SSO_PROVIDER_PRESETS).toHaveProperty("google");

    expect(SSO_PROVIDER_PRESETS.azuread.protocol).toBe("oidc");
    expect(SSO_PROVIDER_PRESETS.okta.protocol).toBe("oidc");
    expect(SSO_PROVIDER_PRESETS.google.protocol).toBe("oidc");
  });

  test("Base64 encode and decode helper functions handle standard and URL-safe strings", () => {
    const raw = "CmdBar Enterprise SSO Test 123!";
    const encodedStd = base64Encode(raw, false);
    expect(encodedStd).not.toContain("+"); // or b64
    expect(base64Decode(encodedStd, false)).toBe(raw);

    const encodedUrl = base64Encode(raw, true);
    expect(encodedUrl).not.toContain("=");
    expect(base64Decode(encodedUrl, true)).toBe(raw);
  });

  test("PKCE generator outputs valid code_verifier and code_challenge (S256)", () => {
    const pkce = generatePKCE();
    expect(pkce).toHaveProperty("code_verifier");
    expect(pkce).toHaveProperty("code_challenge");
    expect(pkce.code_challenge_method).toBe("S256");
    expect(pkce.code_verifier.length).toBeGreaterThanOrEqual(32);
    expect(pkce.code_challenge.length).toBeGreaterThan(0);
  });

  test("resolveOIDCProviderConfig substitutes tenant and domain placeholders", () => {
    const azureCfg = resolveOIDCProviderConfig({
      preset: "azuread",
      tenant: "contoso-tenant-id",
    });
    expect(azureCfg.issuer).toBe("https://login.microsoftonline.com/contoso-tenant-id/v2.0");
    expect(azureCfg.authorization_endpoint).toContain("contoso-tenant-id");

    const oktaCfg = resolveOIDCProviderConfig({
      preset: "okta",
      domain: "dev-12345",
    });
    expect(oktaCfg.issuer).toBe("https://dev-12345.okta.com");
    expect(oktaCfg.token_endpoint).toContain("dev-12345.okta.com");
  });

  test("generateOIDCAuthUrl constructs valid authorization URL with parameters", () => {
    const pkce = generatePKCE();
    const url = generateOIDCAuthUrl(
      {
        preset: "google",
        client_id: "google-client-id-999",
      },
      pkce,
      "https://localhost/callback",
      "custom-state-value"
    );

    expect(url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url).toContain("response_type=code");
    expect(url).toContain("client_id=google-client-id-999");
    expect(url).toContain("redirect_uri=https%3A%2F%2Flocalhost%2Fcallback");
    expect(url).toContain("state=custom-state-value");
    expect(url).toContain("code_challenge=");
  });

  test("parseAndValidateJWT decodes and validates valid JWT payload claims", () => {
    const header = { alg: "RS256", typ: "JWT" };
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      iss: "https://login.microsoftonline.com/tenant/v2.0",
      sub: "user-123",
      aud: "cmdbar-client-app",
      exp: nowSec + 3600,
      nbf: nowSec - 60,
      email: "alice@enterprise.com",
      name: "Alice Smith",
      groups: ["DevOps-Admin", "Engineers"],
      nonce: "nonce-123",
    };

    const jwtStr = `${base64Encode(JSON.stringify(header), true)}.${base64Encode(JSON.stringify(payload), true)}.mock_signature`;

    const decoded = parseAndValidateJWT(jwtStr, {
      expectedIssuer: "https://login.microsoftonline.com/tenant/v2.0",
      expectedAudience: "cmdbar-client-app",
      expectedNonce: "nonce-123",
    });

    expect(decoded.payload.email).toBe("alice@enterprise.com");
    expect(decoded.payload.groups).toEqual(["DevOps-Admin", "Engineers"]);
  });

  test("parseAndValidateJWT throws error on expired token or claim mismatch", () => {
    const header = { alg: "RS256" };
    const nowSec = Math.floor(Date.now() / 1000);

    // Expired JWT
    const expiredPayload = {
      iss: "https://issuer.com",
      aud: "app",
      exp: nowSec - 3600,
    };
    const expiredJwt = `${base64Encode(JSON.stringify(header), true)}.${base64Encode(JSON.stringify(expiredPayload), true)}.sig`;
    expect(() => parseAndValidateJWT(expiredJwt)).toThrow(/expired/);

    // Issuer mismatch
    const validPayload = {
      iss: "https://issuer.com",
      aud: "app",
      exp: nowSec + 3600,
    };
    const validJwt = `${base64Encode(JSON.stringify(header), true)}.${base64Encode(JSON.stringify(validPayload), true)}.sig`;
    expect(() =>
      parseAndValidateJWT(validJwt, { expectedIssuer: "https://other-issuer.com" })
    ).toThrow(/issuer mismatch/);
  });

  test("createSAMLRequest builds SAML 2.0 AuthnRequest XML and Base64 output", () => {
    const samlReq = createSAMLRequest({
      entity_id: "https://cmdbar.sp.com",
      sso_url: "https://idp.okta.com/app/sso/saml",
      acs_url: "https://cmdbar.sp.com/acs",
    });

    expect(samlReq.xml).toContain("<samlp:AuthnRequest");
    expect(samlReq.xml).toContain("Destination=\"https://idp.okta.com/app/sso/saml\"");
    expect(samlReq.xml).toContain("<saml:Issuer>https://cmdbar.sp.com</saml:Issuer>");
    expect(samlReq.base64.length).toBeGreaterThan(0);
  });

  test("parseAndValidateSAMLResponse extracts user attributes and groups from SAML response XML", () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString();
    const samlXml = `<?xml version="1.0"?>
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
  <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
  <saml:Issuer>https://idp.okta.com</saml:Issuer>
  <saml:Assertion>
    <saml:Subject>
      <saml:NameID>bob@enterprise.com</saml:NameID>
    </saml:Subject>
    <saml:Conditions NotOnOrAfter="${futureDate}">
      <saml:AudienceRestriction>
        <saml:Audience>https://cmdbar.sp.com</saml:Audience>
      </saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AttributeStatement>
      <saml:Attribute Name="displayName">
        <saml:AttributeValue>Bob Jones</saml:AttributeValue>
      </saml:Attribute>
      <saml:Attribute Name="groups">
        <saml:AttributeValue>CmdBar-Admins</saml:AttributeValue>
        <saml:AttributeValue>SRE-Team</saml:AttributeValue>
      </saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>`;

    const parsed = parseAndValidateSAMLResponse(samlXml, {
      expectedIssuer: "https://idp.okta.com",
      expectedAudience: "https://cmdbar.sp.com",
    });

    expect(parsed.email).toBe("bob@enterprise.com");
    expect(parsed.name).toBe("Bob Jones");
    expect(parsed.groups).toEqual(["CmdBar-Admins", "SRE-Team"]);
  });

  test("provisionJITUser creates new user profile and updates existing user on SSO login", () => {
    const existingUsersMap = {};
    const ssoClaims = {
      email: "carol@enterprise.com",
      name: "Carol White",
      groups: ["Engineers"],
    };

    // 1. New user provisioned
    const res1 = provisionJITUser(ssoClaims, { enabled: true, default_role: "developer" }, existingUsersMap);
    expect(res1.isNew).toBe(true);
    expect(res1.user.email).toBe("carol@enterprise.com");
    expect(res1.user.role).toBe("developer");
    expect(existingUsersMap["carol@enterprise.com"]).toBeDefined();

    // 2. Existing user login updated
    const res2 = provisionJITUser(ssoClaims, { enabled: true }, existingUsersMap);
    expect(res2.isNew).toBe(false);
    expect(res2.user.last_login_at).toBeDefined();

    // 3. JIT disabled throws error for unprovisioned user
    expect(() =>
      provisionJITUser({ email: "dave@enterprise.com" }, { enabled: false }, existingUsersMap)
    ).toThrow(/disabled/);
  });

  test("mapGroupsToPermissions evaluates group mappings and wildcards correctly", () => {
    const mappings = [
      { sso_group: "CmdBar-Admins", role: "admin", allowed_categories: ["*"] },
      { sso_group: "DevOps-Team", role: "devops", allowed_categories: ["Infrastructure", "ECS Tasks"] },
      { sso_group: "Engineers", role: "developer", allowed_categories: ["Projects"] },
    ];

    const result1 = mapGroupsToPermissions(["DevOps-Team"], mappings);
    expect(result1.roles).toContain("devops");
    expect(result1.allowedCategories).toEqual(["Infrastructure", "ECS Tasks"]);

    const result2 = mapGroupsToPermissions(["CmdBar-Admins"], mappings);
    expect(result2.roles).toContain("admin");
    expect(result2.allowedCategories).toContain("*");
  });

  test("filterCategoriesForUser restricts visible categories according to permissions", () => {
    const categories = [
      { name: "Projects", commands: [{ name: "Build", command: "make" }] },
      { name: "Infrastructure", commands: [{ name: "Deploy", command: "deploy" }] },
      { name: "Secret Ops", commands: [{ name: "Reset", command: "reset" }] },
    ];

    // Wildcard allowed
    expect(filterCategoriesForUser(categories, ["*"])).toEqual(categories);

    // Specific category allowed
    const filtered = filterCategoriesForUser(categories, ["Projects"]);
    expect(filtered.length).toBe(1);
    expect(filtered[0].name).toBe("Projects");
  });

  test("SSOSession and createSSOSession manage session lifecycle, validation, and touch/refresh/revoke", () => {
    const user = { id: "usr_1", email: "user@enterprise.com", name: "User One", groups: ["Engineers"] };
    const tokens = { accessToken: "acc_123", refreshToken: "ref_456" };
    const permissions = { roles: ["developer"], allowedCategories: ["Projects"] };

    const session = createSSOSession(user, tokens, permissions, {
      provider: "okta",
      protocol: "oidc",
      sessionTimeoutMinutes: 60,
    });

    expect(session.email).toBe("user@enterprise.com");
    expect(session.status).toBe("active");

    // Validation
    const val = session.validate(60, 30);
    expect(val.valid).toBe(true);

    // Touch
    session.touch();
    expect(session.lastActiveAt).toBeDefined();

    // Refresh
    session.refresh({ accessToken: "acc_new" }, 120);
    expect(session.accessToken).toBe("acc_new");

    // Revoke
    session.revoke();
    expect(session.status).toBe("revoked");
    expect(session.validate().valid).toBe(false);
  });
});
