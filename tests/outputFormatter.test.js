import {
  detectFormat,
  parseCsvLine,
  parseCsvOrTsv,
  formatTable,
  formatJson,
  formatCodeBlock,
  formatOutput,
} from '../extension/outputFormatter.js';

describe('Output Parser & Formatter Module Tests', () => {
  describe('Format Auto-Detection (detectFormat)', () => {
    test('should detect JSON objects and arrays', () => {
      expect(detectFormat('{"name": "cmdbar", "version": 1}')).toBe('json');
      expect(detectFormat('  [1, 2, 3, "test"]  ')).toBe('json');
      expect(detectFormat('```json\n{"a": 123}\n```')).toBe('json');
    });

    test('should detect CSV output', () => {
      const csvData = 'Name,Age,Role\nAlice,30,Engineer\nBob,25,Designer';
      expect(detectFormat(csvData)).toBe('csv');
    });

    test('should detect TSV output', () => {
      const tsvData = 'Name\tAge\tRole\nAlice\t30\tEngineer\nBob\t25\tDesigner';
      expect(detectFormat(tsvData)).toBe('tsv');
    });

    test('should detect code blocks and programming code', () => {
      expect(detectFormat('function buildApp() {\n  return true;\n}')).toBe('code');
      expect(detectFormat('class Runner {\n  constructor() {}\n}')).toBe('code');
      expect(detectFormat('import fs from "fs";')).toBe('code');
      expect(detectFormat('```bash\necho "hello"\n```')).toBe('code');
    });

    test('should fall back to plain text for unformatted strings', () => {
      expect(detectFormat('Command executed successfully.')).toBe('text');
      expect(detectFormat('')).toBe('text');
      expect(detectFormat(null)).toBe('text');
      expect(detectFormat(undefined)).toBe('text');
    });
  });

  describe('CSV & TSV Parsing and Table Formatting', () => {
    test('should parse CSV lines with quoted commas correctly', () => {
      const line = '1, "hello, world", active';
      const cells = parseCsvLine(line, ',');
      expect(cells).toEqual(['1', 'hello, world', 'active']);
    });

    test('should parse multi-line CSV and TSV into rows', () => {
      const csv = 'Col1,Col2\nVal1,Val2';
      expect(parseCsvOrTsv(csv, ',')).toEqual([
        ['Col1', 'Col2'],
        ['Val1', 'Val2'],
      ]);

      const tsv = 'Col1\tCol2\nVal1\tVal2';
      expect(parseCsvOrTsv(tsv, '\t')).toEqual([
        ['Col1', 'Col2'],
        ['Val1', 'Val2'],
      ]);
    });

    test('should render aligned ASCII table view for CSV/TSV', () => {
      const csv = 'Name,Status,Count\nAPI Service,Running,42\nDatabase,Stopped,0';
      const table = formatTable(csv, { delimiter: ',' });

      expect(table).toContain('+-------------+---------+-------+');
      expect(table).toContain('| Name        | Status  | Count |');
      expect(table).toContain('| API Service | Running | 42    |');
      expect(table).toContain('| Database    | Stopped | 0     |');
    });

    test('should handle empty or single-row tables gracefully', () => {
      expect(formatTable('')).toBe('');
      const singleRow = formatTable('Header1,Header2');
      expect(singleRow).toContain('| Header1 | Header2 |');
    });
  });

  describe('JSON Formatting and Syntax Highlighting', () => {
    test('should pretty-print raw JSON string with 2-space indentation', () => {
      const raw = '{"a":1,"b":[2,3]}';
      const formatted = formatJson(raw);
      expect(formatted.text).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
      expect(formatted.data).toEqual({ a: 1, b: [2, 3] });
    });

    test('should generate Pango markup syntax highlighting for GNOME Shell', () => {
      const jsonStr = '{"status": "ok", "code": 200, "flag": true, "extra": null}';
      const formatted = formatJson(jsonStr);

      expect(formatted.markup).toContain('<font face="monospace">');
      expect(formatted.markup).toContain('<span foreground="#3584e4">&quot;status&quot;</span>'); // Key
      expect(formatted.markup).toContain('<span foreground="#2ec27e">&quot;ok&quot;</span>'); // String
      expect(formatted.markup).toContain('<span foreground="#e66100">200</span>'); // Number
      expect(formatted.markup).toContain('<span foreground="#9141ac">true</span>'); // Boolean
      expect(formatted.markup).toContain('<span foreground="#9141ac">null</span>'); // Null
    });

    test('should generate ANSI color codes for terminal output', () => {
      const jsonStr = '{"key": "val", "num": 5}';
      const formatted = formatJson(jsonStr);

      expect(formatted.ansi).toContain('\x1b[34m"key"\x1b[0m'); // Blue key
      expect(formatted.ansi).toContain('\x1b[32m"val"\x1b[0m'); // Green string
      expect(formatted.ansi).toContain('\x1b[33m5\x1b[0m'); // Yellow number
    });
  });

  describe('Monospace Code Block Formatting', () => {
    test('should render boxed ASCII code block and monospace markup', () => {
      const code = 'const a = 1;\nconst b = 2;';
      const formatted = formatCodeBlock(code);

      expect(formatted.text).toContain('┌');
      expect(formatted.text).toContain('│ const a = 1;');
      expect(formatted.text).toContain('└');
      expect(formatted.markup).toBe('<font face="monospace">const a = 1;\nconst b = 2;</font>');
    });
  });

  describe('Main formatOutput Parser', () => {
    test('should auto-detect and format JSON output', () => {
      const raw = '{"user": "alice", "roles": ["admin"]}';
      const res = formatOutput(raw);

      expect(res.format).toBe('json');
      expect(res.data).toEqual({ user: 'alice', roles: ['admin'] });
      expect(res.text).toContain('"user": "alice"');
      expect(res.markup).toContain('<font face="monospace">');
    });

    test('should auto-detect and format CSV table output', () => {
      const raw = 'ID,Name\n101,Alpha\n102,Beta';
      const res = formatOutput(raw);

      expect(res.format).toBe('csv');
      expect(res.data).toEqual([
        ['ID', 'Name'],
        ['101', 'Alpha'],
        ['102', 'Beta'],
      ]);
      expect(res.text).toContain('| ID  | Name  |');
    });

    test('should auto-detect and format TSV table output', () => {
      const raw = 'Key\tValue\nHost\tlocalhost\nPort\t8080';
      const res = formatOutput(raw);

      expect(res.format).toBe('tsv');
      expect(res.text).toContain('| Key  | Value     |');
    });

    test('should auto-detect and format code output', () => {
      const raw = 'function test() {\n  return 1;\n}';
      const res = formatOutput(raw);

      expect(res.format).toBe('code');
      expect(res.text).toContain('│ function test() {');
    });

    test('should allow explicit format override', () => {
      const raw = '{"a": 1}';
      const res = formatOutput(raw, { format: 'text' });

      expect(res.format).toBe('text');
      expect(res.text).toBe('{"a": 1}');
    });
  });
});
