import { describe, test, expect } from "@jest/globals";
import {
  SSO_PROVIDER_PRESETS,
  base64Encode,
  generatePKCE,
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

describe("SSO Integration - End-to-End Flow & Contract Tests", () => {
  test("End-to-End OIDC Flow: Auth URL -> ID Token -> JIT Provisioning -> Group Mapping -> Session -> Category Filtering", () => {
    // 1. Setup Enterprise Config with Azure AD OIDC
    const ssoConfig = {
      enabled: true,
      default_provider: "azuread",
      tenant: "enterprise-tenant-123",
      client_id: "cmdbar-azure-client",
      session_timeout_minutes: 480,
      jit_provisioning: {
        enabled: true,
        default_role: "user",
        attribute_mapping: { email: "email", name: "name", groups: "groups" },
      },
      group_mappings: [
        { sso_group: "CmdBar-Admins", role: "admin", allowed_categories: ["*"] },
        { sso_group: "DevOps-Team", role: "devops", allowed_categories: ["Infrastructure", "ECS Tasks"] },
        { sso_group: "Engineers", role: "developer", allowed_categories: ["Projects", "System Utilities"] },
      ],
    };

    // 2. Step 1: Initiate Auth & PKCE
    const pkce = generatePKCE();
    const authUrl = generateOIDCAuthUrl(
      { preset: "azuread", tenant: ssoConfig.tenant, client_id: ssoConfig.client_id },
      pkce,
      "https://localhost/callback",
      "state_oidc_123"
    );
    expect(authUrl).toContain("enterprise-tenant-123");
    expect(authUrl).toContain("cmdbar-azure-client");

    // 3. Step 2: Simulate IdP Callback returning JWT ID Token
    const header = { alg: "RS256", typ: "JWT" };
    const nowSec = Math.floor(Date.now() / 1000);
    const idTokenPayload = {
      iss: `https://login.microsoftonline.com/${ssoConfig.tenant}/v2.0`,
      aud: ssoConfig.client_id,
      sub: "usr_azure_888",
      exp: nowSec + 3600,
      nbf: nowSec - 60,
      email: "sarah@enterprise.com",
      name: "Sarah Conner",
      groups: ["DevOps-Team"],
      nonce: "nonce_456",
    };
    const mockIdToken = `${base64Encode(JSON.stringify(header), true)}.${base64Encode(JSON.stringify(idTokenPayload), true)}.sig`;

    // 4. Step 3: Parse and Validate ID Token
    const validatedToken = parseAndValidateJWT(mockIdToken, {
      expectedIssuer: `https://login.microsoftonline.com/${ssoConfig.tenant}/v2.0`,
      expectedAudience: ssoConfig.client_id,
    });
    expect(validatedToken.payload.email).toBe("sarah@enterprise.com");

    // 5. Step 4: JIT Provisioning
    const userDb = {};
    const jitResult = provisionJITUser(validatedToken.payload, ssoConfig.jit_provisioning, userDb);
    expect(jitResult.isNew).toBe(true);
    expect(jitResult.user.email).toBe("sarah@enterprise.com");

    // 6. Step 5: Group Mapping
    const permissions = mapGroupsToPermissions(jitResult.user.groups, ssoConfig.group_mappings);
    expect(permissions.roles).toContain("devops");
    expect(permissions.allowedCategories).toEqual(["Infrastructure", "ECS Tasks"]);

    // 7. Step 6: Create Session
    const session = createSSOSession(
      jitResult.user,
      { accessToken: "at_sarah_123", idToken: mockIdToken },
      permissions,
      { provider: "azuread", sessionTimeoutMinutes: ssoConfig.session_timeout_minutes }
    );
    expect(session.status).toBe("active");
    expect(session.validate().valid).toBe(true);

    // 8. Step 7: Filter Categories for Active Session
    const allCategories = [
      { name: "Projects", commands: [{ name: "Build", command: "make" }] },
      { name: "Infrastructure", commands: [{ name: "Deploy", command: "deploy" }] },
      { name: "ECS Tasks", commands: [{ name: "Scale", command: "scale" }] },
      { name: "Super Admin", commands: [{ name: "Wipe", command: "wipe" }] },
    ];
    const userCategories = filterCategoriesForUser(allCategories, session.allowedCategories);
    expect(userCategories.map((c) => c.name)).toEqual(["Infrastructure", "ECS Tasks"]);
  });

  test("End-to-End SAML 2.0 Flow: SAML Request -> Assertion Parsing -> JIT -> Group Mapping -> Session -> Logout", () => {
    // 1. Setup Okta SAML Config
    const samlConfig = {
      entity_id: "https://cmdbar.sp.com",
      sso_url: "https://enterprise.okta.com/app/sso/saml",
      expectedIssuer: "https://enterprise.okta.com",
      expectedAudience: "https://cmdbar.sp.com",
      group_mappings: [
        { sso_group: "Okta-Admins", role: "admin", allowed_categories: ["*"] },
      ],
    };

    // 2. Step 1: Create SAML Request
    const req = createSAMLRequest(samlConfig);
    expect(req.base64).toBeDefined();

    // 3. Step 2: Simulate SAML Response XML from IdP
    const futureDate = new Date(Date.now() + 3600000).toISOString();
    const responseXml = `<?xml version="1.0"?>
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
  <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
  <saml:Issuer>https://enterprise.okta.com</saml:Issuer>
  <saml:Assertion>
    <saml:Subject>
      <saml:NameID>admin@enterprise.com</saml:NameID>
    </saml:Subject>
    <saml:Conditions NotOnOrAfter="${futureDate}">
      <saml:AudienceRestriction>
        <saml:Audience>https://cmdbar.sp.com</saml:Audience>
      </saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AttributeStatement>
      <saml:Attribute Name="displayName">
        <saml:AttributeValue>System Administrator</saml:AttributeValue>
      </saml:Attribute>
      <saml:Attribute Name="groups">
        <saml:AttributeValue>Okta-Admins</saml:AttributeValue>
      </saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>`;

    // 4. Step 3: Parse and Validate SAML Response
    const samlClaims = parseAndValidateSAMLResponse(responseXml, samlConfig);
    expect(samlClaims.email).toBe("admin@enterprise.com");
    expect(samlClaims.groups).toEqual(["Okta-Admins"]);

    // 5. Step 4: JIT Provisioning & Group Mapping
    const userDb = {};
    const jitResult = provisionJITUser(samlClaims, { enabled: true }, userDb);
    const permissions = mapGroupsToPermissions(jitResult.user.groups, samlConfig.group_mappings);
    expect(permissions.allowedCategories).toContain("*");

    // 6. Step 5: Session Creation & Revocation
    const session = createSSOSession(jitResult.user, {}, permissions, { provider: "okta", protocol: "saml" });
    expect(session.status).toBe("active");

    session.revoke();
    expect(session.status).toBe("revoked");
    expect(session.validate().valid).toBe(false);
  });
});
