# langfuse-reporter plan

## Goal

A package any company that uses Langfuse can use to query, report on and analyse its Langfuse data. The command is `jeves`.

## Problem

Langfuse stores traces, observations and scores. Answering "what did users rate badly, and what did they ask?" means joining a score to the exact question and answer it rates. The v2 observations API returns rows, not whole traces, so every team writes this join by hand. Langfuse's own CLI, MCP server and Metrics API cover raw access, cost and latency. They do not give a business report.

## What it does

A CLI for chat-feedback setups: Langfuse client, query language (DSL), config "conventions", Excel export, comparison, LLM analysis (litellm, openai, anthropic, gemini), interactive shell.

## Scope

MVP:
1. Typed library over Langfuse v2 observations, v3 scores and v2 metrics: paging, time windows, size limits, retries.
2. Join layer: link each score to the question and answer it rates.
3. One preset, chat feedback, with configurable names. Split it out of the core.
4. `doctor`: report what the Langfuse project is missing for the preset.
5. Output: JSON, CSV, Excel.
6. Masking of user ids and chat text, on by default, before any export or model call.
7. CLI runs saved queries and returns exit codes for CI.
8. Demo mode with sample data, and a "bring your own schema" guide.

Later: RAG and agent tool-call presets, period compare (counts and confidence ranges), problem clustering through LiteLLM, Markdown reports, push flagged items to Langfuse datasets or annotation queues.

Cut: other data sources, separate Bedrock and Azure adapters (use LiteLLM or an OpenAI-compatible endpoint), dashboards, our own MCP server, p-value tests. The UI is not a dashboard for trace data; it only configures and checks setup. The interactive shell stays as an optional extra.

## Adapters

Only two seams are worth the cost: the preset (what a turn, rating and field are) and the model provider. Masking is a pipeline step, not an adapter. No data-source interface until a second source exists.

## Overlap with Langfuse (checked against langfuse.com docs)

- Metrics API v2 covers cost, tokens, latency and score aggregates. Available on Cloud; self-hosted needs v4+.
- Official `langfuse-cli` wraps the whole public API (changelog 2026-02-17).
- Native MCP server exposes read and write tools.
- Gap this package fills: score-to-turn join, presets, masking, Excel for non-engineers, problem summaries, CI gates.

## Setup UI (separate package)

A small local web app that configures the CLI. It never replaces the CLI: the CLI stays the source of truth and works alone.

How it fits:
- The UI reads and writes the same config file the CLI uses. The CLI's zod schema is the only definition of valid config. It is exported as JSON Schema (`z.toJSONSchema`), so the UI never duplicates rules.
- The CLI gets a `jeves config schema` command and a `jeves config check --json` command. The UI calls these (or a thin local server that wraps them) to validate and to run `doctor`.
- The server binds to localhost only. API keys stay in the env files; the UI shows only their paths and never reads or sends their values.
- It lives in its own package (for example `ui/`), so the CLI keeps its small install.

What the UI does:
1. Profile editor: Langfuse address, env file path, active profile.
2. Conventions editor: turn name, rating score, reason prefix and reason lists, yes values, labels. Live validation from the schema.
3. Doctor view: run `doctor` and show what the Langfuse project is missing, with a fix hint per item.
4. Flow canvas: shows how a score links to its question and answer (score, trace, observation, turn), so people can see what their names must match.
5. Saved queries: build, name and test a query, and show the matching row count.
6. Model setup: provider, model, gateway address, with the masking and opt-in settings made obvious.

Packages (all open source, checked on npm on 2026-10-16, weekly downloads):
- React with Vite (195M): app and dev server.
- motion, the current name of Framer Motion (25M for `motion`, 51M for `framer-motion`, both at 14.3.0): page and panel transitions, step changes.
- @xyflow/react, React Flow (14M): the flow canvas.
- react-hook-form (54M) with its zod resolver: forms.
- @rjsf/core, React JSON Schema Form (1.3M): the fallback that renders any settings block straight from the JSON Schema, so a new config field appears without UI work. Smaller than the others but the standard for schema-driven forms.
- @tanstack/react-query (65M): calls to the local server and loading states.
- @monaco-editor/react (7M): editor for the query language, with the existing completion logic.
- A component kit such as shadcn/ui on Radix UI, plus Tailwind: accessible form parts.

Rules:
- No second copy of the config rules. If the UI needs a rule, it comes from the schema.
- Do the CLI half first: schema export and JSON output of `config check` and `doctor`. The UI starts after step C.
- Same privacy rules as the CLI: nothing from a trace is shown unmasked by default.

## Family of agent-trust tools (eval-dashboards and this package)

Both are owned by the same person. They start separate and meet through files, not code. Checked against `~/Projects/eval-dashboards` (v0.7.0, main) on 2026-10-16.

The two cover different times in an agent's life:
- eval-dashboards: before release. Offline eval runs become a JSON artifact (`eval-report/v1`), then dashboards, quality gates, history and publishing.
- langfuse-reporter: after release. Live user feedback in Langfuse becomes a report that links each rating to the question and answer.
- Gap between them: exceptions (tool errors, timeouts, blocked answers, retries). Neither reports on them as a first-class item today. eval-dashboards rows already carry `toolCalls[].resultIsError`, so the vocabulary exists on the offline side.

What to learn from eval-dashboards:
1. Artifact is the API. Its core never calls a model or the network in `report` or `check`. We do the same: the CLI writes a versioned file first (see "Report file" below), and every output (Excel, HTML, UI) reads that file.
2. Ship a JSON Schema file (`schemas/eval-report-v1.schema.json`). Ours should be generated from the zod schema so there is one source of truth. This also feeds the Setup UI.
3. Gates are pure functions over a report, with exit codes. Our saved queries with CI exit codes should use the same shape (a threshold, a result, a message), so the two tools can read each other's policy.
4. A shared taxonomy instead of free text. It has `RiskArea` (compliance, pii, content-safety, tool-use, factuality, groundedness and others), `severity`, and row `provenance` that already includes `production-review` and `incident`. Our reason lists should map onto `RiskArea` and `severity` so a thumbs-down reason like `wrong_answer` lines up with `factuality`.
5. Redaction is a flag in the artifact (`configSnapshot.redacted`), and the HTML renderer has its own redaction pass. Our masking step should also write "masked: true" and the rule set used into the report file.
6. Distribute with an agent skill (`skills/eval-dashboards-adopt/SKILL.md`, installable with `npx skills add`). Its own metrics show the schema-first approach alone did not bring users (27 weekly downloads, 0 external runner adoptions on 2026-08-31). So ship a skill with the CLI from the start: "point an agent at your Langfuse project and get `doctor` plus a first report".
7. `expectedOutcome` and the planned amber "needs investigation" state. Our reports need the same third state for items a human has not judged yet.
8. Written rules for where logic must not go (`docs/ARCHITECTURE.md`: thin CLI, no vendor prompts in core, no network in report). Copy that file's habit: one short architecture note per package.
9. Housekeeping lessons: pnpm 11 needs `allowBuilds` (the old key is ignored silently); keep a completion checklist file; keep a ROADMAP and a STATUS file.

Ways they can work together later (none needed for the MVP):
- Feedback to eval cases: export negative production ratings as `eval-report/v1` rows with `provenance.source = production-review`, so real failures become regression cases in eval-dashboards.
- Eval to production: after a release, compare the offline pass rate with the live thumbs-down rate for the same risk area.
- One combined view: eval-dashboards renders a "live feedback" suite next to its offline suites, from our report file.
- Shared pieces, extracted only when both tools really need them: the masking rules, the report envelope (run id, window, tool version, masked flag), and the taxonomy mapping. Rule: extract after two real consumers exist, not before.
- Possible exceptions tool: a third package that turns tool errors, timeouts and guardrail blocks from Langfuse traces into the same report envelope. Decide after the first two share a format.

Rules for the family:
- Files and schemas are the only link at first. No code import between the two repos.
- Same privacy rules everywhere: mask by default, record what was masked, nothing unmasked leaves the machine without an opt-in.
- Same shape: TypeScript, ESM, pnpm, vitest, thin CLI over a library, offline by default.

## Report file (new, needed for the family and the UI)

A versioned JSON file the CLI writes after loading and masking: `langfuse-report/v1`. It holds the run (window, profile, tool version, masked flag), the rows (rating, reasons, comment, question, answer, trace link), and counts. All outputs read it. It needs a JSON Schema generated from zod. A converter to `eval-report/v1` lives in a later step (E or later), once the file is stable.

## Tracking over time (decided: files, not Redis)

Two independent reviews (claude-opus-5-5 and claude-fable-5-1, 2026-10-18) both advised against Redis. The tool is a one-shot CLI with no shared state, and a cache of API pages would hold customer text before masking. The decision: keep history in files, as eval-dashboards does.

- History file: one line of counts per run, in an append-only file (NDJSON, one JSON object per line). Each line holds the query name, window, counts, negative rate, rule results, exit code, tool version and the masked flag. It holds no customer text. `jeves query run --history <file>` adds a line. The file is readable by its owner only.
- Trend rules in `query run` (for example "negative rate up by no more than 5 points on last week") read that file. With no earlier line to compare, the rule exits 2 (could not check), never a pass.
- `compare` reads two report files (`langfuse-report/v1`) instead of two Excel files.
- User codes change on every run because the mask salt is random. A per-user trend needs a deliberate choice first (a stable salt kept in a private file). Do not add it by default.
- No page cache until a slow run has been measured. If one is ever added: masked rows only, a file readable by its owner only, an expiry time, behind one `PageStore` interface.
- SQLite (`node:sqlite`, built in to Node and marked release candidate in its docs) is the next step if history files become slow to scan. Not needed yet.
- Revisit Redis only for a hosted, multi-user service (several workers sharing one job queue or live shared views). Then use it as a cache or queue behind the same interface, never as the main record, and prefer Valkey (the BSD-licensed fork) to avoid AGPL questions.

## Order of work

A. Green tests.
B. Split core from feedback preset; remove finance wording from defaults.
C. JSON and CSV output, masking, saved queries with exit codes.
D. Demo mode, docs, contract tests against recorded API responses.
E. Compare and clustering.
F. Setup UI (after C): schema export and JSON output from the CLI, then the UI package.
G. Report file `langfuse-report/v1` with schema, the history file and trend rules (see Tracking over time); agent skill for adoption (can start once C is done).
H. Family bridges: feedback to eval rows, taxonomy mapping.
I. Decide on publishing.

## Risks

- v2 API needs Cloud or self-hosted v4+. A v3 fallback is unplanned.
- API page limits slow large windows.
- Presets break silently if names differ; `doctor` must be strict.
- Sending traces to an outside model is a privacy risk: opt-in, mask first, log what was sent.
- Langfuse ships fast and may absorb features; keep the package thin.
- Name "jeves" may clash with an existing project; check before publishing.
