# Agent procedure for Jeves

This page is the same procedure as the `jeves-setup` skill, for agents that read documentation and not skills.

# Set up and use Jeves for a team

Jeves reads the thumbs up and thumbs down that users give an AI agent, from Langfuse, and joins each one to the exact question and answer it rated. This procedure gets a person from nothing to a first report, and keeps their keys and customers' data safe on the way.

## Rules that never bend

- Never open, print, read aloud or paste the contents of an env file or any key. Ask the person to edit key files themselves. You may check that a key exists with `jeves doctor --json`, which reports found or missing and never shows a value.
- Never turn masking off. Do not use `--no-mask`. Exports and the model call hide user ids and common personal details by default.
- Never run a command that sends data to a model (`analyse`, or `docs` with a model set up) without telling the person first what is sent.
- Do not publish, push or share an export file. Exports hold customer questions and answers.
- Run each command, read its real output, and report that output. Do not describe what a command probably does.

## Step 1: try it on sample data

Run `jeves --demo`. It needs no account, no keys and no config file. It runs a check and lists commands that work on the sample data. Then run `jeves --demo feedback report --format json` to see what a rating looks like. If `jeves` is not found, install it with `npm install -g @icodenet/langfuse-reporter`.

## Step 2: set up your own project

The easiest way is the browser page: run `jeves ui` and follow the six pages. It saves each answer through `jeves config set`, so a wrong value is refused with the reason.

If you cannot open a browser, do the same in the shell:
1. `jeves config set profile.baseUrl <address>` for your Langfuse (`https://cloud.langfuse.com`, `https://us.cloud.langfuse.com`, or your own, such as `http://localhost:3000`).
2. Ask the person to create an env file with `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`, then `jeves config set profile.envFile <absolute path>`.
3. `jeves doctor --json` and read every check. Each problem has a `fix` command.
4. `jeves config discover` lists the observation and score names the project uses. Compare them with the defaults (`chat-turn`, `feedback_helpful`, reasons starting `feedback_`) and set any that differ with `jeves config set conventions.turnName <name>`, `conventions.ratingScore <name>` and `conventions.reasonScorePrefix <text>`.
5. Run `jeves doctor --json` again until `failed` is 0. A `[CHECK]` on Ratings that lists score names means the reason prefix or reason list does not match what the app records.

## Step 3: make a first report

1. `jeves feedback export --dry-run` counts the ratings without writing a file. The count can be higher than the export: a rating whose answer Langfuse no longer returns is counted here and left out of the files, and the real run says how many it left out.
2. `jeves feedback export --format csv` writes the files, or use the Reports tab in `jeves ui`.
3. Narrow with `--where`, for example `--where "rating = negative"`. `jeves feedback fields` lists the fields.

## Step 4: use it in a pipeline

`jeves query save <name> --where "<filter>" --rule "negative-rate <= 0.2"` stores a gate, and `jeves query run --all --json` prints the result as JSON. The exit code is 0 when every rule passes, 1 when a rule fails and 2 when it could not check. Use that exit code to fail a build. In a pipeline there is no config file: set `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` in the environment. `jeves feedback export --json` prints the counts and the files written, and `--fail-if-empty` exits 3 when nothing matches.

## Check your work

- `jeves doctor --json` shows `failed: 0`.
- A first export has the number of ratings you expect, and you read the real file list the command printed.
- You did not print, store or send any key.
- Tell the person what you ran and what each command really returned.

## When something fails

- Read the message. Jeves says what is wrong and prints a `Fix:` command.
- `jeves docs <question>` answers from the bundled documentation.
- `jeves --help` and `jeves <command> --help` show short cards.
