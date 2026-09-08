import {
  isCalculatorQuery,
  cleanCalculatorQuery,
  calculate,
  evaluateCalculator,
  formatNumber,
} from "../extension/quickCalculator.js";

describe("Quick Calculator and Eval Mode", () => {
  describe("Query detection & cleaning", () => {
    test("isCalculatorQuery identifies > prefix correctly", () => {
      expect(isCalculatorQuery("> 2+2")).toBe(true);
      expect(isCalculatorQuery(" > sin(pi/4) ")).toBe(true);
      expect(isCalculatorQuery(">100 USD to EUR")).toBe(true);
      expect(isCalculatorQuery("git status")).toBe(false);
      expect(isCalculatorQuery(null)).toBe(false);
      expect(isCalculatorQuery(undefined)).toBe(false);
      expect(isCalculatorQuery("")).toBe(false);
    });

    test("cleanCalculatorQuery strips leading >", () => {
      expect(cleanCalculatorQuery("> 2 + 2")).toBe("2 + 2");
      expect(cleanCalculatorQuery(" > 10 km to miles ")).toBe("10 km to miles");
      expect(cleanCalculatorQuery("5 + 5")).toBe("5 + 5");
      expect(cleanCalculatorQuery(null)).toBe("");
    });
  });

  describe("Math Arithmetic and Operator Precedence", () => {
    test("basic arithmetic operations", () => {
      expect(calculate("> 2 + 2").result).toBe("4");
      expect(calculate("> 10 - 3 * 2").result).toBe("4");
      expect(calculate("> (10 - 3) * 2").result).toBe("14");
      expect(calculate("> 10 / 4").result).toBe("2.5");
      expect(calculate("> 10 % 3").result).toBe("1");
      expect(calculate("> 10 mod 3").result).toBe("1");
    });

    test("exponentiation", () => {
      expect(calculate("> 2 ^ 10").result).toBe("1024");
      expect(calculate("> 2 ** 3").result).toBe("8");
    });

    test("unary operators and factorials", () => {
      expect(calculate("> -5 + 3").result).toBe("-2");
      expect(calculate("> 5!").result).toBe("120");
      expect(calculate("> factorial(6)").result).toBe("720");
    });

    test("implicit multiplication", () => {
      expect(calculate("> 2(3 + 4)").result).toBe("14");
      expect(calculate("> (2 + 3)(4 + 5)").result).toBe("45");
      expect(calculate("> 2 pi").result).toBe("6.28318531");
    });
  });

  describe("Math Functions & Constants", () => {
    test("trigonometric functions", () => {
      expect(calculate("> sin(pi/2)").result).toBe("1");
      expect(calculate("> cos(0)").result).toBe("1");
      expect(calculate("> tan(0)").result).toBe("0");
    });

    test("roots, logs, and rounding", () => {
      expect(calculate("> sqrt(144)").result).toBe("12");
      expect(calculate("> cbrt(27)").result).toBe("3");
      expect(calculate("> log10(1000)").result).toBe("3");
      expect(calculate("> ln(e)").result).toBe("1");
      expect(calculate("> abs(-55)").result).toBe("55");
      expect(calculate("> floor(4.9)").result).toBe("4");
      expect(calculate("> ceil(4.1)").result).toBe("5");
      expect(calculate("> round(4.5)").result).toBe("5");
    });

    test("min, max, pow functions", () => {
      expect(calculate("> min(10, 20, 5)").result).toBe("5");
      expect(calculate("> max(10, 20, 5)").result).toBe("20");
      expect(calculate("> pow(2, 5)").result).toBe("32");
    });

    test("constants", () => {
      expect(calculate("> pi").result).toBe("3.14159265");
      expect(calculate("> e").result).toBe("2.71828183");
      expect(calculate("> tau").result).toBe("6.28318531");
    });
  });

  describe("Unit Conversions", () => {
    test("length conversions", () => {
      const res = calculate("> 10 km to miles");
      expect(res.success).toBe(true);
      expect(res.type).toBe("unit");
      expect(res.result).toBe("6.21371192 miles");
    });

    test("mass conversions", () => {
      const res = calculate("> 5 kg to lbs");
      expect(res.success).toBe(true);
      expect(res.type).toBe("unit");
      expect(res.result).toBe("11.02311311 lbs");
    });

    test("temperature conversions", () => {
      const resCtoF = calculate("> 100 C to F");
      expect(resCtoF.success).toBe(true);
      expect(resCtoF.result).toBe("212 °F");

      const resFtoC = calculate("> 32 F to C");
      expect(resFtoC.success).toBe(true);
      expect(resFtoC.result).toBe("0 °C");

      const resCtoK = calculate("> 0 C to K");
      expect(resCtoK.success).toBe(true);
      expect(resCtoK.result).toBe("273.15 K");
    });

    test("volume, time, digital data, and speed conversions", () => {
      expect(calculate("> 1 liter to ml").result).toBe("1000 ml");
      expect(calculate("> 2 hours to minutes").result).toBe("120 minutes");
      expect(calculate("> 1024 KB to MB").result).toBe("1 MB");
      expect(calculate("> 100 km/h to mph").result).toBe("62.13711922 mph");
    });
  });

  describe("Currency Conversions (Offline)", () => {
    test("standard currency conversions", () => {
      const res1 = calculate("> 100 USD to EUR");
      expect(res1.success).toBe(true);
      expect(res1.type).toBe("currency");
      expect(res1.result).toBe("92 EUR");

      const res2 = calculate("> $100 to EUR");
      expect(res2.success).toBe(true);
      expect(res2.result).toBe("92 EUR");

      const res3 = calculate("> 10 GBP to JPY");
      expect(res3.success).toBe(true);
      expect(res3.result).toBe("1962.02531646 JPY");
    });
  });

  describe("Error Handling & Security", () => {
    test("handles division by zero gracefully", () => {
      const res = calculate("> 10 / 0");
      expect(res.success).toBe(false);
      expect(res.error).toBe("Division by zero");
    });

    test("handles invalid syntax gracefully", () => {
      const res = calculate("> 2 + * 3");
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });

    test("handles empty input", () => {
      const res = calculate(">");
      expect(res.success).toBe(false);
      expect(res.error).toBe("Empty expression");
    });

    test("security: rejects code injection attempts", () => {
      const res = calculate("> process.exit()");
      expect(res.success).toBe(false);
    });
  });
});
