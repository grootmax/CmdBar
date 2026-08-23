import { validateInput, substituteCommand } from "./commandProcessor.js";

/**
 * @file extension/iotTrigger.js
 * @description CmdBar IoT Trigger Support Module for GNOME Shell extension & JS environment.
 * Handles sensor rule evaluation, webhook payload parsing, and Home Automation discovery formatting.
 */

/**
 * Evaluates a sensor rule condition against a reading value.
 * @public
 * @param {Object} rule - Sensor trigger rule definition containing operator and target value.
 * @param {number|string} readingValue - Incoming sensor reading value.
 * @returns {boolean} True if condition is satisfied, false otherwise.
 */
export function evaluateSensorRule(rule, readingValue) {
  if (!rule) return false;

  const operator = (rule.operator || "==").toString().trim().toLowerCase();
  const targetVal = rule.value;

  if (operator === "contains") {
    return String(readingValue)
      .toLowerCase()
      .includes(String(targetVal).toLowerCase());
  }

  const numReading = Number(readingValue);
  const numTarget = Number(targetVal);

  if (!isNaN(numReading) && !isNaN(numTarget)) {
    switch (operator) {
      case ">":
      case "greater_than":
        return numReading > numTarget;
      case "<":
      case "less_than":
        return numReading < numTarget;
      case ">=":
      case "greater_or_equal":
        return numReading >= numTarget;
      case "<=":
      case "less_or_equal":
        return numReading <= numTarget;
      case "==":
      case "eq":
      case "equal":
        return numReading === numTarget;
      case "!=":
      case "neq":
      case "not_equal":
        return numReading !== numTarget;
      default:
        break;
    }
  }

  if (operator === "==" || operator === "eq" || operator === "equal") {
    return String(readingValue).trim() === String(targetVal).trim();
  }
  if (operator === "!=" || operator === "neq" || operator === "not_equal") {
    return String(readingValue).trim() !== String(targetVal).trim();
  }

  return false;
}

/**
 * Checks whether a sensor trigger rule is currently within its cooldown / debounce window.
 * @public
 * @param {string} ruleId - Unique identifier of the rule.
 * @param {number} cooldownSeconds - Cooldown period in seconds.
 * @param {Map<string, number>|Object} lastTriggerMap - Map or object tracking last execution timestamps.
 * @returns {boolean} True if in cooldown, false if ready to trigger.
 */
export function checkCooldown(ruleId, cooldownSeconds, lastTriggerMap) {
  if (!cooldownSeconds || cooldownSeconds <= 0) return false;

  const now = Date.now() / 1000;
  let lastTime = 0;

  if (lastTriggerMap instanceof Map) {
    lastTime = lastTriggerMap.get(ruleId) || 0;
  } else if (lastTriggerMap && typeof lastTriggerMap === "object") {
    lastTime = lastTriggerMap[ruleId] || 0;
  }

  return now - lastTime < cooldownSeconds;
}

/**
 * Parses and validates an incoming JSON webhook body string.
 * @public
 * @param {string} payloadStr - JSON payload string.
 * @returns {Object} Structured payload object with status and extracted command/args.
 */
export function parseWebhookPayload(payloadStr) {
  if (!payloadStr || typeof payloadStr !== "string") {
    return { valid: false, error: "Empty or invalid payload string" };
  }

  try {
    const data = JSON.parse(payloadStr);
    const command = data.command || data.action || null;
    const args = data.args && typeof data.args === "object" ? data.args : {};

    return {
      valid: Boolean(command),
      command,
      args,
      raw: data,
    };
  } catch (err) {
    return { valid: false, error: `JSON parse error: ${err.message}` };
  }
}

/**
 * Formats a standardized MQTT topic string.
 * @public
 * @param {string} prefix - Topic prefix (e.g. 'cmdbar').
 * @param {string} action - Action type ('trigger', 'sensor', 'status', 'response').
 * @param {string} [commandName] - Optional command or sensor name.
 * @returns {string} Formatted MQTT topic string.
 */
export function formatMqttTopic(prefix, action, commandName = "") {
  const cleanPrefix = (prefix || "cmdbar").replace(/\/+$/, "");
  const cleanAction = (action || "trigger").replace(/^\/+|\/+$/g, "");

  if (!commandName) {
    return `${cleanPrefix}/${cleanAction}`;
  }

  const cleanName = commandName.replace(/^\/+|\/+$/g, "");
  return `${cleanPrefix}/${cleanAction}/${cleanName}`;
}

/**
 * Generates Home Assistant MQTT Discovery topic and configuration object.
 * @public
 * @param {string} commandName - Name of the CmdBar command.
 * @param {string} [topicPrefix='cmdbar'] - MQTT topic prefix.
 * @returns {Object} Object containing discoveryTopic and payload.
 */
export function buildHomeAssistantConfig(commandName, topicPrefix = "cmdbar") {
  const sanitizedId = (commandName || "cmd")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
  const discoveryTopic = `homeassistant/button/cmdbar_${sanitizedId}/config`;

  const payload = {
    name: `CmdBar ${commandName}`,
    unique_id: `cmdbar_btn_${sanitizedId}`,
    command_topic: formatMqttTopic(topicPrefix, "trigger", commandName),
    availability_topic: formatMqttTopic(topicPrefix, "status"),
    payload_press: JSON.stringify({ command: commandName }),
    device: {
      identifiers: ["cmdbar_desktop_integration"],
      name: "CmdBar System Controller",
      model: "CmdBar IoT Bridge",
      manufacturer: "CmdBar",
    },
  };

  return { discoveryTopic, payload };
}

/**
 * IoT Trigger Processor class managing sensor rule evaluation state and debouncing.
 * @public
 */
export class IoTTriggerProcessor {
  /**
   * Constructs an IoTTriggerProcessor instance.
   * @public
   * @param {Array<Object>} [rules=[]] - List of sensor trigger rules.
   */
  constructor(rules = []) {
    this.rules = rules;
    this.lastTriggerMap = new Map();
  }

  /**
   * Updates the active rules list.
   * @public
   * @param {Array<Object>} rules - New rule set.
   */
  setRules(rules) {
    this.rules = rules || [];
  }

  /**
   * Evaluates an incoming sensor reading and returns triggered rules that passed debouncing.
   * @public
   * @param {string} sensorName - Sensor name.
   * @param {number|string} value - Sensor reading value.
   * @returns {Array<Object>} List of triggered rules.
   */
  processSensorReading(sensorName, value) {
    const triggered = [];
    const now = Date.now() / 1000;

    for (const rule of this.rules) {
      const ruleSensor = rule.sensor_name || rule.sensor;
      if (
        !ruleSensor ||
        String(ruleSensor).toLowerCase() !== String(sensorName).toLowerCase()
      ) {
        continue;
      }

      const ruleId = rule.id || `${ruleSensor}_${rule.command}`;
      const cooldown = Number(rule.cooldown_seconds || rule.cooldown) || 0;

      if (checkCooldown(ruleId, cooldown, this.lastTriggerMap)) {
        continue;
      }

      if (evaluateSensorRule(rule, value)) {
        this.lastTriggerMap.set(ruleId, now);
        triggered.push(rule);
      }
    }

    return triggered;
  }
}

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
