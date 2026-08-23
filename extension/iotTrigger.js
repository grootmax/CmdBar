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
