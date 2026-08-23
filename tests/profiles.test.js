import {
  getProfiles,
  getActiveProfileName,
  getProfileEnv,
  isCommandVisibleInProfile,
  getMergedEnvironment,
} from "../extension/commandProcessor.js";

describe("Environment Variable Profiles", () => {
  const sampleConfig = {
    active_profile: "Staging",
    profiles: [
      {
        name: "Production",
        env: {
          API_URL: "https://api.prod.com",
          LOG_LEVEL: "warn",
        },
      },
      {
        name: "Staging",
        env: {
          API_URL: "https://api.staging.com",
          LOG_LEVEL: "info",
        },
      },
      {
        name: "Development",
        env: {
          API_URL: "http://localhost:3000",
          LOG_LEVEL: "debug",
        },
      },
    ],
  };

  test("getProfiles parses profile array and object formats correctly", () => {
    const listProfiles = getProfiles(sampleConfig);
    expect(listProfiles).toHaveLength(3);
    expect(listProfiles[0].name).toBe("Production");
    expect(listProfiles[0].env.API_URL).toBe("https://api.prod.com");

    const objectConfig = {
      profiles: {
        Production: { env: { API_URL: "https://api.prod.com" } },
        Development: { env: { API_URL: "http://localhost:3000" } },
      },
    };
    const mapProfiles = getProfiles(objectConfig);
    expect(mapProfiles).toHaveLength(2);
    expect(mapProfiles[1].name).toBe("Development");
    expect(mapProfiles[1].env.API_URL).toBe("http://localhost:3000");
  });

  test("getActiveProfileName returns active profile name or falls back to first profile", () => {
    expect(getActiveProfileName(sampleConfig)).toBe("Staging");

    const noActiveConfig = {
      profiles: [{ name: "Development", env: {} }, { name: "Production", env: {} }],
    };
    expect(getActiveProfileName(noActiveConfig)).toBe("Development");

    expect(getActiveProfileName({})).toBeNull();
  });

  test("getProfileEnv retrieves environment variables for active or specified profile", () => {
    const activeEnv = getProfileEnv(sampleConfig);
    expect(activeEnv.API_URL).toBe("https://api.staging.com");

    const prodEnv = getProfileEnv(sampleConfig, "Production");
    expect(prodEnv.API_URL).toBe("https://api.prod.com");
    expect(prodEnv.LOG_LEVEL).toBe("warn");

    const emptyEnv = getProfileEnv(sampleConfig, "NonExistent");
    expect(emptyEnv).toEqual({});
  });

  test("isCommandVisibleInProfile checks command visibility per active profile", () => {
    const cmdAll = { name: "Ping", command: "ping host" };
    const cmdDev = { name: "Dev Tool", command: "dev-run", profiles: ["Development"] };
    const cmdStagingProd = { name: "Deploy", command: "deploy", profiles: ["Staging", "Production"] };
    const cmdSingleString = { name: "Prod Only", command: "prod-db", profile: "Production" };

    expect(isCommandVisibleInProfile(cmdAll, "Development")).toBe(true);
    expect(isCommandVisibleInProfile(cmdAll, "Production")).toBe(true);

    expect(isCommandVisibleInProfile(cmdDev, "Development")).toBe(true);
    expect(isCommandVisibleInProfile(cmdDev, "Staging")).toBe(false);

    expect(isCommandVisibleInProfile(cmdStagingProd, "Staging")).toBe(true);
    expect(isCommandVisibleInProfile(cmdStagingProd, "Production")).toBe(true);
    expect(isCommandVisibleInProfile(cmdStagingProd, "Development")).toBe(false);

    expect(isCommandVisibleInProfile(cmdSingleString, "Production")).toBe(true);
    expect(isCommandVisibleInProfile(cmdSingleString, "Development")).toBe(false);
  });

  test("getMergedEnvironment overlays profile variables onto base environment", () => {
    const baseEnv = {
      PATH: "/usr/bin:/bin",
      USER: "developer",
      LOG_LEVEL: "error",
    };

    const merged = getMergedEnvironment(baseEnv, sampleConfig, "Production");
    expect(merged.PATH).toBe("/usr/bin:/bin");
    expect(merged.USER).toBe("developer");
    expect(merged.API_URL).toBe("https://api.prod.com");
    expect(merged.LOG_LEVEL).toBe("warn"); // overridden by profile
  });
});
