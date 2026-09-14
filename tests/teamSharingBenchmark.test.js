import fs from "fs";
import path from "path";
import os from "os";
import { performance } from "perf_hooks";
import {
  exportCommandToUrl,
  parseShareUrl,
  ConfigVersionControl,
  ActivityFeedManager,
} from "../extension/teamSharing.js";

describe("Team Command Sharing Performance Benchmarks", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmdbar-benchmark-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("Benchmark: URL Export and Import operations must complete in < 10 ms", () => {
    const cmd = {
      name: "Complex Enterprise Deployment Command",
      command: "helm upgrade --install {{release}} {{chart}} --namespace {{namespace}} --set image.tag={{tag}}",
      placeholder: "release & chart & namespace & tag",
      category: "Helm Operations",
    };

    const start = performance.now();

    const url = exportCommandToUrl(cmd, { author: "benchmark_user" });
    const parsed = parseShareUrl(url);

    const elapsed = performance.now() - start;

    expect(parsed.data.name).toBe("Complex Enterprise Deployment Command");
    expect(elapsed).toBeLessThan(10); // Target < 10 ms
  });

  test("Benchmark: Version diff calculation across large configs must complete in < 15 ms", async () => {
    const vc = new ConfigVersionControl(path.join(tempDir, "history.json"));

    const makeLargeConfig = (count, suffix = "") => {
      const commands = [];
      for (let i = 0; i < count; i++) {
        commands.push({
          name: `Command_${i}`,
          command: `echo "executing command ${i} ${suffix}"`,
        });
      }
      return {
        categories: [{ name: "Bulk Category", commands }],
      };
    };

    const configV1 = makeLargeConfig(200, "v1");
    const rev1 = await vc.recordRevision(configV1, "user1", "V1 bulk");

    const configV2 = makeLargeConfig(200, "v2");
    configV2.categories[0].commands.push({ name: "New_Cmd", command: "echo new" });
    const rev2 = await vc.recordRevision(configV2, "user2", "V2 bulk");

    const start = performance.now();
    const diff = await vc.diffRevisions(rev1.revisionId, rev2.revisionId);
    const elapsed = performance.now() - start;

    expect(diff.added.length).toBe(1);
    expect(elapsed).toBeLessThan(15); // Target < 15 ms
  });

  test("Benchmark: Querying activity feed with 1,000 entries must complete in < 20 ms", async () => {
    const feed = new ActivityFeedManager(path.join(tempDir, "activity.json"));

    // Populate 1,000 entries
    for (let i = 0; i < 1000; i++) {
      await feed.logActivity(
        i % 2 === 0 ? "COMMAND_SHARED" : "PROPOSAL_SUBMITTED",
        `user_${i % 10}`,
        { index: i },
        i % 2 === 0 ? "ops" : "dev"
      );
    }

    const start = performance.now();
    const results = await feed.getActivityFeed({
      actor: "user_2",
      repositoryId: "ops",
      limit: 50,
    });
    const elapsed = performance.now() - start;

    expect(results.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(20); // Target < 20 ms
  });
});
