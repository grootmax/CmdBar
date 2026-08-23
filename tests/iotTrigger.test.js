import {
  evaluateCondition,
  processMQTTTopicAndPayload,
  validateWebhookAuth,
  processWebhookRequest,
  processHomeAutomationEvent,
  evaluateSensorRules,
  IoTTriggerManager,
} from "../extension/iotTrigger.js";

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
