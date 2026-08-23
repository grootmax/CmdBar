/**
 * Quick Calculator and Eval Mode module for CmdBar extension.
 * Evaluates mathematical expressions, unit conversions, and currency conversions.
 * Operates safely without eval()/Function() and entirely offline without network.
 */

// Offline Currency Exchange Rates relative to base currency USD
export const CURRENCY_RATES = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 155.0,
  CAD: 1.36,
  AUD: 1.52,
  CHF: 0.90,
  CNY: 7.23,
  INR: 83.5,
  BRL: 5.15,
  RUB: 90.0,
  KRW: 1370.0,
  SGD: 1.35,
  NZD: 1.65,
  HKD: 7.82,
  MXN: 16.8,
  SEK: 10.7,
  NOK: 10.6,
  TRY: 32.2,
  AED: 3.67,
  SAR: 3.75,
};

// Unit Conversion Definitions relative to standard base units
export const UNIT_DEFINITIONS = {
  // Length (base: meter 'm')
  m: { category: "length", factor: 1.0, name: "meters" },
  meter: { category: "length", factor: 1.0, name: "meters" },
  meters: { category: "length", factor: 1.0, name: "meters" },
  km: { category: "length", factor: 1000.0, name: "kilometers" },
  kilometer: { category: "length", factor: 1000.0, name: "kilometers" },
  kilometers: { category: "length", factor: 1000.0, name: "kilometers" },
  cm: { category: "length", factor: 0.01, name: "centimeters" },
  centimeter: { category: "length", factor: 0.01, name: "centimeters" },
  centimeters: { category: "length", factor: 0.01, name: "centimeters" },
  mm: { category: "length", factor: 0.001, name: "millimeters" },
  millimeter: { category: "length", factor: 0.001, name: "millimeters" },
  millimeters: { category: "length", factor: 0.001, name: "millimeters" },
  mi: { category: "length", factor: 1609.344, name: "miles" },
  mile: { category: "length", factor: 1609.344, name: "miles" },
  miles: { category: "length", factor: 1609.344, name: "miles" },
  ft: { category: "length", factor: 0.3048, name: "feet" },
  foot: { category: "length", factor: 0.3048, name: "feet" },
  feet: { category: "length", factor: 0.3048, name: "feet" },
  in: { category: "length", factor: 0.0254, name: "inches" },
  inch: { category: "length", factor: 0.0254, name: "inches" },
  inches: { category: "length", factor: 0.0254, name: "inches" },
  yd: { category: "length", factor: 0.9144, name: "yards" },
  yard: { category: "length", factor: 0.9144, name: "yards" },
  yards: { category: "length", factor: 0.9144, name: "yards" },

  // Mass (base: kilogram 'kg')
  kg: { category: "mass", factor: 1.0, name: "kilograms" },
  kilogram: { category: "mass", factor: 1.0, name: "kilograms" },
  kilograms: { category: "mass", factor: 1.0, name: "kilograms" },
  g: { category: "mass", factor: 0.001, name: "grams" },
  gram: { category: "mass", factor: 0.001, name: "grams" },
  grams: { category: "mass", factor: 0.001, name: "grams" },
  mg: { category: "mass", factor: 0.000001, name: "milligrams" },
  milligram: { category: "mass", factor: 0.000001, name: "milligrams" },
  milligrams: { category: "mass", factor: 0.000001, name: "milligrams" },
  lb: { category: "mass", factor: 0.45359237, name: "pounds" },
  lbs: { category: "mass", factor: 0.45359237, name: "pounds" },
  pound: { category: "mass", factor: 0.45359237, name: "pounds" },
  pounds: { category: "mass", factor: 0.45359237, name: "pounds" },
  oz: { category: "mass", factor: 0.028349523125, name: "ounces" },
  ounce: { category: "mass", factor: 0.028349523125, name: "ounces" },
  ounces: { category: "mass", factor: 0.028349523125, name: "ounces" },
  ton: { category: "mass", factor: 1000.0, name: "tons" },
  tons: { category: "mass", factor: 1000.0, name: "tons" },

  // Volume (base: liter 'l')
  l: { category: "volume", factor: 1.0, name: "liters" },
  liter: { category: "volume", factor: 1.0, name: "liters" },
  liters: { category: "volume", factor: 1.0, name: "liters" },
  ml: { category: "volume", factor: 0.001, name: "milliliters" },
  milliliter: { category: "volume", factor: 0.001, name: "milliliters" },
  milliliters: { category: "volume", factor: 0.001, name: "milliliters" },
  gal: { category: "volume", factor: 3.78541, name: "gallons" },
  gallon: { category: "volume", factor: 3.78541, name: "gallons" },
  gallons: { category: "volume", factor: 3.78541, name: "gallons" },
  qt: { category: "volume", factor: 0.946353, name: "quarts" },
  quart: { category: "volume", factor: 0.946353, name: "quarts" },
  quarts: { category: "volume", factor: 0.946353, name: "quarts" },
  pt: { category: "volume", factor: 0.473176, name: "pints" },
  pint: { category: "volume", factor: 0.473176, name: "pints" },
  pints: { category: "volume", factor: 0.473176, name: "pints" },
  cup: { category: "volume", factor: 0.24, name: "cups" },
  cups: { category: "volume", factor: 0.24, name: "cups" },

  // Temperature
  c: { category: "temperature", name: "Celsius" },
  celsius: { category: "temperature", name: "Celsius" },
  f: { category: "temperature", name: "Fahrenheit" },
  fahrenheit: { category: "temperature", name: "Fahrenheit" },
  k: { category: "temperature", name: "Kelvin" },
  kelvin: { category: "temperature", name: "Kelvin" },

  // Data / Storage (base: bits)
  b: { category: "data", factor: 1.0, name: "bits" },
  bit: { category: "data", factor: 1.0, name: "bits" },
  bits: { category: "data", factor: 1.0, name: "bits" },
  B: { category: "data", factor: 8.0, name: "bytes" },
  byte: { category: "data", factor: 8.0, name: "bytes" },
  bytes: { category: "data", factor: 8.0, name: "bytes" },
  kb: { category: "data", factor: 8 * 1024, name: "KB" },
  kilobyte: { category: "data", factor: 8 * 1024, name: "KB" },
  kilobytes: { category: "data", factor: 8 * 1024, name: "KB" },
  mb: { category: "data", factor: 8 * 1024 * 1024, name: "MB" },
  megabyte: { category: "data", factor: 8 * 1024 * 1024, name: "MB" },
  megabytes: { category: "data", factor: 8 * 1024 * 1024, name: "MB" },
  gb: { category: "data", factor: 8 * 1024 * 1024 * 1024, name: "GB" },
  gigabyte: { category: "data", factor: 8 * 1024 * 1024 * 1024, name: "GB" },
  gigabytes: { category: "data", factor: 8 * 1024 * 1024 * 1024, name: "GB" },
  tb: { category: "data", factor: 8 * 1024 * 1024 * 1024 * 1024, name: "TB" },
  terabyte: { category: "data", factor: 8 * 1024 * 1024 * 1024 * 1024, name: "TB" },
  terabytes: { category: "data", factor: 8 * 1024 * 1024 * 1024 * 1024, name: "TB" },

  // Time (base: seconds)
  ms: { category: "time", factor: 0.001, name: "milliseconds" },
  millisecond: { category: "time", factor: 0.001, name: "milliseconds" },
  milliseconds: { category: "time", factor: 0.001, name: "milliseconds" },
  s: { category: "time", factor: 1.0, name: "seconds" },
  sec: { category: "time", factor: 1.0, name: "seconds" },
  second: { category: "time", factor: 1.0, name: "seconds" },
  seconds: { category: "time", factor: 1.0, name: "seconds" },
  min: { category: "time", factor: 60.0, name: "minutes" },
  minute: { category: "time", factor: 60.0, name: "minutes" },
  minutes: { category: "time", factor: 60.0, name: "minutes" },
  h: { category: "time", factor: 3600.0, name: "hours" },
  hr: { category: "time", factor: 3600.0, name: "hours" },
  hour: { category: "time", factor: 3600.0, name: "hours" },
  hours: { category: "time", factor: 3600.0, name: "hours" },
  d: { category: "time", factor: 86400.0, name: "days" },
  day: { category: "time", factor: 86400.0, name: "days" },
  days: { category: "time", factor: 86400.0, name: "days" },
  w: { category: "time", factor: 604800.0, name: "weeks" },
  week: { category: "time", factor: 604800.0, name: "weeks" },
  weeks: { category: "time", factor: 604800.0, name: "weeks" },
  y: { category: "time", factor: 31536000.0, name: "years" },
  year: { category: "time", factor: 31536000.0, name: "years" },
  years: { category: "time", factor: 31536000.0, name: "years" },

  // Speed (base: m/s)
  "m/s": { category: "speed", factor: 1.0, name: "m/s" },
  "km/h": { category: "speed", factor: 1 / 3.6, name: "km/h" },
  kph: { category: "speed", factor: 1 / 3.6, name: "km/h" },
  mph: { category: "speed", factor: 0.44704, name: "mph" },
};

/**
 * Checks if the given text input triggers Quick Calculator / Eval mode.
 * Evaluates true if input starts with '>'.
 * @param {string} text
 * @returns {boolean}
 * @public
 */
export function isCalculatorQuery(text) {
  if (text === null || text === undefined) return false;
  return String(text).trim().startsWith(">");
}

/**
 * Cleans user input query by stripping leading '>' and whitespace.
 * @param {string} text
 * @returns {string}
 * @public
 */
export function cleanCalculatorQuery(text) {
  if (text === null || text === undefined) return "";
  return String(text).trim().replace(/^>\s*/, "").trim();
}

/**
 * Normalizes a currency symbol or code to a standard uppercase code.
 * @param {string} str
 * @returns {string|null}
 * @public
 */
export function normalizeCurrency(str) {
  if (!str) return null;
  const s = String(str).toUpperCase().trim();
  const symbolMap = {
    "$": "USD",
    "€": "EUR",
    "£": "GBP",
    "¥": "JPY",
    "₹": "INR",
  };
  if (symbolMap[s]) return symbolMap[s];
  if (CURRENCY_RATES[s] !== undefined) return s;
  return null;
}

/**
 * Formats a numeric calculation result into a clean, human-readable string.
 * Prevents floating point precision weirdness (e.g., 0.1 + 0.2 = 0.30000000000000004).
 * @param {number} val
 * @returns {string}
 * @public
 */
export function formatNumber(val) {
  if (typeof val !== "number" || isNaN(val)) return "NaN";
  if (!isFinite(val)) return val > 0 ? "Infinity" : "-Infinity";
  const rounded = Math.round(val * 1e10) / 1e10;
  return rounded.toString();
}

/**
 * Computes integer factorial of a non-negative integer.
 * @param {number} n
 * @returns {number}
 * @public
 */
export function factorial(n) {
  if (n < 0) throw new Error("Factorial of negative number");
  if (!Number.isInteger(n)) throw new Error("Factorial requires integer");
  if (n > 170) return Infinity;
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

/**
 * Evaluates a built-in math function by name and arguments array.
 * @param {string} name
 * @param {number[]} args
 * @returns {number}
 * @public
 */
export function evaluateMathFunction(name, args) {
  const func = name.toLowerCase();
  switch (func) {
    case "sin":
      return Math.sin(args[0]);
    case "cos":
      return Math.cos(args[0]);
    case "tan":
      return Math.tan(args[0]);
    case "asin":
      return Math.asin(args[0]);
    case "acos":
      return Math.acos(args[0]);
    case "atan":
      return Math.atan(args[0]);
    case "sqrt":
      if (args[0] < 0) throw new Error("Square root of negative number");
      return Math.sqrt(args[0]);
    case "cbrt":
      return Math.cbrt(args[0]);
    case "abs":
      return Math.abs(args[0]);
    case "log":
    case "ln":
      if (args[0] <= 0) throw new Error("Logarithm of non-positive number");
      return Math.log(args[0]);
    case "log10":
      if (args[0] <= 0) throw new Error("Logarithm of non-positive number");
      return Math.log10(args[0]);
    case "log2":
      if (args[0] <= 0) throw new Error("Logarithm of non-positive number");
      return Math.log2(args[0]);
    case "exp":
      return Math.exp(args[0]);
    case "floor":
      return Math.floor(args[0]);
    case "ceil":
      return Math.ceil(args[0]);
    case "round":
      return Math.round(args[0]);
    case "pow":
      return Math.pow(args[0], args[1]);
    case "min":
      return Math.min(...args);
    case "max":
      return Math.max(...args);
    case "fact":
    case "factorial":
      return factorial(args[0]);
    default:
      throw new Error(`Unknown function '${name}'`);
  }
}

/**
 * Tokenizes a mathematical expression string into typed tokens for safe parsing.
 * @param {string} input
 * @returns {Array<Object>}
 * @public
 */
export function tokenizeMath(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (/\d|\./.test(ch)) {
      let numStr = "";
      while (i < input.length && /[\d\.]/.test(input[i])) {
        numStr += input[i++];
      }
      const val = parseFloat(numStr);
      if (isNaN(val)) {
        throw new Error(`Invalid number '${numStr}'`);
      }
      tokens.push({ type: "NUMBER", value: numStr, numericValue: val });
      continue;
    }

    if (/[a-zA-Z_πτ]/.test(ch)) {
      let ident = "";
      while (i < input.length && /[a-zA-Z0-9_πτ]/.test(input[i])) {
        ident += input[i++];
      }
      tokens.push({ type: "IDENT", value: ident });
      continue;
    }

    if (ch === "*" && input[i + 1] === "*") {
      tokens.push({ type: "OPERATOR", value: "**" });
      i += 2;
      continue;
    }

    if ("+-*/%^!(),".includes(ch)) {
      tokens.push({
        type: "(),".includes(ch) ? "PAREN" : "OPERATOR",
        value: ch,
      });
      i++;
      continue;
    }

    throw new Error(`Unexpected character '${ch}'`);
  }
  return tokens;
}

/**
 * Safe Recursive Descent Parser for evaluating mathematical expressions without eval()/Function().
 * @public
 */
export class MathParser {
  /**
   * @param {Array<Object>} tokens
   */
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() {
    return this.tokens[this.pos];
  }

  consume() {
    return this.tokens[this.pos++];
  }

  parse() {
    if (!this.tokens || this.tokens.length === 0) {
      throw new Error("Empty math expression");
    }
    const res = this.parseExpression();
    if (this.pos < this.tokens.length) {
      throw new Error(
        `Unexpected token at position ${this.pos}: '${this.tokens[this.pos].value}'`
      );
    }
    return res;
  }

  // expr -> term (( '+' | '-' ) term)*
  parseExpression() {
    let left = this.parseTerm();
    while (
      this.peek() &&
      (this.peek().value === "+" || this.peek().value === "-")
    ) {
      const op = this.consume().value;
      const right = this.parseTerm();
      if (op === "+") left += right;
      else left -= right;
    }
    return left;
  }

  // term -> power (( '*' | '/' | '%' | 'mod' ) power)*
  parseTerm() {
    let left = this.parsePower();
    while (
      this.peek() &&
      (this.peek().value === "*" ||
        this.peek().value === "/" ||
        this.peek().value === "%" ||
        (this.peek().type === "IDENT" &&
          this.peek().value.toLowerCase() === "mod"))
    ) {
      const op = this.consume().value.toLowerCase();
      const right = this.parsePower();
      if (op === "*") {
        left *= right;
      } else if (op === "/") {
        if (right === 0) throw new Error("Division by zero");
        left /= right;
      } else if (op === "%" || op === "mod") {
        if (right === 0) throw new Error("Division by zero");
        left %= right;
      }
    }
    return left;
  }

  // power -> unary ( ('^' | '**') power )?
  parsePower() {
    let left = this.parseUnary();
    if (
      this.peek() &&
      (this.peek().value === "^" || this.peek().value === "**")
    ) {
      this.consume();
      const right = this.parsePower(); // Right-associative exponentiation
      left = Math.pow(left, right);
    }
    return left;
  }

  // unary -> ('+' | '-')? postfix
  parseUnary() {
    if (
      this.peek() &&
      (this.peek().value === "+" || this.peek().value === "-")
    ) {
      const op = this.consume().value;
      const val = this.parseUnary();
      return op === "-" ? -val : val;
    }
    return this.parsePostfix();
  }

  // postfix -> primary ('!')*
  parsePostfix() {
    let val = this.parsePrimary();
    while (this.peek() && this.peek().value === "!") {
      this.consume();
      val = factorial(val);
    }
    return val;
  }

  // primary -> NUMBER | CONSTANT | FUNCTION '(' args ')' | '(' expr ')'
  parsePrimary() {
    const token = this.peek();
    if (!token) {
      throw new Error("Unexpected end of expression");
    }

    if (token.type === "NUMBER") {
      this.consume();
      return token.numericValue;
    }

    if (token.type === "PAREN" && token.value === "(") {
      this.consume(); // '('
      const val = this.parseExpression();
      const next = this.consume();
      if (!next || next.value !== ")") {
        throw new Error("Missing closing parenthesis");
      }
      return val;
    }

    if (token.type === "IDENT") {
      const name = token.value.toLowerCase();
      this.consume();

      // Math Constants
      if (name === "pi" || name === "π") return Math.PI;
      if (name === "e") return Math.E;
      if (name === "tau" || name === "τ") return 2 * Math.PI;
      if (name === "phi") return 1.618033988749895;

      // Function calls
      if (this.peek() && this.peek().value === "(") {
        this.consume(); // '('
        const args = [];
        if (this.peek() && this.peek().value !== ")") {
          args.push(this.parseExpression());
          while (this.peek() && this.peek().value === ",") {
            this.consume();
            args.push(this.parseExpression());
          }
        }
        const closing = this.consume();
        if (!closing || closing.value !== ")") {
          throw new Error(`Missing closing parenthesis for function '${name}'`);
        }
        return evaluateMathFunction(name, args);
      } else {
        throw new Error(`Unknown identifier '${token.value}'`);
      }
    }

    throw new Error(`Unexpected token '${token.value}'`);
  }
}

/**
 * Evaluates a pure mathematical expression safely.
 * @param {string} expr
 * @returns {number}
 * @public
 */
export function evaluateMathExpression(expr) {
  const tokens = tokenizeMath(expr);
  const parser = new MathParser(tokens);
  return parser.parse();
}

/**
 * Converts temperature between Celsius, Fahrenheit, and Kelvin.
 * @param {number} value
 * @param {string} fromUnit
 * @param {string} toUnit
 * @returns {number|null}
 * @public
 */
export function convertTemperature(value, fromUnit, toUnit) {
  const f = fromUnit.toLowerCase();
  const t = toUnit.toLowerCase();

  let celsius;
  if (f === "c" || f === "celsius") celsius = value;
  else if (f === "f" || f === "fahrenheit") celsius = (value - 32) * (5 / 9);
  else if (f === "k" || f === "kelvin") celsius = value - 273.15;
  else return null;

  if (t === "c" || t === "celsius") return celsius;
  if (t === "f" || t === "fahrenheit") return celsius * (9 / 5) + 32;
  if (t === "k" || t === "kelvin") return celsius + 273.15;

  return null;
}

/**
 * Main entry point for Quick Calculator and Eval Mode query evaluation.
 * Handles pure math expressions, unit conversions, and currency conversions.
 * @param {string} rawQuery
 * @returns {{ success: boolean, type?: string, expression?: string, result?: string, numericValue?: number, formatted?: string, error?: string }}
 * @public
 */
export function evaluateCalculatorQuery(rawQuery) {
  if (rawQuery === null || rawQuery === undefined) {
    return { success: false, error: "Empty query" };
  }

  const query = cleanCalculatorQuery(rawQuery);
  if (!query) {
    return { success: false, error: "Empty query" };
  }

  // Match conversion syntax: "<amount_expr> <from_unit> (to|in) <to_unit>" or "$100 in GBP"
  const convRegex = /^(.*?)\s+(?:(to|in)\s+)?([a-zA-Z\/$%€£¥₹]+)$/i;
  const twoPartConvRegex = /^(.*?)\s+(?:to|in)\s+([a-zA-Z\/$%€£¥₹]+)$/i;

  let amountExprStr = "";
  let fromStr = "";
  let toStr = "";

  const matchTwo = twoPartConvRegex.exec(query);
  if (matchTwo) {
    const rawAmountFrom = matchTwo[1].trim();
    toStr = matchTwo[2].trim();

    // Check if rawAmountFrom has symbol or split into "amount unit"
    const symbolMatch = /^([$%€£¥₹])\s*(.*)$/.exec(rawAmountFrom);
    if (symbolMatch) {
      fromStr = symbolMatch[1];
      amountExprStr = symbolMatch[2];
    } else {
      const lastSpaceIdx = rawAmountFrom.lastIndexOf(" ");
      if (lastSpaceIdx !== -1) {
        amountExprStr = rawAmountFrom.substring(0, lastSpaceIdx).trim();
        fromStr = rawAmountFrom.substring(lastSpaceIdx + 1).trim();
      } else {
        amountExprStr = rawAmountFrom;
      }
    }
  }

  if (amountExprStr && toStr) {
    let amount;
    try {
      amount = evaluateMathExpression(amountExprStr);
    } catch (e) {
      amount = parseFloat(amountExprStr);
    }

    if (typeof amount === "number" && !isNaN(amount)) {
      // 1. Currency Conversion
      const fromCurr = normalizeCurrency(fromStr);
      const toCurr = normalizeCurrency(toStr);

      if (
        fromCurr &&
        toCurr &&
        CURRENCY_RATES[fromCurr] !== undefined &&
        CURRENCY_RATES[toCurr] !== undefined
      ) {
        const usdValue = amount / CURRENCY_RATES[fromCurr];
        let converted = usdValue * CURRENCY_RATES[toCurr];
        converted = Math.round(converted * 1e10) / 1e10;
        const formattedVal = formatNumber(converted);
        const resultStr = `${formattedVal} ${toCurr}`;
        return {
          success: true,
          type: "currency",
          expression: query,
          result: resultStr,
          numericValue: converted,
          formatted: `= ${resultStr}`,
        };
      }

      // 2. Unit Conversion
      const fromUnitDef = UNIT_DEFINITIONS[fromStr.toLowerCase()];
      const toUnitDef = UNIT_DEFINITIONS[toStr.toLowerCase()];

      if (fromUnitDef && toUnitDef) {
        if (fromUnitDef.category !== toUnitDef.category) {
          return {
            success: false,
            error: `Cannot convert between ${fromUnitDef.category} (${fromStr}) and ${toUnitDef.category} (${toStr})`,
          };
        }

        let converted;
        if (fromUnitDef.category === "temperature") {
          converted = convertTemperature(amount, fromStr, toStr);
        } else {
          const baseValue = amount * fromUnitDef.factor;
          converted = baseValue / toUnitDef.factor;
        }

        if (converted !== null && !isNaN(converted)) {
          converted = Math.round(converted * 1e10) / 1e10;
          const formattedVal = formatNumber(converted);
          const resultStr = `${formattedVal} ${toUnitDef.name || toStr}`;
          return {
            success: true,
            type: "unit",
            expression: query,
            result: resultStr,
            numericValue: converted,
            formatted: `= ${resultStr}`,
          };
        }
      }
    }
  }

  // 3. Math Expression Evaluation
  try {
    const val = evaluateMathExpression(query);
    const roundedVal = Math.round(val * 1e10) / 1e10;
    const formattedVal = formatNumber(roundedVal);
    return {
      success: true,
      type: "math",
      expression: query,
      result: formattedVal,
      numericValue: roundedVal,
      formatted: `= ${formattedVal}`,
    };
  } catch (e) {
    return {
      success: false,
      error: e.message,
    };
  }
}

// Alias for convenience
export const calculate = evaluateCalculatorQuery;
