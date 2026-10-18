# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Note:** While in 0.x, any minor release may change command options or JSON fields. Read this file before upgrading.

---

## [0.1.0] - 2026-10-19

First release.

### Added

- `feedback export` writes thumbs-up and thumbs-down ratings from Langfuse, each with the question and answer it was given on, to Excel, CSV or JSON.
- `feedback export --format eval-report` writes the thumbs-down as one `eval-report/v1` file (suite `live-feedback`, `provenance.source = production-review`, a risk area per row), always masked, so real failures can become regression cases in eval-dashboards.
- `live-vs-offline` compares an offline eval report with that live file, risk area by risk area.
- `feedback report`, `analyse` (themes from a model you choose), `compare` (two reports, what is still negative), `docs` (answers from the bundled docs) and `doctor` (checks, each with a fix command).
- Saved queries with rules and exit codes (0 pass, 1 rule failed, 2 could not check), `--json` on the commands a script uses, and `--fail-if-empty` (exit 3).
- A browser setup page (`jeves ui`) on 127.0.0.1 with a token: guided setup, Reports with a sortable table and exports, Docs with search, and window presets that stay highlighted.
- `--demo` runs every command on built-in sample data with no account, keys or config file.
- Personal details are masked by default: user ids become codes, and emails, phone numbers, card numbers, IBANs and National Insurance numbers in the text are replaced.
- Example pipelines for GitHub Actions and Azure DevOps, and a skill and agent prompt for setting the tool up with a coding agent.

### Security

- Reads from Langfuse only. Contacts only the configured Langfuse address and, for `docs` and `analyse`, the configured model address. No telemetry.
- Keys are never printed or written. Tested by planting marker keys and searching every output and file.
- Output files are owner-only, written through a temporary file, and never through a symbolic link.
- The page server refuses a missing or wrong token, a foreign Host header and a foreign Origin, sends no-store, no-sniff, no-frame and no-referrer headers, and runs at most 4 commands at once (more waiting requests get `503`). A request path it cannot parse gets `500` and the server keeps running.
- Dependency audit is clean (`pnpm audit --prod`).

### Known limits

- The Excel library (`exceljs`) is copied into the program file, which keeps `npm audit` at 0 findings for installers. One of its small helpers, `buffers@0.1.1`, declares no licence; its code is included as is. The maintainer accepted this on 2026-10-19.

- Tested against a hand-built Langfuse and a fake model, and also against a real Langfuse v4.63.0 started from Langfuse's own compose file (GitHub Actions job `Real Langfuse`: seeds two chat turns over OpenTelemetry and three scores, then checks the doctor, the export, the masking and the eval report). Not yet tested against Langfuse Cloud or a v3 server (the tool needs v4 or later).
- See "What this tool does not do" in the README.
