import {
  evaluateSensorRule,
  checkCooldown,
  parseWebhookPayload,
  formatMqttTopic,
  buildHomeAssistantConfig,
  IoTTriggerProcessor,
  evaluateCondition,
  processMQTTTopicAndPayload,
  validateWebhookAuth,
  processWebhookRequest,
  processHomeAutomationEvent,
  evaluateSensorRules,
  IoTTriggerManager,
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

describe("IoT Trigger Module", () => {
  const sampleConfig = {
    iot: {
      webhook_secret: "js_secret_abc123",
      sensor_rules: [
        {
          sensor_id: "temp_sensor_01",
          metric: "temperature",
          operator: ">",
          threshold: 25.0,
          command_name: "High Temperature Warning",
          parameters: {},
          cooldown_seconds: 5,
        },
      ],
    },
  };

  test("evaluateCondition supports all comparison operators", () => {
    assertCondition(evaluateCondition(30, ">", 20), true);
    assertCondition(evaluateCondition(20, ">=", 20), true);
    assertCondition(evaluateCondition(15, "<", 20), true);
    assertCondition(evaluateCondition(20, "<=", 20), true);
    assertCondition(evaluateCondition("ON", "==", "on"), true);
    assertCondition(evaluateCondition("OFF", "!=", "on"), true);
    assertCondition(evaluateCondition("critical_alarm", "contains", "alarm"), true);
    assertCondition(evaluateCondition(15, "between", [10, 20]), true);
    assertCondition(evaluateCondition(25, "between", [10, 20]), false);
  });

  test("processMQTTTopicAndPayload processes direct trigger topics", () => {
    const res = processMQTTTopicAndPayload(
      "cmdbar/trigger/Toggle Smart Plug",
      JSON.stringify({ parameters: { state: "on" } }),
      sampleConfig
    );
    expect(res.success).toBe(true);
    expect(res.action).toBe("execute_command");
    expect(res.commandName).toBe("Toggle Smart Plug");
    expect(res.parameters).toEqual({ state: "on" });
  });

  test("processMQTTTopicAndPayload processes sensor telemetry topics", () => {
    const res = processMQTTTopicAndPayload(
      "cmdbar/sensors/temp_sensor_01",
      JSON.stringify({ temperature: 29.5 }),
      sampleConfig
    );
    expect(res.success).toBe(true);
    expect(res.action).toBe("sensor_telemetry");
    expect(res.triggeredRules.length).toBe(1);
    expect(res.triggeredRules[0].commandName).toBe("High Temperature Warning");
  });

  test("validateWebhookAuth handles secret and bearer tokens", () => {
    expect(validateWebhookAuth({ "X-CmdBar-Secret": "js_secret_abc123" }, "js_secret_abc123")).toBe(true);
    expect(validateWebhookAuth({ authorization: "Bearer js_secret_abc123" }, "js_secret_abc123")).toBe(true);
    expect(validateWebhookAuth({ "X-CmdBar-Secret": "wrong_secret" }, "js_secret_abc123")).toBe(false);
  });

  test("processWebhookRequest rejects unauthorized requests", () => {
    const res = processWebhookRequest(
      "/trigger/Toggle%20Plug",
      { "X-CmdBar-Secret": "bad_key" },
      { parameters: { plug: "1" } },
      sampleConfig
    );
    expect(res.success).toBe(false);
    expect(res.code).toBe(401);
  });

  test("processWebhookRequest accepts authorized requests", () => {
    const res = processWebhookRequest(
      "/trigger/Toggle%20Plug",
      { "X-CmdBar-Secret": "js_secret_abc123" },
      { parameters: { plug: "1" } },
      sampleConfig
    );
    expect(res.success).toBe(true);
    expect(res.action).toBe("execute_command");
    expect(res.commandName).toBe("Toggle Plug");
  });

  test("processHomeAutomationEvent handles HA action triggers", () => {
    const haPayload = {
      action: "trigger_cmdbar",
      command: "Activate Night Mode",
      parameters: { mode: "dark" },
    };
    const res = processHomeAutomationEvent(haPayload, sampleConfig);
    expect(res.success).toBe(true);
    expect(res.commandName).toBe("Activate Night Mode");
  });

  test("evaluateSensorRules respects cooldown deduplication", () => {
    const rules = [
      {
        sensor_id: "door_front",
        metric: "state",
        operator: "==",
        threshold: "open",
        command_name: "Front Door Opened",
        cooldown_seconds: 10,
      },
    ];
    const lastTimes = new Map();

    const tr1 = evaluateSensorRules(rules, "door_front", { state: "open" }, lastTimes);
    expect(tr1.length).toBe(1);

    // Second call immediately within cooldown window should be empty
    const tr2 = evaluateSensorRules(rules, "door_front", { state: "open" }, lastTimes);
    expect(tr2.length).toBe(0);
  });

  test("IoTTriggerManager class integrates all IoT handles", () => {
    const manager = new IoTTriggerManager(sampleConfig);
    manager.updateConfig(sampleConfig);

    const mqttRes = manager.handleMQTT("cmdbar/trigger/Restart Service", { parameters: { name: "nginx" } });
    expect(mqttRes.success).toBe(true);
    expect(mqttRes.commandName).toBe("Restart Service");

    const hookRes = manager.handleWebhook("/sensor", { "X-CmdBar-Secret": "js_secret_abc123" }, { sensor_id: "temp_sensor_01", telemetry: { temperature: 31 } });
    expect(hookRes.success).toBe(true);
    expect(hookRes.action).toBe("sensor_telemetry");

    const haRes = manager.handleHomeAssistant({ entity_id: "temp_sensor_01", state: "32" });
    expect(haRes.success).toBe(true);
    expect(haRes.action).toBe("home_assistant_entity_update");

    const telemRes = manager.handleSensorTelemetry("temp_sensor_01", { temperature: 33 });
    expect(Array.isArray(telemRes)).toBe(true);
  });
});

function assertCondition(actual, expected) {
  expect(actual).toBe(expected);
}
