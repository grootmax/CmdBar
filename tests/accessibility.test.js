import fs from "fs";
import path from "path";
import { execSync } from "child_process";

describe("Dedicated Accessibility CI Workflow & Report Artifacts", () => {
  const rootDir = process.cwd();
  const reportDir = path.join(rootDir, "reports", "accessibility");
  const jsonReportPath = path.join(reportDir, "accessibility-report.json");
  const htmlReportPath = path.join(reportDir, "accessibility-report.html");
  const workflowPath = path.join(
    rootDir,
    ".github",
    "workflows",
    "accessibility.yml",
  );
  const prManagerPath = path.join(
    rootDir,
    ".github",
    "workflows",
    "auto-pr-manager.yml",
  );

  beforeAll(() => {
    // Run accessibility audit script locally to generate fresh reports
    execSync("npm run test:a11y", { cwd: rootDir });
  });

  test("Local build configuration and scripts include WCAG accessibility audit target", () => {
    const pkgPath = path.join(rootDir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

    expect(pkg.scripts).toHaveProperty("test:a11y");
    expect(pkg.scripts).toHaveProperty("a11y");
    expect(pkg.scripts["test:a11y"]).toContain("scripts/audit_a11y.js");

    const makefilePath = path.join(rootDir, "Makefile");
    const makefileContent = fs.readFileSync(makefilePath, "utf8");

    expect(makefileContent).toContain("a11y:");
    expect(makefileContent).toContain("npm run test:a11y");
  });

  test("Dedicated accessibility CI workflow file must exist and trigger on pull requests", () => {
    expect(fs.existsSync(workflowPath)).toBe(true);

    const workflowContent = fs.readFileSync(workflowPath, "utf8");
    expect(workflowContent).toContain("name: Accessibility");
    expect(workflowContent).toContain("pull_request:");
    expect(workflowContent).toContain("accessibility-audit-report");
    expect(workflowContent).toContain("reports/accessibility/");
  });

  test("Accessibility audit generates valid JSON and HTML report artifacts", () => {
    expect(fs.existsSync(jsonReportPath)).toBe(true);
    expect(fs.existsSync(htmlReportPath)).toBe(true);

    const jsonContent = fs.readFileSync(jsonReportPath, "utf8");
    const report = JSON.parse(jsonContent);

    expect(report).toHaveProperty("timestamp");
    expect(report).toHaveProperty("status");
    expect(report.status).toBe("PASSED");
    expect(report).toHaveProperty("summary");
    expect(report.summary).toHaveProperty("totalPagesAudited");
    expect(report.summary.totalPagesAudited).toBeGreaterThan(0);
    expect(report.summary).toHaveProperty("totalViolations", 0);
    expect(report).toHaveProperty("pages");
    expect(Array.isArray(report.pages)).toBe(true);

    const htmlContent = fs.readFileSync(htmlReportPath, "utf8");
    expect(htmlContent).toContain("Accessibility Compliance Audit Report");
    expect(htmlContent).toContain("PASSED");
    expect(htmlContent).toContain("Total Pages");
  });

  test("Automated PR manager detects and enforces accessibility workflow status check", () => {
    expect(fs.existsSync(prManagerPath)).toBe(true);

    const prManagerContent = fs.readFileSync(prManagerPath, "utf8");
    expect(prManagerContent).toContain("A11Y_CHECK");
    expect(prManagerContent).toContain('contains("accessibility")');
    expect(prManagerContent).toContain(
      "Blocking merge due to accessibility compliance failure",
    );
  });
});
