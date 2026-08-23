import {
  evaluateSensorRule,
  checkCooldown,
  parseWebhookPayload,
  formatMqttTopic,
  buildHomeAssistantConfig,
  IoTTriggerProcessor,
} from "../extension/iotTrigger.js";

describe("IoT Trigger Module Unit Tests", () => {
  test("evaluateSensorRule correctly evaluates numeric condition operators", () => {
    const ruleHigh = { operator: ">", value: 30 };
    expect(evaluateSensorRule(ruleHigh, 35)).toBe(true);
    expect(evaluateSensorRule(ruleHigh, 25)).toBe(false);

    const ruleGte = { operator: ">=", value: 30 };
    expect(evaluateSensorRule(ruleGte, 30)).toBe(true);

    const ruleLow = { operator: "<", value: 10 };
    expect(evaluateSensorRule(ruleLow, 5)).toBe(true);
    expect(evaluateSensorRule(ruleLow, 15)).toBe(false);

    const ruleEq = { operator: "==", value: "active" };
    expect(evaluateSensorRule(ruleEq, "active")).toBe(true);
    expect(evaluateSensorRule(ruleEq, "inactive")).toBe(false);

    const ruleContains = { operator: "contains", value: "ERROR" };
    expect(
      evaluateSensorRule(ruleContains, "System alert: ERROR detected"),
    ).toBe(true);
    expect(evaluateSensorRule(ruleContains, "System normal")).toBe(false);
  });

  test("checkCooldown enforces debouncing periods", () => {
    const map = new Map();
    const ruleId = "temp_rule";

    expect(checkCooldown(ruleId, 5, map)).toBe(false);

    map.set(ruleId, Date.now() / 1000);
    expect(checkCooldown(ruleId, 5, map)).toBe(true);
  });

  test("parseWebhookPayload validates incoming JSON payloads", () => {
    const validStr = JSON.stringify({
      command: "Ping Host",
      args: { host: "127.0.0.1" },
    });
    const parsed = parseWebhookPayload(validStr);

    expect(parsed.valid).toBe(true);
    expect(parsed.command).toBe("Ping Host");
    expect(parsed.args.host).toBe("127.0.0.1");

    const invalidJson = "invalid json {";
    const errParsed = parseWebhookPayload(invalidJson);
    expect(errParsed.valid).toBe(false);
  });

  test("formatMqttTopic builds standardized topics", () => {
    expect(formatMqttTopic("cmdbar", "trigger", "Ping Host")).toBe(
      "cmdbar/trigger/Ping Host",
    );
    expect(formatMqttTopic("cmdbar", "status")).toBe("cmdbar/status");
  });

  test("buildHomeAssistantConfig creates Home Assistant Discovery payloads", () => {
    const { discoveryTopic, payload } = buildHomeAssistantConfig(
      "Deploy Staging",
      "cmdbar",
    );

    expect(discoveryTopic).toBe(
      "homeassistant/button/cmdbar_deploy_staging/config",
    );
    expect(payload.name).toBe("CmdBar Deploy Staging");
    expect(payload.unique_id).toBe("cmdbar_btn_deploy_staging");
    expect(payload.command_topic).toBe("cmdbar/trigger/Deploy Staging");
  });

  test("IoTTriggerProcessor processes sensor readings and handles debouncing", () => {
    const rules = [
      {
        id: "rule_1",
        sensor_name: "temp",
        operator: ">",
        value: 30,
        command: "Fan On",
        cooldown_seconds: 10,
      },
    ];

    const processor = new IoTTriggerProcessor(rules);

    const firstResult = processor.processSensorReading("temp", 35);
    expect(firstResult.length).toBe(1);
    expect(firstResult[0].command).toBe("Fan On");

    // Subsequent reading during cooldown should return empty
    const secondResult = processor.processSensorReading("temp", 36);
    expect(secondResult.length).toBe(0);
  });
});
