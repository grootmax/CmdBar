import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import pa11y from 'pa11y';

function findChromeExecutable() {
    if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
        return process.env.CHROME_BIN;
    }
    const candidatePaths = [
        '/bin/google-chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
    ];
    for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }
    return undefined;
}

function findHtmlFiles(dir, fileList = []) {
    if (!fs.existsSync(dir)) return fileList;
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
            findHtmlFiles(fullPath, fileList);
        } else if (item.isFile() && item.name.endsWith('.html')) {
            fileList.push(fullPath);
        }
    }
    return fileList;
}

function generateHtmlReport(reportData) {
    const isPass = reportData.status === 'PASSED';
    const statusBg = isPass ? '#166534' : '#991b1b';
    const statusText = isPass ? '#dcfce7' : '#fee2e2';

    let pageDetailsHtml = '';
    for (const page of reportData.pages) {
        const pagePass = page.pass;
        const pageBadgeBg = pagePass ? '#dcfce7' : '#fee2e2';
        const pageBadgeColor = pagePass ? '#166534' : '#991b1b';

        let issuesHtml = '';
        if (page.issues.length > 0) {
            issuesHtml = `
            <table class="issues-table">
                <thead>
                    <tr>
                        <th>Code / Rule</th>
                        <th>Message</th>
                        <th>Context</th>
                        <th>Selector</th>
                    </tr>
                </thead>
                <tbody>
            `;
            for (const issue of page.issues) {
                issuesHtml += `
                    <tr>
                        <td><code>${escapeHtml(issue.code)}</code></td>
                        <td>${escapeHtml(issue.message)}</td>
                        <td><code>${escapeHtml(issue.context || '')}</code></td>
                        <td><code>${escapeHtml(issue.selector || '')}</code></td>
                    </tr>
                `;
            }
            issuesHtml += `
                </tbody>
            </table>
            `;
        } else {
            issuesHtml = '<p class="no-issues">No WCAG accessibility violations detected for this page.</p>';
        }

        pageDetailsHtml += `
            <div class="page-card">
                <div class="page-header">
                    <h3>${escapeHtml(page.documentTitle || 'Untitled')} <span class="page-path">(${escapeHtml(page.filePath)})</span></h3>
                    <span class="badge" style="background-color: ${pageBadgeBg}; color: ${pageBadgeColor};">
                        ${pagePass ? 'PASS' : 'FAIL (' + page.issuesCount + ' issues)'}
                    </span>
                </div>
                ${issuesHtml}
            </div>
        `;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Accessibility Compliance Audit Report</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            background-color: #f8fafc;
            color: #0f172a;
            margin: 0;
            padding: 2rem;
        }
        .container {
            max-width: 1000px;
            margin: 0 auto;
        }
        .header-card {
            background-color: #ffffff;
            border-radius: 8px;
            padding: 1.5rem 2rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            margin-bottom: 2rem;
        }
        .title-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 1rem;
            margin-bottom: 1rem;
        }
        h1 {
            margin: 0;
            font-size: 1.75rem;
            color: #0f172a;
        }
        .status-badge {
            font-size: 0.875rem;
            font-weight: 700;
            padding: 0.5rem 1rem;
            border-radius: 9999px;
            text-transform: uppercase;
        }
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 1rem;
            text-align: center;
        }
        .metric-item {
            background-color: #f1f5f9;
            padding: 1rem;
            border-radius: 6px;
        }
        .metric-value {
            font-size: 1.5rem;
            font-weight: 700;
            color: #1e293b;
        }
        .metric-label {
            font-size: 0.875rem;
            color: #64748b;
        }
        .page-card {
            background-color: #ffffff;
            border-radius: 8px;
            padding: 1.5rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            margin-bottom: 1.5rem;
        }
        .page-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
        }
        .page-header h3 {
            margin: 0;
            font-size: 1.25rem;
        }
        .page-path {
            font-size: 0.875rem;
            font-weight: 400;
            color: #64748b;
        }
        .badge {
            font-size: 0.75rem;
            font-weight: 700;
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
        }
        .issues-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 1rem;
            font-size: 0.875rem;
        }
        .issues-table th, .issues-table td {
            text-align: left;
            padding: 0.75rem;
            border-bottom: 1px solid #e2e8f0;
            vertical-align: top;
        }
        .issues-table th {
            background-color: #f8fafc;
            color: #475569;
        }
        code {
            background-color: #f1f5f9;
            padding: 0.2rem 0.4rem;
            border-radius: 4px;
            font-family: monospace;
            font-size: 0.8rem;
            word-break: break-all;
        }
        .no-issues {
            color: #166534;
            font-weight: 500;
            margin: 0;
        }
        .footer {
            margin-top: 2rem;
            text-align: center;
            font-size: 0.875rem;
            color: #64748b;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header-card">
            <div class="title-row">
                <h1>Accessibility Compliance Audit Report</h1>
                <span class="status-badge" style="background-color: ${statusBg}; color: ${statusText};">
                    ${reportData.status}
                </span>
            </div>
            <p style="color: #64748b; margin-top: 0;">Execution Date: ${escapeHtml(reportData.timestamp)}</p>
            <div class="metrics-grid">
                <div class="metric-item">
                    <div class="metric-value">${reportData.summary.totalPagesAudited}</div>
                    <div class="metric-label">Total Pages</div>
                </div>
                <div class="metric-item">
                    <div class="metric-value" style="color: #166534;">${reportData.summary.totalPagesPassed}</div>
                    <div class="metric-label">Pages Passed</div>
                </div>
                <div class="metric-item">
                    <div class="metric-value" style="color: ${reportData.summary.totalPagesFailed > 0 ? '#991b1b' : '#166534'};">${reportData.summary.totalPagesFailed}</div>
                    <div class="metric-label">Pages Failed</div>
                </div>
                <div class="metric-item">
                    <div class="metric-value" style="color: ${reportData.summary.totalViolations > 0 ? '#991b1b' : '#166534'};">${reportData.summary.totalViolations}</div>
                    <div class="metric-label">Total Violations</div>
                </div>
            </div>
        </div>

        <h2>Audited Components</h2>
        ${pageDetailsHtml}

        <div class="footer">
            <p>Generated by CmdBar Accessibility Audit CI Tool (WCAG 2.1 AA Compliance)</p>
        </div>
    </div>
</body>
</html>`;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function runAudit() {
    const rootDir = process.cwd();
    const buildDir = path.join(rootDir, 'build');

    console.log('==========================================');
    console.log('       CmdBar Accessibility Audit        ');
    console.log('==========================================\n');

    // Ensure build output exists
    if (!fs.existsSync(buildDir)) {
        console.log('Build directory not found. Compiling documentation targets...');
        try {
            execSync('python3 scripts/compile_docs.py', { cwd: rootDir, stdio: 'inherit' });
        } catch (err) {
            console.error('Failed to compile documentation targets before audit:', err.message);
            process.exit(1);
        }
    }

    const htmlFiles = findHtmlFiles(buildDir);
    if (htmlFiles.length === 0) {
        console.log('No HTML files found in build directory. Compiling documentation targets...');
        execSync('python3 scripts/compile_docs.py', { cwd: rootDir, stdio: 'inherit' });
        htmlFiles.push(...findHtmlFiles(buildDir));
    }

    if (htmlFiles.length === 0) {
        console.error('Error: No HTML files found in build directory to audit.');
        process.exit(1);
    }

    console.log(`Found ${htmlFiles.length} HTML files to audit for WCAG compliance:\n`);
    htmlFiles.forEach(f => console.log(` - ${path.relative(rootDir, f)}`));
    console.log('');

    const chromePath = findChromeExecutable();
    const options = {
        standard: 'WCAG2AA',
        chromeLaunchConfig: {
            executablePath: chromePath,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--headless=new', '--disable-dev-shm-usage', '--disable-gpu']
        }
    };

    const pagesResult = [];
    let totalViolations = 0;
    let totalPassed = 0;
    let totalFailed = 0;

    for (const file of htmlFiles) {
        const relPath = path.relative(rootDir, file);
        console.log(`Auditing: ${relPath}...`);
        try {
            const result = await pa11y(file, options);
            const issues = result.issues || [];
            const isPass = issues.length === 0;

            if (isPass) {
                totalPassed++;
                console.log(`  ✓ Passed (0 violations)`);
            } else {
                totalFailed++;
                totalViolations += issues.length;
                console.log(`  ✗ Failed (${issues.length} violation(s))`);
                issues.forEach(i => {
                    console.log(`    - [${i.code}] ${i.message} (${i.selector})`);
                });
            }

            pagesResult.push({
                filePath: relPath,
                documentTitle: result.documentTitle || relPath,
                pass: isPass,
                issuesCount: issues.length,
                issues: issues
            });
        } catch (err) {
            console.error(`  Error running audit on ${relPath}:`, err.message);
            totalFailed++;
            totalViolations++;
            pagesResult.push({
                filePath: relPath,
                documentTitle: relPath,
                pass: false,
                issuesCount: 1,
                issues: [{
                    code: 'AuditError',
                    type: 'error',
                    message: `Audit failed to execute: ${err.message}`,
                    context: '',
                    selector: ''
                }]
            });
        }
    }

    const reportStatus = totalViolations === 0 ? 'PASSED' : 'FAILED';
    const reportData = {
        timestamp: new Date().toISOString(),
        status: reportStatus,
        summary: {
            totalPagesAudited: htmlFiles.length,
            totalPagesPassed: totalPassed,
            totalPagesFailed: totalFailed,
            totalViolations: totalViolations
        },
        pages: pagesResult
    };

    // Write reports to reports/accessibility/
    const reportDir = path.join(rootDir, 'reports', 'accessibility');
    fs.mkdirSync(reportDir, { recursive: true });

    const jsonPath = path.join(reportDir, 'accessibility-report.json');
    const htmlPath = path.join(reportDir, 'accessibility-report.html');

    fs.writeFileSync(jsonPath, JSON.stringify(reportData, null, 2), 'utf8');
    fs.writeFileSync(htmlPath, generateHtmlReport(reportData), 'utf8');

    console.log('\n==========================================');
    console.log(`Audit Summary: ${reportStatus}`);
    console.log(`Total Pages Audited: ${htmlFiles.length}`);
    console.log(`Pages Passed       : ${totalPassed}`);
    console.log(`Pages Failed       : ${totalFailed}`);
    console.log(`Total Violations   : ${totalViolations}`);
    console.log(`Reports generated in ${path.relative(rootDir, reportDir)}:`);
    console.log(` - ${path.relative(rootDir, jsonPath)}`);
    console.log(` - ${path.relative(rootDir, htmlPath)}`);
    console.log('==========================================\n');

    if (totalViolations > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runAudit();
