# Shared Audit Trail & Compliance Specifications

The Shared Audit Trail module (`extension/auditTrail.js`) provides security logging, compliance reporting, SIEM exports, rule-based anomaly detection, and real-time alerts for enterprise teams.

## Core Features & Architecture

### 1. Tamper-Evident Hash Chaining
Every audit log event includes a cryptographic SHA-256 hash computed over canonical JSON representation of the event linked to the previous event's hash (`GENESIS` for the initial record). Any retroactive modification or deletion of log events breaks the chain and is detected via `verifyLogIntegrity()`.

### 2. GDPR Compliance & PII Scrubbing
- **PII Scrubbing (`scrubPII`)**: Automatically redacts email addresses, IPv4/IPv6 addresses, passwords, API keys, bearer tokens, SSH keys, and custom patterns from audit actions and event metadata before storage or export.
- **Data Retention Policy (`purgeLogsByAge`)**: Automatically purges log entries older than the configured `retentionDays` (default 90 days).
- **Right to Erasure / Anonymization (`anonymizeUser`, `anonymizeUserInLogs`)**: Hashes and replaces user identifiers in historical logs in response to user deletion/anonymization requests.

### 3. Rule-Based Anomaly Detection
The anomaly detection engine (`detectAnomalies`) continuously scans audit events for:
- **BURST_EXECUTION**: Unusually high velocity of actions within a short time window.
- **HIGH_FAILURE_RATE**: Excessive failed executions or errors within a window.
- **DANGEROUS_COMMAND**: Execution of restricted or high-risk shell commands (e.g., `sudo`, `rm -rf /`, `chmod 777`, `mkfs`, `curl | bash`).
- **PROMPT_INJECTION**: AI prompt injection attack signatures (e.g., `ignore previous instructions`, `system prompt:`).
- **OFF_HOURS_ACTIVITY**: Actions performed during non-working hours.
- **TAMPER_ATTEMPT**: Hash chain mismatches or log integrity failures.

### 4. Enterprise Compliance Reports
`generateComplianceReport()` generates audit reports mapped against major security frameworks:
- **SOC2**: Controls CC6.1, CC6.8, CC7.2
- **ISO 27001**: Control A.12.4
- **GDPR**: Articles 17 & 32
- **HIPAA**: §164.312(b) & §164.312(c)(1)

Supported report formats: `JSON`, `Markdown`, `HTML`, and `CSV`.

### 5. SIEM Export Formats
`exportToSIEM()` formats and exports logs to external SIEM platforms:
- **Syslog**: RFC 5424 structured syslog string format
- **Splunk**: Splunk HTTP Event Collector (HEC) JSON structure
- **Elastic**: Elastic Common Schema (ECS) ndjson bulk format
- **Datadog**: Datadog Logs API JSON payload
- **CEF**: Common Event Format (CEF) string layout

### 6. Real-Time Alert Manager
`AlertManager` dispatches security alerts to JS callbacks, system desktop notifications (`notify-send` / `Main.notify`), and external webhooks (Slack/Teams) with a configurable deduplication cooldown window (default 60 seconds).
