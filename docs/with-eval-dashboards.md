# Jeves and eval-dashboards: when to use which, and how they work together

Jeves and eval-dashboards are two tools that help you trust an AI agent. They do not compete. They look at different moments in the life of your agent, and they meet through one file.

## The two moments

| | Before you release | After you release |
|---|---|---|
| The question | Does the new version still pass our tests? | What do real users think of it? |
| The tool | eval-dashboards | Jeves |
| It reads | Eval result files (`eval-report/v1`) from any eval runner | Your Langfuse project: thumbs, reasons, comments, and the chat behind each |
| It gives you | Dashboards, quality gates, a baseline, history and trends, a published report | Excel, CSV and JSON files, common problems found by a model, a browser page for setup and reports |
| Customer text | Never sees it | Reads it, and masks personal details by default |

## Use Jeves when

- You want to know what customers are unhappy about, in their own words.
- You need to export real thumbs-up and thumbs-down, with the question and the answer, for a person to read.
- You want the common problems in a window grouped by a model.
- You want a CI step that fails when complaints rise (`query run`).
- You need personal details masked before anyone sees the data.

## Use eval-dashboards when

- You run offline evals (Promptfoo, DeepEval, your own runner) and want one dashboard for them.
- You want a quality gate before release: pass rate, new failures against a baseline, per-suite rules.
- You want history, trends and baselines over many runs.
- You want to publish a report or hand a signed evidence bundle to a reviewer.
- You want a person to settle rows an evaluator could not judge (`adjudicate`).

## Use them together

1. **Real failures become test cases.** Run `jeves feedback export --format eval-report`. Every thumbs-down becomes a failed row, labelled `production-review`, in a suite for its risk area. Review the rows, keep the good ones, and add them to your offline test set. Next release, eval-dashboards checks that the same failure does not come back.
2. **Compare what you tested with what users saw.** Run `jeves live-vs-offline offline.json live.json`. For each risk area it shows how often your offline evals fail next to the share of real ratings that were a thumbs-down. A risk area where offline passes and users still complain is a gap in your tests.
3. **See both on one dashboard.** Point eval-dashboards at a folder that holds your offline reports and the Jeves file. The live feedback appears as extra suites next to the offline ones.
4. **Trend the live feedback.** Jeves keeps no history. Write the eval report each week and let eval-dashboards build the history.

## Where the tools overlap, and which one is the full version

| Job | Full version | Small version |
|---|---|---|
| Quality gates | eval-dashboards: pass rate, baselines, new failures, per-suite, signed results | Jeves: three live measures (`count`, `negative-count`, `negative-rate`), with an optional `min-ratings` guard |
| Comparing two things | eval-dashboards: eval runs against a baseline | Jeves: two of its own exports, to answer "did the complaints go away?" |

For anything about eval runs, baselines or history, use eval-dashboards. For anything that reads Langfuse or touches customer text, use Jeves.

## One thing to know

eval-dashboards treats the newest file in a folder as the current run. The Jeves file has a 0% pass rate on purpose, because every row is a thumbs-down. If it is the newest file, a plain `check` gates it and judges your offline run against it. Keep the Jeves file in its own folder, or name your offline run with `--run-id`.

## What does not overlap

- Jeves never builds a dashboard, a baseline or a history.
- eval-dashboards never calls Langfuse and never reads customer text.
- Neither tool imports the other's code. The shared contract is the `eval-report/v1` file, and each side checks it.
