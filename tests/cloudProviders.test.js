import fs from "fs";
import path from "path";
import os from "os";

import {
  CLOUD_PROVIDERS,
  RESOURCE_TYPES,
  getMockResources,
  getAuthStatus,
  discoverResources,
  getCachedResources,
  setCachedResources,
  loadCloudCache,
  saveCloudCache,
  clearCloudCache,
  getCloudParameterOptions,
} from "../extension/cloudProviders.js";

describe("Cloud Services Integration JS Module Unit Tests", () => {
  let tempDir;
  let cachePath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmdbar-cloud-test-"));
    cachePath = path.join(tempDir, "cloud_cache.json");
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Cloud Providers and Resource Types Constants", () => {
    test("supports AWS, GCP, and Azure providers", () => {
      expect(CLOUD_PROVIDERS).toContain("aws");
      expect(CLOUD_PROVIDERS).toContain("gcp");
      expect(CLOUD_PROVIDERS).toContain("azure");
    });

    test("supports required resource types for each provider", () => {
      expect(RESOURCE_TYPES.aws).toEqual(
        expect.arrayContaining(["ec2", "s3", "lambda"]),
      );
      expect(RESOURCE_TYPES.gcp).toEqual(
        expect.arrayContaining(["gce", "cloud_run"]),
      );
      expect(RESOURCE_TYPES.azure).toEqual(
        expect.arrayContaining(["vm", "functions"]),
      );
    });
  });

  describe("Mock Resources Discovery", () => {
    test("returns mock EC2, S3, and Lambda resources for AWS", () => {
      const ec2 = getMockResources("aws", "ec2");
      expect(ec2.length).toBeGreaterThan(0);
      expect(ec2[0].type).toBe("ec2");
      expect(ec2[0].id).toMatch(/^i-/);

      const s3 = getMockResources("aws", "s3");
      expect(s3.length).toBeGreaterThan(0);
      expect(s3[0].type).toBe("s3");

      const lambdaFn = getMockResources("aws", "lambda");
      expect(lambdaFn.length).toBeGreaterThan(0);
      expect(lambdaFn[0].type).toBe("lambda");
    });

    test("returns mock GCE and Cloud Run resources for GCP", () => {
      const gce = getMockResources("gcp", "gce");
      expect(gce.length).toBeGreaterThan(0);
      expect(gce[0].type).toBe("gce");

      const cloudRun = getMockResources("gcp", "cloud_run");
      expect(cloudRun.length).toBeGreaterThan(0);
      expect(cloudRun[0].type).toBe("cloud_run");
    });

    test("returns mock VM and Functions resources for Azure", () => {
      const vms = getMockResources("azure", "vm");
      expect(vms.length).toBeGreaterThan(0);
      expect(vms[0].type).toBe("vm");

      const funcs = getMockResources("azure", "functions");
      expect(funcs.length).toBeGreaterThan(0);
      expect(funcs[0].type).toBe("functions");
    });
  });

  describe("Authentication & Credential Management", () => {
    test("evaluates AWS auth status with environment keys or profile", () => {
      const statusEnv = getAuthStatus("aws", {
        env: { AWS_ACCESS_KEY_ID: "key", AWS_SECRET_ACCESS_KEY: "secret" },
      });
      expect(statusEnv.authenticated).toBe(true);

      const statusProfile = getAuthStatus("aws", {
        profile: "dev-profile",
        hasProfileFile: true,
      });
      expect(statusProfile.authenticated).toBe(true);
    });

    test("evaluates GCP auth status with project and credentials", () => {
      const status = getAuthStatus("gcp", {
        env: { GOOGLE_APPLICATION_CREDENTIALS: "/path/to/key.json" },
      });
      expect(status.authenticated).toBe(true);
    });

    test("evaluates Azure auth status with subscription ID", () => {
      const status = getAuthStatus("azure", {
        env: { AZURE_SUBSCRIPTION_ID: "sub-1234" },
      });
      expect(status.authenticated).toBe(true);
    });
  });

  describe("Caching Layer Persistence and Expiration", () => {
    test("saves and loads cached cloud resources", () => {
      const sample = [
        { id: "i-test123", name: "test-node", status: "running" },
      ];
      setCachedResources("aws", "ec2", sample, cachePath);

      const loaded = getCachedResources("aws", "ec2", 300, cachePath);
      expect(loaded).toEqual(sample);
    });

    test("returns null when cached resources expire TTL", () => {
      const cache = {
        "aws:ec2": {
          timestamp: Date.now() - 1000000, // Old timestamp
          resources: [{ id: "i-old" }],
        },
      };
      saveCloudCache(cache, cachePath);

      const loaded = getCachedResources("aws", "ec2", 300, cachePath);
      expect(loaded).toBeNull();
    });

    test("clears cloud resource cache", () => {
      setCachedResources("aws", "s3", [{ id: "my-bucket" }], cachePath);
      clearCloudCache(cachePath);

      const loaded = getCachedResources("aws", "s3", 300, cachePath);
      expect(loaded).toBeNull();
    });
  });

  describe("Resource Discovery & Parameter Options Formatting", () => {
    test("discovers resources and populates cache", async () => {
      const resources = await discoverResources("aws", "ec2", {
        mock: true,
        cachePath,
      });
      expect(resources.length).toBeGreaterThan(0);

      const cached = getCachedResources("aws", "ec2", 300, cachePath);
      expect(cached).toEqual(resources);
    });

    test("throws error for unsupported provider or resource type", async () => {
      await expect(
        discoverResources("unknown", "ec2", { cachePath }),
      ).rejects.toThrow();
      await expect(
        discoverResources("aws", "unknown", { cachePath }),
      ).rejects.toThrow();
    });

    test("formats options for cloud parameter selection dialogs", async () => {
      const options = await getCloudParameterOptions("aws", "ec2", {
        mock: true,
        cachePath,
      });
      expect(options.length).toBeGreaterThan(0);
      expect(options[0]).toHaveProperty("label");
      expect(options[0]).toHaveProperty("value");
      expect(options[0].value).toMatch(/^i-/);
    });
  });
});
