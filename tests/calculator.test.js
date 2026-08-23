import {
  isCalculatorQuery,
  getCalculatorExpression,
  evaluateMathExpression,
} from '../extension/commandProcessor.js';

describe('Quick Calculator and Eval Feature Unit Tests', () => {
  describe('Calculator Mode Detection (isCalculatorQuery)', () => {
    test('should trigger calculator mode when prefixed with ">"', () => {
      expect(isCalculatorQuery('> 2+2')).toBe(true);
      expect(isCalculatorQuery('>2+2')).toBe(true);
      expect(isCalculatorQuery('> sin(45)')).toBe(true);
    });

    test('should trigger calculator mode when prefixed with "="', () => {
      expect(isCalculatorQuery('= 2+2')).toBe(true);
      expect(isCalculatorQuery('=2+2')).toBe(true);
      expect(isCalculatorQuery('= cos(0)')).toBe(true);
    });

    test('should trigger calculator mode when prefixed with "calc"', () => {
      expect(isCalculatorQuery('calc sin(45)')).toBe(true);
      expect(isCalculatorQuery('CALC 10 * 5')).toBe(true);
      expect(isCalculatorQuery('calc')).toBe(true);
    });

    test('should return false for regular non-calculator search queries', () => {
      expect(isCalculatorQuery('git push')).toBe(false);
      expect(isCalculatorQuery('docker ps')).toBe(false);
      expect(isCalculatorQuery('calculate')).toBe(false);
      expect(isCalculatorQuery('')).toBe(false);
      expect(isCalculatorQuery(null)).toBe(false);
    });
  });

  describe('Calculator Expression Extraction (getCalculatorExpression)', () => {
    test('should extract expression from ">" prefix', () => {
      expect(getCalculatorExpression('> 2+2')).toBe('2+2');
      expect(getCalculatorExpression('>sin(45)')).toBe('sin(45)');
    });

    test('should extract expression from "=" prefix', () => {
      expect(getCalculatorExpression('= 100 / 4')).toBe('100 / 4');
    });

    test('should extract expression from "calc" prefix', () => {
      expect(getCalculatorExpression('calc sin(45)')).toBe('sin(45)');
      expect(getCalculatorExpression('CALC 2^10')).toBe('2^10');
    });
  });

  describe('Safe Math Evaluation (evaluateMathExpression)', () => {
    test('should evaluate basic arithmetic expressions', () => {
      expect(evaluateMathExpression('2+2')).toEqual({
        success: true,
        result: 4,
        formatted: '4',
      });

      expect(evaluateMathExpression('10 - 3 * 2')).toEqual({
        success: true,
        result: 4,
        formatted: '4',
      });

      expect(evaluateMathExpression('(100 - 25) / 5')).toEqual({
        success: true,
        result: 15,
        formatted: '15',
      });
    });

    test('should evaluate exponentiation and modulo', () => {
      expect(evaluateMathExpression('2^3')).toEqual({
        success: true,
        result: 8,
        formatted: '8',
      });

      expect(evaluateMathExpression('2**3')).toEqual({
        success: true,
        result: 8,
        formatted: '8',
      });

      expect(evaluateMathExpression('10 % 3')).toEqual({
        success: true,
        result: 1,
        formatted: '1',
      });
    });

    test('should evaluate mathematical functions (sin, cos, sqrt, abs, etc.)', () => {
      const sinRes = evaluateMathExpression('sin(45)');
      expect(sinRes.success).toBe(true);
      expect(sinRes.result).toBeCloseTo(Math.sin(45));

      const cosRes = evaluateMathExpression('cos(0)');
      expect(cosRes.success).toBe(true);
      expect(cosRes.result).toBe(1);

      const sqrtRes = evaluateMathExpression('sqrt(16) + 3');
      expect(sqrtRes.success).toBe(true);
      expect(sqrtRes.result).toBe(7);

      const absRes = evaluateMathExpression('abs(-42)');
      expect(absRes.success).toBe(true);
      expect(absRes.result).toBe(42);
    });

    test('should support mathematical constants (pi, e, tau, phi)', () => {
      const piRes = evaluateMathExpression('pi');
      expect(piRes.success).toBe(true);
      expect(piRes.result).toBe(Math.PI);

      const eRes = evaluateMathExpression('e');
      expect(eRes.success).toBe(true);
      expect(eRes.result).toBe(Math.E);
    });

    test('should support implicit multiplication', () => {
      const implicitPi = evaluateMathExpression('2pi');
      expect(implicitPi.success).toBe(true);
      expect(implicitPi.result).toBeCloseTo(2 * Math.PI);

      const implicitParen = evaluateMathExpression('2(3 + 4)');
      expect(implicitParen.success).toBe(true);
      expect(implicitParen.result).toBe(14);
    });

    test('should return error status for incomplete or invalid expressions', () => {
      const emptyRes = evaluateMathExpression('');
      expect(emptyRes.success).toBe(false);

      const incompleteRes = evaluateMathExpression('2+');
      expect(incompleteRes.success).toBe(false);

      const invalidCharRes = evaluateMathExpression('2 + alert(1)');
      expect(invalidCharRes.success).toBe(false);
    });
  });
});
