/**
 * Quick Calculator and Eval Mode module for CmdBar extension.
 * Provides safe offline math evaluation, unit conversions, and currency conversions.
 * No network required.
 */

// Math constants
const CONSTANTS = {
  pi: Math.PI,
  PI: Math.PI,
  e: Math.E,
  E: Math.E,
  tau: 2 * Math.PI,
  TAU: 2 * Math.PI,
  phi: (1 + Math.sqrt(5)) / 2,
  PHI: (1 + Math.sqrt(5)) / 2,
};

// Factorial calculation
function factorial(n) {
  if (n < 0 || !Number.isInteger(n)) return NaN;
  if (n === 0 || n === 1) return 1;
  if (n > 170) return Infinity;
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

// Math functions
const FUNCTIONS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  log: Math.log10, // Default log to base 10
  log10: Math.log10,
  log2: Math.log2,
  ln: Math.log,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  trunc: Math.trunc,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  fact: factorial,
  factorial: factorial,
  deg2rad: (d) => (d * Math.PI) / 180,
  rad2deg: (r) => (r * 180) / Math.PI,
};

// Unit dictionaries with base conversion factors
const LENGTH_UNITS = {
  m: 1,
  meter: 1,
  meters: 1,
  km: 1000,
  kilometer: 1000,
  kilometers: 1000,
  cm: 0.01,
  centimeter: 0.01,
  centimeters: 0.01,
  mm: 0.001,
  millimeter: 0.001,
  millimeters: 0.001,
  mi: 1609.344,
  mile: 1609.344,
  miles: 1609.344,
  yd: 0.9144,
  yard: 0.9144,
  yards: 0.9144,
  ft: 0.3048,
  foot: 0.3048,
  feet: 0.3048,
  in: 0.0254,
  inch: 0.0254,
  inches: 0.0254,
  nm: 1e-9,
  nanometer: 1e-9,
  nanometers: 1e-9,
};

const MASS_UNITS = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  mg: 0.001,
  milligram: 0.001,
  milligrams: 0.001,
  lb: 453.59237,
  lbs: 453.59237,
  pound: 453.59237,
  pounds: 453.59237,
  oz: 28.349523125,
  ounce: 28.349523125,
  ounces: 28.349523125,
  t: 1000000,
  ton: 1000000,
  tons: 1000000,
  tonne: 1000000,
  tonnes: 1000000,
};

const VOLUME_UNITS = {
  l: 1,
  liter: 1,
  liters: 1,
  litre: 1,
  litres: 1,
  ml: 0.001,
  milliliter: 0.001,
  milliliters: 0.001,
  gal: 3.78541,
  gallon: 3.78541,
  gallons: 3.78541,
  pt: 0.473176,
  pint: 0.473176,
  pints: 0.473176,
  qt: 0.946353,
  quart: 0.946353,
  quarts: 0.946353,
  cup: 0.24,
  cups: 0.24,
};

const TIME_UNITS = {
  s: 1,
  sec: 1,
  second: 1,
  seconds: 1,
  min: 60,
  minute: 60,
  minutes: 60,
  h: 3600,
  hr: 3600,
  hour: 3600,
  hours: 3600,
  d: 86400,
  day: 86400,
  days: 86400,
  wk: 604800,
  week: 604800,
  weeks: 604800,
  mo: 2592000,
  month: 2592000,
  months: 2592000,
  yr: 31536000,
  year: 31536000,
  years: 31536000,
};

const DIGITAL_UNITS = {
  b: 1,
  byte: 1,
  bytes: 1,
  kb: 1024,
  kilobyte: 1024,
  kilobytes: 1024,
  mb: 1024 * 1024,
  megabyte: 1024 * 1024,
  megabytes: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
  gigabyte: 1024 * 1024 * 1024,
  gigabytes: 1024 * 1024 * 1024,
  tb: 1024 * 1024 * 1024 * 1024,
  terabyte: 1024 * 1024 * 1024 * 1024,
  terabytes: 1024 * 1024 * 1024 * 1024,
};

const SPEED_UNITS = {
  "m/s": 1,
  ms: 1,
  "km/h": 1 / 3.6,
  kmh: 1 / 3.6,
  kph: 1 / 3.6,
  mph: 0.44704,
  knot: 0.514444,
  knots: 0.514444,
};

// Static currency exchange rates relative to USD (USD = 1.0)
const CURRENCY_RATES = {
  USD: 1.0,
  $: 1.0,
  EUR: 0.92,
  "€": 0.92,
  GBP: 0.79,
  "£": 0.79,
  JPY: 155.0,
  "¥": 155.0,
  CAD: 1.36,
  AUD: 1.51,
  CHF: 0.9,
  INR: 83.5,
  "₹": 83.5,
  CNY: 7.23,
  BRL: 5.15,
  SGD: 1.35,
  NZD: 1.63,
  MXN: 16.7,
  HKD: 7.82,
  SEK: 10.8,
  NOK: 10.7,
  KRW: 1360.0,
  "₩": 1360.0,
  BTC: 0.000015,
  ETH: 0.0003,
};

const CURRENCY_SYMBOLS = {
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
  "₩": "KRW",
};

/**
 * Format number to string trimming trailing zeroes and limiting floating precision.
 */
export function formatNumber(num) {
  if (typeof num !== "number" || isNaN(num)) return "Error";
  if (!isFinite(num)) return num > 0 ? "Infinity" : "-Infinity";
  if (Math.abs(num - Math.round(num)) < 1e-12) {
    return String(Math.round(num));
  }
  let str = num.toFixed(8);
  str = str.replace(/\.?0+$/, "");
  return str;
}

function normalizeTempUnit(u) {
  if (!u) return null;
  const clean = u.toLowerCase().replace("°", "");
  if (clean === "c" || clean === "celsius") return "c";
  if (clean === "f" || clean === "fahrenheit") return "f";
  if (clean === "k" || clean === "kelvin") return "k";
  return null;
}

function getTempDisplaySymbol(u) {
  const norm = normalizeTempUnit(u);
  if (norm === "c") return "°C";
  if (norm === "f") return "°F";
  if (norm === "k") return "K";
  return u;
}

function convertTemperature(val, fromUnit, toUnit) {
  const normFrom = normalizeTempUnit(fromUnit);
  const normTo = normalizeTempUnit(toUnit);
  if (!normFrom || !normTo) return null;

  let celsiusVal;
  if (normFrom === "c") celsiusVal = val;
  else if (normFrom === "f") celsiusVal = ((val - 32) * 5) / 9;
  else if (normFrom === "k") celsiusVal = val - 273.15;
  else return null;

  let resVal;
  if (normTo === "c") resVal = celsiusVal;
  else if (normTo === "f") resVal = (celsiusVal * 9) / 5 + 32;
  else if (normTo === "k") resVal = celsiusVal + 273.15;
  else return null;

  return {
    val: resVal,
    symbolFrom: getTempDisplaySymbol(normFrom),
    symbolTo: getTempDisplaySymbol(normTo),
  };
}

function convertUnits(val, fromUnit, toUnit) {
  const fLow = fromUnit.toLowerCase();
  const tLow = toUnit.toLowerCase();

  const tempRes = convertTemperature(val, fLow, tLow);
  if (tempRes) return tempRes;

  const categories = [
    LENGTH_UNITS,
    MASS_UNITS,
    VOLUME_UNITS,
    TIME_UNITS,
    DIGITAL_UNITS,
    SPEED_UNITS,
  ];
  for (const cat of categories) {
    if (fLow in cat && tLow in cat) {
      const baseVal = val * cat[fLow];
      const resultVal = baseVal / cat[tLow];
      return { val: resultVal, symbolFrom: fromUnit, symbolTo: toUnit };
    }
  }
  return null;
}

function convertCurrency(val, fromCurr, toCurr) {
  let fCode = fromCurr.toUpperCase();
  let tCode = toCurr.toUpperCase();

  if (CURRENCY_SYMBOLS[fromCurr]) fCode = CURRENCY_SYMBOLS[fromCurr];
  if (CURRENCY_SYMBOLS[toCurr]) tCode = CURRENCY_SYMBOLS[toCurr];

  const rateFrom = CURRENCY_RATES[fCode] || CURRENCY_RATES[fromCurr];
  const rateTo = CURRENCY_RATES[tCode] || CURRENCY_RATES[toCurr];

  if (rateFrom !== undefined && rateTo !== undefined) {
    const usdVal = val / rateFrom;
    const resultVal = usdVal * rateTo;
    return {
      val: resultVal,
      fromCurr: fCode.length <= 4 ? fCode : fromCurr,
      toCurr: tCode.length <= 4 ? tCode : toCurr,
    };
  }
  return null;
}

/**
 * Tokenize math expression into AST tokens safely without using eval.
 */
function tokenizeMath(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(expr[i + 1] || ""))) {
      let numStr = "";
      while (
        i < expr.length &&
        (/[0-9.]/.test(expr[i]) ||
          (expr[i].toLowerCase() === "e" && /[0-9+-]/.test(expr[i + 1] || "")))
      ) {
        numStr += expr[i];
        if (
          expr[i].toLowerCase() === "e" &&
          (expr[i + 1] === "+" || expr[i + 1] === "-")
        ) {
          i++;
          numStr += expr[i];
        }
        i++;
      }
      tokens.push({ type: "NUMBER", value: parseFloat(numStr) });
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      let idStr = "";
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) {
        idStr += expr[i];
        i++;
      }
      tokens.push({ type: "IDENTIFIER", value: idStr });
      continue;
    }

    if (ch === "*" && expr[i + 1] === "*") {
      tokens.push({ type: "OPERATOR", value: "**" });
      i += 2;
      continue;
    }

    if ("+-*/%^()!,".includes(ch)) {
      if (ch === "(") tokens.push({ type: "LPAREN", value: "(" });
      else if (ch === ")") tokens.push({ type: "RPAREN", value: ")" });
      else if (ch === ",") tokens.push({ type: "COMMA", value: "," });
      else if (ch === "!") tokens.push({ type: "FACTORIAL", value: "!" });
      else tokens.push({ type: "OPERATOR", value: ch });
      i++;
      continue;
    }

    if (ch === "×" || ch === "x" || ch === "X") {
      tokens.push({ type: "OPERATOR", value: "*" });
      i++;
      continue;
    }

    if (ch === "÷") {
      tokens.push({ type: "OPERATOR", value: "/" });
      i++;
      continue;
    }

    throw new Error(`Unexpected character '${ch}'`);
  }
  return tokens;
}

/**
 * Recursive descent Math Expression Parser
 */
class MathParser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() {
    return this.tokens[this.pos] || null;
  }

  consume() {
    return this.tokens[this.pos++] || null;
  }

  parse() {
    if (this.tokens.length === 0) throw new Error("Empty expression");
    const result = this.parseExpression();
    if (this.pos < this.tokens.length) {
      throw new Error(`Unexpected token '${this.tokens[this.pos].value}'`);
    }
    return result;
  }

  parseExpression() {
    let left = this.parseTerm();
    while (
      this.peek() &&
      this.peek().type === "OPERATOR" &&
      (this.peek().value === "+" || this.peek().value === "-")
    ) {
      const op = this.consume().value;
      const right = this.parseTerm();
      if (op === "+") left = left + right;
      else left = left - right;
    }
    return left;
  }

  parseTerm() {
    let left = this.parseExponent();
    while (
      this.peek() &&
      ((this.peek().type === "OPERATOR" && "*/%".includes(this.peek().value)) ||
        (this.peek().type === "IDENTIFIER" &&
          this.peek().value.toLowerCase() === "mod"))
    ) {
      const token = this.consume();
      const op = token.value.toLowerCase();
      const right = this.parseExponent();
      if (op === "*") left = left * right;
      else if (op === "/") {
        if (right === 0) throw new Error("Division by zero");
        left = left / right;
      } else if (op === "%" || op === "mod") {
        if (right === 0) throw new Error("Division by zero");
        left = left % right;
      }
    }
    return left;
  }

  parseExponent() {
    let left = this.parseUnary();
    if (
      this.peek() &&
      this.peek().type === "OPERATOR" &&
      (this.peek().value === "^" || this.peek().value === "**")
    ) {
      this.consume();
      const right = this.parseExponent();
      left = Math.pow(left, right);
    }
    return left;
  }

  parseUnary() {
    if (
      this.peek() &&
      this.peek().type === "OPERATOR" &&
      (this.peek().value === "+" || this.peek().value === "-")
    ) {
      const op = this.consume().value;
      const operand = this.parseUnary();
      return op === "-" ? -operand : operand;
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let expr = this.parsePrimary();
    while (this.peek() && this.peek().type === "FACTORIAL") {
      this.consume();
      expr = factorial(expr);
    }
    return expr;
  }

  parsePrimary() {
    const token = this.peek();
    if (!token) throw new Error("Unexpected end of expression");

    if (token.type === "NUMBER") {
      this.consume();
      let val = token.value;

      if (
        this.peek() &&
        (this.peek().type === "LPAREN" ||
          (this.peek().type === "IDENTIFIER" &&
            (this.peek().value in CONSTANTS ||
              this.peek().value.toLowerCase() in FUNCTIONS)))
      ) {
        val = val * this.parsePrimary();
      }
      return val;
    }

    if (token.type === "IDENTIFIER") {
      this.consume();
      const id = token.value;

      if (id in CONSTANTS) {
        let val = CONSTANTS[id];
        if (
          this.peek() &&
          (this.peek().type === "LPAREN" ||
            (this.peek().type === "IDENTIFIER" &&
              this.peek().value in FUNCTIONS))
        ) {
          val = val * this.parsePrimary();
        }
        return val;
      }

      const funcName = id.toLowerCase();
      if (funcName in FUNCTIONS) {
        if (!this.peek() || this.peek().type !== "LPAREN") {
          throw new Error(`Expected '(' after function '${id}'`);
        }
        this.consume();
        const args = [];
        if (this.peek() && this.peek().type !== "RPAREN") {
          args.push(this.parseExpression());
          while (this.peek() && this.peek().type === "COMMA") {
            this.consume();
            args.push(this.parseExpression());
          }
        }
        if (!this.peek() || this.peek().type !== "RPAREN") {
          throw new Error(`Expected ')' after arguments for '${id}'`);
        }
        this.consume();

        const fn = FUNCTIONS[funcName];
        const res = fn(...args);
        if (typeof res !== "number" || isNaN(res)) {
          throw new Error(`Invalid arguments for function '${id}'`);
        }

        if (
          this.peek() &&
          (this.peek().type === "LPAREN" || this.peek().type === "IDENTIFIER")
        ) {
          return res * this.parsePrimary();
        }
        return res;
      }

      throw new Error(`Unknown symbol '${id}'`);
    }

    if (token.type === "LPAREN") {
      this.consume();
      const expr = this.parseExpression();
      if (!this.peek() || this.peek().type !== "RPAREN") {
        throw new Error("Missing closing parenthesis ')'");
      }
      this.consume();

      if (
        this.peek() &&
        (this.peek().type === "LPAREN" ||
          this.peek().type === "IDENTIFIER" ||
          this.peek().type === "NUMBER")
      ) {
        return expr * this.parsePrimary();
      }
      return expr;
    }

    throw new Error(`Unexpected token '${token.value}'`);
  }
}

/**
 * Checks if text is a calculator query (starts with '>').
 */
export function isCalculatorQuery(text) {
  if (!text || typeof text !== "string") return false;
  return text.trim().startsWith(">");
}

/**
 * Cleans calculator query string by removing leading '>'.
 */
export function cleanCalculatorQuery(text) {
  if (!text || typeof text !== "string") return "";
  const trimmed = text.trim();
  if (trimmed.startsWith(">")) {
    return trimmed.substring(1).trim();
  }
  return trimmed;
}

/**
 * Main evaluation entry point for math, unit conversion, or currency conversion.
 */
export function calculate(inputStr) {
  const query = cleanCalculatorQuery(inputStr);
  if (!query) {
    return {
      success: false,
      expression: "",
      result: null,
      formatted: null,
      type: "invalid",
      error: "Empty expression",
    };
  }

  // Check currency/unit conversion syntax
  // Patterns e.g. "10 km to miles", "100 C to F", "100 USD to EUR", "$100 to EUR", "10km to miles"
  const convRegex = /^(.*?)\s+(?:to|in|->)\s+([a-zA-Z°/$%]+)$/i;
  const matchConv = convRegex.exec(query);
  if (matchConv) {
    let [, rawLeft, toUnitStr] = matchConv;
    rawLeft = rawLeft.trim();

    let valExprStr = rawLeft;
    let fromUnitStr = "";

    // Extract currency symbol if prefix e.g., $100 -> fromUnitStr = "$", valExprStr = "100"
    const currSymMatch = /^([$€£¥₹₩])\s*(.+)$/.exec(rawLeft);
    if (currSymMatch) {
      fromUnitStr = currSymMatch[1];
      valExprStr = currSymMatch[2];
    } else {
      // Split rawLeft into valExpr and fromUnit e.g., "10 km" or "10km"
      const unitSplitMatch = /^(.*?)(?:\s+)?([a-zA-Z°/$%]+)$/.exec(rawLeft);
      if (unitSplitMatch && unitSplitMatch[1].trim()) {
        valExprStr = unitSplitMatch[1].trim();
        fromUnitStr = unitSplitMatch[2].trim();
      }
    }

    if (valExprStr && fromUnitStr) {
      try {
        const tokens = tokenizeMath(valExprStr);
        const parser = new MathParser(tokens);
        const valNum = parser.parse();

        // Check currency conversion
        const currRes = convertCurrency(valNum, fromUnitStr, toUnitStr);
        if (currRes) {
          const formattedRes = `${formatNumber(valNum)} ${currRes.fromCurr} = ${formatNumber(currRes.val)} ${currRes.toCurr}`;
          return {
            success: true,
            expression: query,
            result: `${formatNumber(currRes.val)} ${currRes.toCurr}`,
            formatted: formattedRes,
            type: "currency",
            error: null,
          };
        }

        // Check unit conversion
        const unitRes = convertUnits(valNum, fromUnitStr, toUnitStr);
        if (unitRes) {
          const formattedRes = `${formatNumber(valNum)} ${unitRes.symbolFrom} = ${formatNumber(unitRes.val)} ${unitRes.symbolTo}`;
          return {
            success: true,
            expression: query,
            result: `${formatNumber(unitRes.val)} ${unitRes.symbolTo}`,
            formatted: formattedRes,
            type: "unit",
            error: null,
          };
        }
      } catch (e) {
        // Fallback to math parsing below if conversion failed
      }
    }
  }

  // Standard Math Evaluation
  try {
    const tokens = tokenizeMath(query);
    const parser = new MathParser(tokens);
    const resNum = parser.parse();

    if (typeof resNum !== "number" || isNaN(resNum)) {
      return {
        success: false,
        expression: query,
        result: null,
        formatted: null,
        type: "math",
        error: "Invalid math operation",
      };
    }

    const formattedRes = `${query} = ${formatNumber(resNum)}`;
    return {
      success: true,
      expression: query,
      result: formatNumber(resNum),
      formatted: formattedRes,
      type: "math",
      error: null,
    };
  } catch (e) {
    return {
      success: false,
      expression: query,
      result: null,
      formatted: null,
      type: "math",
      error: e.message || "Invalid syntax",
    };
  }
}

export const evaluateCalculator = calculate;
