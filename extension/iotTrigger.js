import { validateInput, substituteCommand } from "./commandProcessor.js";

/**
 * @public
 * Evaluates operator comparisons for sensor metrics against threshold values.
 */
export function evaluateCondition(val, operator, threshold) {
  if (val === undefined || val === null) return false;
  const op = (operator || "==").toLowerCase();
  
  try {
    if ([">", ">=", "<", "<="].includes(op)) {
      const numVal = Number(val);
      const numThresh = Number(threshold);
      if (isNaN(numVal) || isNaN(numThresh)) return false;
      if (op === ">") return numVal > numThresh;
      if (op === ">=") return numVal >= numThresh;
      if (op === "<") return numVal < numThresh;
      if (op === "<=") return numVal <= numThresh;
    }
    if (["==", "eq"].includes(op)) {
      return String(val).trim().toLowerCase() === String(threshold).trim().toLowerCase();
    }
    if (["!=", "ne"].includes(op)) {
      return String(val).trim().toLowerCase() !== String(threshold).trim().toLowerCase();
    }
    if (op === "contains") {
      return String(val).toLowerCase().includes(String(threshold).toLowerCase());
    }
    if (op === "between" && Array.isArray(threshold) && threshold.length === 2) {
      const numVal = Number(val);
      return numVal >= Number(threshold[0]) && numVal <= Number(threshold[1]);
    }
  } catch (e) {
    return false;
  }
  return false;
}

/**
 * @public
 * Processes incoming MQTT topics and payloads for direct command triggers or sensor telemetry.
 */
export function processMQTTTopicAndPayload(topic, payload, config = {}) {
  if (!topic || typeof topic !== "string") {
    return { success: false, error: "Invalid MQTT topic", code: 400 };
  }

  const cleanTopic = topic.trim();
  let data = {};
  if (typeof payload === "string" && payload.trim().startsWith("{")) {
    try {
      data = JSON.parse(payload);
    } catch (e) {
      data = { raw: payload };
    }
  } else if (typeof payload === "object" && payload !== null) {
    data = payload;
  } else {
    data = { raw: String(payload) };
  }

  const parts = cleanTopic.split("/");

  // Direct trigger topic: cmdbar/trigger/<command_name>
  if (parts.length >= 3 && parts[0] === "cmdbar" && parts[1] === "trigger") {
    const cmdName = parts.slice(2).join("/");
    const params = data.parameters || data.params || {};
    return {
      success: true,
      action: "execute_command",
      commandName: cmdName,
      parameters: params,
      code: 200,
    };
  }

  // Telemetry topic: cmdbar/sensors/<sensor_id> or cmdbar/devices/<device_id>/telemetry
  if ((parts.length >= 3 && parts[0] === "cmdbar" && ["sensors", "devices"].includes(parts[1])) || cleanTopic.includes("telemetry")) {
    const sensorId = parts.length >= 3 ? parts[2] : "mqtt_sensor";
    const telemetry = data.telemetry || data;
    const rules = (config.iot && config.iot.sensor_rules) || [];
    const triggered = evaluateSensorRules(rules, sensorId, telemetry);
    return {
      success: true,
      action: "sensor_telemetry",
      sensorId,
      triggeredRules: triggered,
      code: 200,
    };
  }

  // Home Assistant event topic
  if (cleanTopic.includes("homeassistant") || cleanTopic.includes("openhab")) {
    return processHomeAutomationEvent(data, config);
  }

  // Explicit payload command
  if (data.command || data.command_name) {
    return {
      success: true,
      action: "execute_command",
      commandName: data.command || data.command_name,
      parameters: data.parameters || data.params || {},
      code: 200,
    };
  }

  return {
    success: false,
    error: `Unrecognized MQTT topic pattern: ${cleanTopic}`,
    code: 404,
  };
}

/**
 * @public
 * Validates HTTP Webhook authorization header against secret or bearer token.
 */
export function validateWebhookAuth(headers = {}, webhookSecret = null) {
  if (!webhookSecret) return true;

  const lowerHeaders = {};
  Object.keys(headers).forEach((k) => {
    lowerHeaders[k.toLowerCase()] = String(headers[k]);
  });

  const secretHeader = lowerHeaders["x-cmdbar-secret"];
  if (secretHeader && secretHeader === webhookSecret) {
    return true;
  }

  const authHeader = lowerHeaders["authorization"] || "";
  if (authHeader.startsWith("Bearer ") && authHeader.slice(7).trim() === webhookSecret) {
    return true;
  }

  const sigHeader = lowerHeaders["x-cmdbar-signature"] || lowerHeaders["x-hub-signature-256"];
  if (sigHeader) {
    const cleanSig = sigHeader.startsWith("sha256=") ? sigHeader.slice(7) : sigHeader;
    if (cleanSig === webhookSecret) {
      return true;
    }
  }

  return false;
}

/**
 * @public
 * Processes HTTP Webhook request data for IoT trigger execution.
 */
export function processWebhookRequest(endpoint, headers = {}, payload = {}, config = {}) {
  const secret = (config.iot && config.iot.webhook_secret) || null;
  if (!validateWebhookAuth(headers, secret)) {
    return {
      success: false,
      error: "Unauthorized: Invalid or missing webhook secret/token",
      code: 401,
    };
  }

  const urlPath = (endpoint || "/").trim();
  let payloadData = {};
  if (typeof payload === "string") {
    try {
      payloadData = JSON.parse(payload);
    } catch (e) {
      payloadData = { raw: payload };
    }
  } else if (typeof payload === "object" && payload !== null) {
    payloadData = payload;
  }

  if (urlPath.includes("/homeassistant") || urlPath.includes("/ha/event")) {
    return processHomeAutomationEvent(payloadData, config);
  }

  if (urlPath.includes("/sensor") || urlPath.includes("/telemetry")) {
    const sensorId = payloadData.sensor_id || payloadData.entity_id || "webhook_sensor";
    const telemetry = payloadData.telemetry || payloadData.data || payloadData;
    const rules = (config.iot && config.iot.sensor_rules) || [];
    const triggered = evaluateSensorRules(rules, sensorId, telemetry);
    return {
      success: true,
      action: "sensor_telemetry",
      sensorId,
      triggeredRules: triggered,
      code: 200,
    };
  }

  let cmdName = payloadData.command || payloadData.command_name;
  if (!cmdName && urlPath.startsWith("/trigger/")) {
    cmdName = decodeURIComponent(urlPath.slice(9));
  }

  if (!cmdName) {
    return {
      success: false,
      error: "Missing 'command' or 'command_name' in webhook payload",
      code: 400,
    };
  }

  return {
    success: true,
    action: "execute_command",
    commandName: cmdName,
    parameters: payloadData.parameters || payloadData.params || {},
    code: 200,
  };
}

/**
 * @public
 * Parses Home Assistant or openHAB event objects into command triggers or sensor rule evaluations.
 */
export function processHomeAutomationEvent(eventData = {}, config = {}) {
  if (typeof eventData !== "object" || eventData === null) {
    return { success: false, error: "Invalid Home Automation event structure", code: 400 };
  }

  if (eventData.action && ["trigger_cmdbar", "execute_command", "run"].includes(eventData.action)) {
    return {
      success: true,
      action: "execute_command",
      commandName: eventData.command || eventData.name,
      parameters: eventData.parameters || eventData.data || {},
      code: 200,
    };
  }

  const data = typeof eventData.data === "object" && eventData.data !== null ? eventData.data : eventData;
  const entityId = data.entity_id || eventData.entity_id;
  const new_state = data.new_state || data.state || eventData.state;

  if (entityId) {
    const stateVal = typeof new_state === "object" && new_state !== null ? new_state.state : String(new_state || "");
    const rules = (config.iot && config.iot.sensor_rules) || [];
    const triggered = evaluateSensorRules(rules, entityId, { state: stateVal, raw: data });
    return {
      success: true,
      action: "home_assistant_entity_update",
      entityId,
      state: stateVal,
      triggeredRules: triggered,
      code: 200,
    };
  }

  if (eventData.command || eventData.command_name) {
    return {
      success: true,
      action: "execute_command",
      commandName: eventData.command || eventData.command_name,
      parameters: eventData.parameters || {},
      code: 200,
    };
  }

  return {
    success: false,
    error: "Could not extract Home Assistant entity_id or command from payload",
    code: 400,
  };
}

/**
 * @public
 * Evaluates registered sensor rules against sensor telemetry and applies deduplication cooldowns.
 */
export function evaluateSensorRules(sensorRules = [], sensorId, telemetryData, lastTriggerTimes = new Map()) {
  const triggered = [];
  const now = Date.now();

  for (const rule of sensorRules) {
    if (!rule || (rule.sensor_id !== sensorId && rule.sensor_id !== "*")) {
      continue;
    }

    const ruleKey = `${rule.sensor_id}:${rule.metric}:${rule.command_name}`;
    const cooldownMs = (rule.cooldown_seconds || 10) * 1000;
    const lastTime = lastTriggerTimes.get(ruleKey) || 0;

    if (now - lastTime < cooldownMs) {
      continue;
    }

    let val = undefined;
    if (typeof telemetryData === "object" && telemetryData !== null) {
      val = telemetryData[rule.metric];
      if (val === undefined && rule.metric === "state") {
        val = telemetryData.value || telemetryData.val;
      }
      if (val === undefined && Object.keys(telemetryData).length === 1) {
        val = Object.values(telemetryData)[0];
      }
    } else {
      val = telemetryData;
    }

    if (val === undefined) continue;

    if (evaluateCondition(val, rule.operator, rule.threshold)) {
      lastTriggerTimes.set(ruleKey, now);
      const params = Object.assign({}, rule.parameters || {});
      params.sensor_id = String(sensorId);
      params.metric_value = String(val);

      triggered.push({
        rule,
        sensorId,
        metricValue: val,
        commandName: rule.command_name,
        parameters: params,
      });
    }
  }

  return triggered;
}

/**
 * @public
 * Main IoT Trigger Manager class for managing IoT integrations in the GNOME extension.
 */
export class IoTTriggerManager {
  constructor(config = {}) {
    this.config = config;
    this.lastTriggerTimes = new Map();
  }

  updateConfig(config) {
    this.config = config;
  }

  handleMQTT(topic, payload) {
    return processMQTTTopicAndPayload(topic, payload, this.config);
  }

  handleWebhook(endpoint, headers, payload) {
    return processWebhookRequest(endpoint, headers, payload, this.config);
  }

  handleHomeAssistant(eventData) {
    return processHomeAutomationEvent(eventData, this.config);
  }

  handleSensorTelemetry(sensorId, telemetryData) {
    const rules = (this.config.iot && this.config.iot.sensor_rules) || [];
    return evaluateSensorRules(rules, sensorId, telemetryData, this.lastTriggerTimes);
  }
}
