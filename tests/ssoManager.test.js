import {
  PKCEUtil,
  SAMLHandler,
  OIDCHandler,
  JITProvisioner,
  GroupMapper,
  SSOSessionManager,
  SSOManager,
  PROVIDER_PRESETS,
} from "../extension/ssoManager.js";
import { CmdBarDBusService } from "../extension/dbusService.js";

describe("CmdBar Enterprise SSO Integration", () => {
  test("PKCEUtil should generate valid code verifiers and challenges", async () => {
    const verifier = PKCEUtil.generateCodeVerifier(64);
    expect(verifier).toHaveLength(64);

    const challenge = await PKCEUtil.generateCodeChallenge(verifier);
    expect(challenge.length).toBeGreaterThan(10);
    expect(challenge).not.toContain("=");
  });

  test("PROVIDER_PRESETS contains configurations for Azure AD, Okta, and Google", () => {
    expect(PROVIDER_PRESETS).toHaveProperty("azure");
    expect(PROVIDER_PRESETS).toHaveProperty("okta");
    expect(PROVIDER_PRESETS).toHaveProperty("google");

    expect(PROVIDER_PRESETS.azure.name).toBe("Azure Active Directory");
    expect(PROVIDER_PRESETS.okta.name).toBe("Okta Workforce Identity");
    expect(PROVIDER_PRESETS.google.name).toBe("Google Workspace SSO");
  });

  test("SAMLHandler generates SP metadata and AuthnRequest XML", () => {
    const saml = new SAMLHandler("https://sp.cmdbar.org", "http://localhost:8080/acs");
    const metadata = saml.generateSpMetadata();
    expect(metadata).toContain("<md:EntityDescriptor");
    expect(metadata).toContain("https://sp.cmdbar.org");

    const authn = saml.generateAuthnRequest("https://idp.example.com/sso", "relay_123");
    expect(authn.samlRequestB64).toBeDefined();
    expect(authn.relayState).toBe("relay_123");
  });

  test("SAMLHandler parses SAMLResponse XML", () => {
    const saml = new SAMLHandler();
    const mockXml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
      <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
      <saml:Assertion>
        <saml:Issuer>https://idp.example.com</saml:Issuer>
        <saml:Subject><saml:NameID>saml_user@company.com</saml:NameID></saml:Subject>
        <saml:AttributeStatement>
          <saml:Attribute Name="email"><saml:AttributeValue>saml_user@company.com</saml:AttributeValue></saml:Attribute>
          <saml:Attribute Name="groups">
            <saml:AttributeValue>Admins</saml:AttributeValue>
            <saml:AttributeValue>Developers</saml:AttributeValue>
          </saml:Attribute>
        </saml:AttributeStatement>
      </saml:Assertion>
    </samlp:Response>`;

    const samlB64 = Buffer.from(mockXml).toString("base64");
    const parsed = saml.parseSamlResponse(samlB64);

    expect(parsed.success).toBe(true);
    expect(parsed.email).toBe("saml_user@company.com");
    expect(parsed.groups).toContain("Admins");
    expect(parsed.groups).toContain("Developers");
  });

  test("OIDCHandler generates auth URL and decodes JWT tokens", async () => {
    const providerConfig = {
      client_id: "client_abc",
      authorization_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      redirect_uri: "http://localhost:8080/callback",
      scope: "openid profile email",
    };

    const authData = await OIDCHandler.generateAuthorizationUrl(providerConfig);
    expect(authData.url).toContain("client_id=client_abc");
    expect(authData.url).toContain("code_challenge=");

    // Mock JWT decoding
    const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
    const payload = Buffer.from(
      JSON.stringify({
        sub: "user_123",
        email: "oidc_user@company.com",
        aud: "client_abc",
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString("base64");
    const jwt = `${header}.${payload}.sig`;

    const claims = OIDCHandler.decodeJwtUnverified(jwt);
    expect(claims.email).toBe("oidc_user@company.com");

    const verified = OIDCHandler.verifyIdTokenClaims(jwt, "client_abc");
    expect(verified.valid).toBe(true);
    expect(verified.claims.sub).toBe("user_123");
  });

  test("JITProvisioner provisions users for allowed domains", () => {
    const jit = new JITProvisioner({
      auto_provision: true,
      allowed_domains: ["company.com"],
      default_role: "user",
    });

    expect(jit.isDomainAllowed("alice@company.com")).toBe(true);
    expect(jit.isDomainAllowed("hacker@bad.com")).toBe(false);

    const res = jit.provisionUser({
      email: "alice@company.com",
      name: "Alice",
      groups: ["Engineers"],
    });

    expect(res.success).toBe(true);
    expect(res.profile.email).toBe("alice@company.com");
    expect(res.profile.groups).toContain("Engineers");

    const rejected = jit.provisionUser({ email: "hacker@bad.com" });
    expect(rejected.success).toBe(false);
  });

  test("GroupMapper evaluates role mapping rules", () => {
    const rules = [
      {
        id: "r1",
        group_pattern: "Admins",
        match_type: "contains",
        role: "admin",
        categories: ["Infrastructure", "System Utilities"],
      },
      {
        id: "r2",
        group_pattern: "Devs",
        match_type: "contains",
        role: "developer",
        categories: ["Projects"],
      },
    ];

    const mapper = new GroupMapper(rules);
    const evalRes = mapper.evaluate(["Azure-Admins", "Devs"]);

    expect(evalRes.role).toBe("admin");
    expect(evalRes.assignedCategories).toContain("Infrastructure");
    expect(evalRes.assignedCategories).toContain("Projects");
  });

  test("SSOSessionManager manages active sessions and TTL", () => {
    const sessMgr = new SSOSessionManager(3600);
    const userProfile = { user_id: "u1", email: "user@company.com", name: "User" };

    const session = sessMgr.createSession(userProfile, "admin", ["Projects"], "azure");
    expect(session.session_id).toBeDefined();

    const val = sessMgr.validateSession(session.session_id);
    expect(val.valid).toBe(true);
    expect(val.session.email).toBe("user@company.com");

    sessMgr.revokeSession(session.session_id);
    expect(sessMgr.validateSession(session.session_id).valid).toBe(false);
  });

  test("SSOManager and DBusService SSO methods integration", async () => {
    const config = {
      allowed_domains: ["company.com"],
      group_mappings: [
        {
          id: "r1",
          group_pattern: "Admins",
          match_type: "contains",
          role: "admin",
          categories: ["Infrastructure"],
        },
      ],
    };

    const ssoMgr = new SSOManager(config);
    const loginRes = ssoMgr.loginOidcClaims("azure", {
      email: "admin@company.com",
      name: "Admin",
      groups: ["Admins"],
    });

    expect(loginRes.success).toBe(true);
    const sessionId = loginRes.session.session_id;

    expect(ssoMgr.validateCategoryAccess(sessionId, "Infrastructure")).toBe(true);

    const dbus = new CmdBarDBusService();
    dbus._ssoManager = ssoMgr;

    const providers = await dbus.GetSSOProviders();
    expect(providers).toContain("Azure Active Directory");

    const sessionStr = await dbus.GetSSOSession(sessionId);
    expect(sessionStr).toContain("admin@company.com");

    const hasAccess = await dbus.ValidateSSOAccess(sessionId, "Infrastructure");
    expect(hasAccess).toBe(true);

    const logoutOk = await dbus.SSOLogout(sessionId);
    expect(logoutOk).toBe(true);
  });
});
