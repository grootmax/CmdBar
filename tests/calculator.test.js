import {
  isCalculatorQuery,
  cleanCalculatorQuery,
  normalizeCurrency,
  formatNumber,
  factorial,
  tokenizeMath,
  MathParser,
  evaluateMathExpression,
  convertTemperature,
  evaluateCalculatorQuery,
  calculate,
  CURRENCY_RATES,
  UNIT_DEFINITIONS,
} from "../extension/calculator.js";

describe("Quick Calculator and Eval Mode", () => {
  describe("Trigger & Helper Functions", () => {
    test("isCalculatorQuery identifies '>' trigger correctly", () => {
      expect(isCalculatorQuery("> 2+2")).toBe(true);
      expect(isCalculatorQuery("  >  sin(pi/2)  ")).toBe(true);
      expect(isCalculatorQuery(">100 USD to EUR")).toBe(true);
      expect(isCalculatorQuery("2+2")).toBe(false);
      expect(isCalculatorQuery("/ai deploy")).toBe(false);
      expect(isCalculatorQuery(null)).toBe(false);
    });

    test("cleanCalculatorQuery strips leading '>' and whitespace", () => {
      expect(cleanCalculatorQuery("> 2+2")).toBe("2+2");
      expect(cleanCalculatorQuery("  >  sin(pi/2) ")).toBe("sin(pi/2)");
      expect(cleanCalculatorQuery("2+2")).toBe("2+2");
      expect(cleanCalculatorQuery(null)).toBe("");
    });

    test("normalizeCurrency normalizes codes and symbols", () => {
      expect(normalizeCurrency("$")).toBe("USD");
      expect(normalizeCurrency("€")).toBe("EUR");
      expect(normalizeCurrency("£")).toBe("GBP");
      expect(normalizeCurrency("¥")).toBe("JPY");
      expect(normalizeCurrency("usd")).toBe("USD");
      expect(normalizeCurrency("eur")).toBe("EUR");
      expect(normalizeCurrency("XYZ")).toBe(null);
    });

    test("formatNumber rounds float precision artifacts cleanly", () => {
      expect(formatNumber(0.1 + 0.2)).toBe("0.3");
      expect(formatNumber(42)).toBe("42");
      expect(formatNumber(3.1415926535)).toBe("3.1415926535");
      expect(formatNumber(NaN)).toBe("NaN");
      expect(formatNumber(Infinity)).toBe("Infinity");
      expect(formatNumber(-Infinity)).toBe("-Infinity");
    });

    test("factorial computes non-negative integer factorials", () => {
      expect(factorial(0)).toBe(1);
      expect(factorial(1)).toBe(1);
      expect(factorial(5)).toBe(120);
      expect(() => factorial(-1)).toThrow("negative");
      expect(() => factorial(2.5)).toThrow("integer");
    });
  });

  describe("Math Expression Evaluation", () => {
    test("evaluates basic arithmetic operations and precedence", () => {
      expect(evaluateMathExpression("2 + 2")).toBe(4);
      expect(evaluateMathExpression("2 + 3 * 4")).toBe(14);
      expect(evaluateMathExpression("(2 + 3) * 4")).toBe(20);
      expect(evaluateMathExpression("10 - 3 - 2")).toBe(5);
      expect(evaluateMathExpression("10 / 2")).toBe(5);
      expect(evaluateMathExpression("10 % 3")).toBe(1);
      expect(evaluateMathExpression("10 mod 3")).toBe(1);
    });

    test("evaluates exponentiation and unary negation", () => {
      expect(evaluateMathExpression("2 ^ 10")).toBe(1024);
      expect(evaluateMathExpression("2 ** 10")).toBe(1024);
      expect(evaluateMathExpression("-5 + 3")).toBe(-2);
      expect(evaluateMathExpression("-(5 + 3)")).toBe(-8);
    });

    test("evaluates factorials in math expressions", () => {
      expect(evaluateMathExpression("5!")).toBe(120);
      expect(evaluateMathExpression("3! + 4!")).toBe(24 + 6);
      expect(evaluateMathExpression("fact(5)")).toBe(120);
      expect(evaluateMathExpression("factorial(5)")).toBe(120);
    });

    test("evaluates math functions and constants", () => {
      expect(evaluateMathExpression("sin(pi / 2)")).toBeCloseTo(1);
      expect(evaluateMathExpression("cos(0)")).toBe(1);
      expect(evaluateMathExpression("tan(0)")).toBe(0);
      expect(evaluateMathExpression("sqrt(16)")).toBe(4);
      expect(evaluateMathExpression("cbrt(27)")).toBe(3);
      expect(evaluateMathExpression("abs(-42)")).toBe(42);
      expect(evaluateMathExpression("log10(100)")).toBe(2);
      expect(evaluateMathExpression("log2(8)")).toBe(3);
      expect(evaluateMathExpression("ln(e)")).toBe(1);
      expect(evaluateMathExpression("floor(3.9)")).toBe(3);
      expect(evaluateMathExpression("ceil(3.1)")).toBe(4);
      expect(evaluateMathExpression("round(3.5)")).toBe(4);
      expect(evaluateMathExpression("pow(2, 8)")).toBe(256);
      expect(evaluateMathExpression("min(10, 5, 20)")).toBe(5);
      expect(evaluateMathExpression("max(10, 5, 20)")).toBe(20);
      expect(evaluateMathExpression("tau")).toBeCloseTo(2 * Math.PI);
      expect(evaluateMathExpression("phi")).toBeCloseTo(1.618033988749895);
    });

    test("handles division by zero and invalid expressions gracefully", () => {
      expect(() => evaluateMathExpression("10 / 0")).toThrow("Division by zero");
      expect(() => evaluateMathExpression("sqrt(-1)")).toThrow("negative");
      expect(() => evaluateMathExpression("2 +")).toThrow();
      expect(() => evaluateMathExpression("unknown_fn(5)")).toThrow("Unknown function");
      expect(() => evaluateMathExpression("invalid_var")).toThrow("Unknown identifier");
    });
  });

  describe("Unit Conversions", () => {
    test("converts length units correctly", () => {
      const res1 = evaluateCalculatorQuery("> 10 km to miles");
      expect(res1.success).toBe(true);
      expect(res1.type).toBe("unit");
      expect(res1.numericValue).toBeCloseTo(6.21371, 3);
      expect(res1.result).toContain("miles");

      const res2 = evaluateCalculatorQuery("> 1 meter in cm");
      expect(res2.success).toBe(true);
      expect(res2.numericValue).toBe(100);

      const res3 = evaluateCalculatorQuery("> 12 inches to feet");
      expect(res3.success).toBe(true);
      expect(res3.numericValue).toBe(1);
    });

    test("converts mass / weight units correctly", () => {
      const res = evaluateCalculatorQuery("> 5 lbs to kg");
      expect(res.success).toBe(true);
      expect(res.numericValue).toBeCloseTo(2.26796, 3);
    });

    test("converts volume units correctly", () => {
      const res = evaluateCalculatorQuery("> 1 gallon in liters");
      expect(res.success).toBe(true);
      expect(res.numericValue).toBeCloseTo(3.78541, 3);
    });

    test("converts temperature units correctly", () => {
      const res1 = evaluateCalculatorQuery("> 100 C to F");
      expect(res1.success).toBe(true);
      expect(res1.numericValue).toBe(212);

      const res2 = evaluateCalculatorQuery("> 32 F in C");
      expect(res2.success).toBe(true);
      expect(res2.numericValue).toBe(0);

      const res3 = evaluateCalculatorQuery("> 0 C to K");
      expect(res3.success).toBe(true);
      expect(res3.numericValue).toBe(273.15);
    });

    test("converts data storage units correctly", () => {
      const res = evaluateCalculatorQuery("> 1 GB in MB");
      expect(res.success).toBe(true);
      expect(res.numericValue).toBe(1024);
    });

    test("converts time units correctly", () => {
      const res = evaluateCalculatorQuery("> 2.5 hours to minutes");
      expect(res.success).toBe(true);
      expect(res.numericValue).toBe(150);
    });

    test("converts speed units correctly", () => {
      const res = evaluateCalculatorQuery("> 100 kph in mph");
      expect(res.success).toBe(true);
      expect(res.numericValue).toBeCloseTo(62.1371, 2);
    });

    test("rejects incompatible unit category conversions", () => {
      const res = evaluateCalculatorQuery("> 10 km to kg");
      expect(res.success).toBe(false);
      expect(res.error).toContain("Cannot convert between");
    });
  });

  describe("Currency Conversions", () => {
    test("converts currencies offline using static exchange rates", () => {
      const res1 = evaluateCalculatorQuery("> 100 USD to EUR");
      expect(res1.success).toBe(true);
      expect(res1.type).toBe("currency");
      expect(res1.numericValue).toBe(92);
      expect(res1.result).toBe("92 EUR");

      const res2 = evaluateCalculatorQuery("> $100 in GBP");
      expect(res2.success).toBe(true);
      expect(res2.result).toContain("GBP");

      const res3 = evaluateCalculatorQuery("> 1000 JPY to USD");
      expect(res3.success).toBe(true);
      expect(res3.numericValue).toBeCloseTo(6.4516, 2);
    });
  });

  describe("Integrated evaluateCalculatorQuery & calculate", () => {
    test("handles full > expressions end-to-end", () => {
      const res = calculate("> 2+2");
      expect(res.success).toBe(true);
      expect(res.result).toBe("4");
      expect(res.formatted).toBe("= 4");

      const res2 = calculate("> sin(pi/2)");
      expect(res2.success).toBe(true);
      expect(res2.result).toBe("1");
    });

    test("returns clear error for invalid syntax or empty queries", () => {
      expect(calculate(">").success).toBe(false);
      expect(calculate(null).success).toBe(false);
      expect(calculate("> 2+*3").success).toBe(false);
    });
  });

  describe("Performance Benchmarks", () => {
    test("evaluates 1,000 queries in under 50ms", () => {
      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        evaluateCalculatorQuery(`> ${i} + sin(${i}) * 2 ^ 3`);
      }
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100);
    });
  });
});
