import { describe, test, expect } from "@jest/globals";
import {
  parseAndValidateJWT,
  parseAndValidateSAMLResponse,
  mapGroupsToPermissions,
  base64Encode,
  SSOSession,
} from "../extension/ssoManager.js";

describe("SSO Performance Benchmarks", () => {
  test("High throughput validation benchmark: 1000 JWT ID token & SAML assertions processed in sub-millisecond per-op latency", () => {
    const iterations = 1000;
    const nowSec = Math.floor(Date.now() / 1000);

    // Prepare mock JWT
    const header = { alg: "RS256", typ: "JWT" };
    const payload = {
      iss: "https://login.microsoftonline.com/tenant/v2.0",
      aud: "cmdbar-app",
      sub: "usr_bench_1",
      exp: nowSec + 3600,
      email: "bench@enterprise.com",
      groups: ["Engineers", "DevOps"],
    };
    const mockJwt = `${base64Encode(JSON.stringify(header), true)}.${base64Encode(JSON.stringify(payload), true)}.sig`;

    // Prepare mock SAML XML
    const futureDate = new Date(Date.now() + 3600000).toISOString();
    const mockSamlXml = `<?xml version="1.0"?>
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
  <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
  <saml:Issuer>https://idp.okta.com</saml:Issuer>
  <saml:Assertion>
    <saml:Subject>
      <saml:NameID>bench@enterprise.com</saml:NameID>
    </saml:Subject>
    <saml:Conditions NotOnOrAfter="${futureDate}"/>
    <saml:AttributeStatement>
      <saml:Attribute Name="groups">
        <saml:AttributeValue>CmdBar-Admins</saml:AttributeValue>
      </saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>`;

    const groupMappings = [
      { sso_group: "CmdBar-Admins", role: "admin", allowed_categories: ["*"] },
      { sso_group: "Engineers", role: "developer", allowed_categories: ["Projects"] },
    ];

    const session = new SSOSession({
      userId: "usr_bench_1",
      email: "bench@enterprise.com",
      ssoGroups: ["Engineers"],
      roles: ["developer"],
      allowedCategories: ["Projects"],
      status: "active",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });

    const startTime = Date.now();

    for (let i = 0; i < iterations; i++) {
      // 1. JWT validation
      parseAndValidateJWT(mockJwt, {
        expectedIssuer: "https://login.microsoftonline.com/tenant/v2.0",
        expectedAudience: "cmdbar-app",
      });

      // 2. SAML validation
      parseAndValidateSAMLResponse(mockSamlXml, {
        expectedIssuer: "https://idp.okta.com",
      });

      // 3. Group Mapping
      mapGroupsToPermissions(["Engineers", "DevOps"], groupMappings);

      // 4. Session Validation
      session.validate();
    }

    const durationMs = Date.now() - startTime;
    const avgLatencyMs = durationMs / iterations;

    // Assert overall performance meets enterprise standards (<2ms total per iteration across all 4 steps)
    expect(avgLatencyMs).toBeLessThan(2.0);
  });
});
