# jeves

A command-line tool that turns the thumbs up and thumbs down your users give an AI agent into an Excel file, a table, or a list of common problems. It reads from Langfuse only. It does not touch your application's database.

## What it is for

Reading a month of feedback means opening conversations one by one. This tool does that work for you. It:

1. Downloads the ratings for a period (last month by default).
2. Shows each rating next to the exact question and answer it was given on, with the reasons the user ticked and their comment.
3. Writes two Excel files, thumbs up and thumbs down, or shows a table in the terminal, or asks a model what the common problems are.

You can narrow the results with a small filter language, for example `rating = negative AND category IN (wrong_answer)`. Suggestions appear as you type.

## It depends on how your Langfuse is set up

The tool is opinionated. It only works when your application records:

- one observation named `chat-turn` for every question and answer (input is the question, output is the answer, with a session id shared by the whole conversation);
- every thumb as a score on the `chat-turn` it rated: `feedback_helpful` (true or false) and one `feedback_<reason>` score for each reason ticked.

The reason is simple. A rating stored on a whole trace cannot say which answer it was about, and a second thumb overwrites the first. A rating stored on the turn says exactly what it was about, so the tool never has to guess.

Those names are settings, not code. If your Langfuse uses other names, change them in the config file (`config init`, then edit it, then `config check`) or with `config set conventions.<name>`; a wrong value is reported with where it is. Read [docs/langfuse-setup.md](docs/langfuse-setup.md) first, or ask the tool: `jeves docs <question>` in a shell, or `docs <question>` in the session. It also lists what you see when your setup differs.

## Two places to type commands

You type jeves commands in one of two places. They take different commands, so check which one you are in.

- **In a shell.** Your normal terminal prompt. Every command starts with `jeves`, for example `jeves feedback export --dry-run`.
- **In the session (prompt `jeves[dev]>`).** Run `jeves` with no command to open it. The prompt shows the active profile, here `dev`. Commands here have no `jeves` in front and no `feedback` word, for example `where` or `export`.

The session commands are: `where <filter>`, `window <from> <to>`, `export [where <filter>]`, `report [where <filter>]`, `fields`, `columns`, `analyse [where <filter>]`, `compare <a.xlsx> <b.xlsx>`, `doctor`, `docs [question]`, `config show|check|set|unset|use`, `set`, `unset`, `use <profile>`, `profiles`, `load`, `save`, `clear`, `credits`, `help` and `exit`. Type `?` or `--help` after any of them, for example `window ?`, to see a short card of up to 10 lines.

The same task in each place:

| In a shell | In the session (prompt `jeves[dev]>`) |
| --- | --- |
| `jeves feedback export --dry-run` | `where` |
| `jeves feedback export --from A --to B` | `window A B`, then `export` |
| `jeves feedback export --where F` | `export where F` |
| `jeves feedback report` | `report` |
| `jeves feedback fields` | `fields` |
| `jeves analyse --where F` | `analyse where F` |
| `jeves --profile prod ...` | `use prod` (this changes the active profile, not just one run) |

In the session, anything that is not a command is read as a filter. So a shell command typed there, such as `feedback export --dry-run`, can show up as `Unknown field feedback`. If you paste a shell line by mistake, the session tries to turn it into the session commands above, but it is best to type the session form.

## Before you start

You need:

- **Node and pnpm**, and a checkout of this repository.
- **A Langfuse API key pair** for the project you want to read.
- **A model**, only for the `docs` and `analyse` commands: your LiteLLM gateway, or OpenAI, Anthropic or Gemini.

## Install

From the repository root:

```sh
pnpm install
pnpm link --global
```

The second line puts the `jeves` command on your PATH. If pnpm says there is no global bin directory, run `pnpm setup` once and open a new terminal. `jeves-cli` still works as an alias.

Without that step you can still run it from the repository root as `pnpm jeves <command>`.

## Connect to Langfuse

The tool needs two keys. They go in a small text file called an env file, and the tool is told where that file is.

**1. Create the keys.** In Langfuse open your project, then Settings, then API Keys, then Create new API key. Copy both the public key and the secret key. The secret key is shown only once.

**2. Create the env file.** Put it in this package folder, for example `dev.env`. Any file name ending in `.env` is ignored by git:

```sh
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
```

Keep it private: `chmod 600 dev.env`. Never commit it, paste it into a chat, or put it in a ticket.

**3. Point the tool at it, with an absolute path.** In a shell:

```sh
jeves config set profile.envFile /home/you/repo/dev.env
```

**4. Check which Langfuse you are talking to.** The address is part of the profile, not the env file. The default is the EU cloud, `https://cloud.langfuse.com`. For another region or a self-hosted server, in a shell:

```sh
jeves config set profile.baseUrl https://us.cloud.langfuse.com
```

A key pair opens exactly one project. The tool asks Langfuse which one and prints its name at the start of every run and in every exported file, so check that name, not the profile label.

**5. Try it.** In a shell:

```sh
jeves feedback export --dry-run
```

In the session (prompt `jeves[dev]>`), the same check is just:

```
where
```

You should see the banner, the project name, the search criteria, and lines such as "Found 41 rating scores on 13 traces". If the keys are missing, the message names the file it looked in.

**6. If it does not work, run `doctor`.** In a shell: `jeves doctor`. In the session: `doctor`. It checks each link in turn: config file, profile, env file, keys, output folder, date window, project, ratings and model. Each line says OK, CHECK (works, but look at it), FAIL (broken) or skip (needs an earlier link fixed first). Each problem is followed by a `Fix:` line with a command to paste. It reads from Langfuse but writes nothing.

## Connect a model (for `docs` and `analyse`)

In a shell (in the session, type the same lines without `jeves`):

```sh
jeves config set llm.provider litellm        # litellm | openai | anthropic | gemini
jeves config set llm.baseUrl https://your-gateway.example.com
jeves config set llm.model <model name>
```

Put the key in the same env file as the Langfuse keys:

```sh
LLM_API_KEY=...
```

For `litellm`, use your own virtual key, and set `llm.baseUrl` to your gateway. For `openai`, `gemini` and `anthropic` the address is built in. The tool calls the model over plain HTTP and uses no provider SDK.

## The config file

Everything the CLI remembers is in one JSON file: `~/.config/langfuse-reporter/config.json` (set `LANGFUSE_CLI_CONFIG` to use another path). It never holds secrets; the keys stay in the env file.

Write it with every default, then change what differs for you. In a shell:

```sh
jeves config init       # write the file with every default, ready to edit
jeves config check      # report every wrong value, with where it is
jeves config show       # every setting with its value and what it means
jeves config set conventions.turnName my-turn
jeves config unset conventions.turnName      # back to the default
```

You can edit the file by hand and start the CLI, or change a setting while the session runs: in the session (prompt `jeves[dev]>`) type `config set <key> <value>`, or just `set <key> <value>`, with no `jeves` in front. `config init` is a shell command only. Both ways are checked the same way. A wrong value or an unknown key stops the run and is listed with where it is:

```
The config file ~/.config/langfuse-reporter/config.json has problems:
  - conventions.turnNmae: not a setting. Did you mean "turnName"?
  - conventions.passLabel: must not be empty
  - conventions.reasons[3]: "other_issue" is listed twice
```

### The file we use

Every setting, with a comment on each, is in [docs/config.json.local](docs/config.json.local). Read that file first; the shorter version below is the same setup without the comments. The CLI accepts `//` and `/* */` comments in the config file, but `config set`, `config use` and `config unset` rewrite it as plain JSON and drop them.

This is the default setup, written out in full. `config init` writes the `dev` profile and the `conventions` shown here; add `outDir`, `llm` and more profiles yourself or with `config set` and `config use`. Only the `conventions` section differs between projects; the rest is where to read from and where to write to.

```json
{
  "activeProfile": "dev",
  "outDir": "/home/you/feedback-exports",
  "conventions": {
    "turnName": "chat-turn",
    "ratingScore": "feedback_helpful",
    "reasonScorePrefix": "feedback_",
    "reasons": [
      "wrong_answer",
      "incomplete_answer",
      "off_topic",
      "hard_to_follow",
      "harmful_content",
      "other_issue",
      "well_explained",
      "correct_answer",
      "fast_response",
      "easy_to_follow",
      "useful_detail",
      "on_topic"
    ],
    "yesValues": ["true", "1"],
    "assistantName": "Assistant",
    "passLabel": "Pass",
    "failLabel": "Fail"
  },
  "llm": {
    "provider": "litellm",
    "model": "<model name on your gateway>",
    "baseUrl": "https://your-gateway.example.com"
  },
  "profiles": {
    "dev": {
      "baseUrl": "https://cloud.langfuse.com",
      "envFile": "/home/you/repo/dev.env"
    },
    "prod": {
      "baseUrl": "https://cloud.langfuse.com",
      "envFile": "/home/you/repo/prod.env"
    }
  }
}
```

`outDir` and `llm` are optional, and the whole `conventions` section can be left out: anything missing takes its default. The `envFile` values are paths to files that hold your keys; use absolute paths.

### What each setting means

| Setting | Default | What it is |
| --- | --- | --- |
| `activeProfile` | `dev` | Which profile a run uses. Switch with `config use <name>` or `--profile <name>`. |
| `outDir` | the package's `reports/` folder | Where Excel files are written. |
| `conventions.turnName` | `chat-turn` | Name of the observation that holds one question and answer. |
| `conventions.ratingScore` | `feedback_helpful` | Name of the thumbs score recorded on a turn. |
| `conventions.reasonScorePrefix` | `feedback_` | Text before each reason in its score name. May be empty. |
| `conventions.reasons` | the twelve above | Reasons a user can tick, as they appear after the prefix. They feed the `category` filter. |
| `conventions.yesValues` | `true`, `1` | Score values that mean yes. Any other value on the rating score is a thumbs down. |
| `conventions.assistantName` | `Assistant` | Name in the answer column of the Excel files. |
| `conventions.passLabel`, `failLabel` | `Pass`, `Fail` | Words shown for a thumbs up and a thumbs down. |
| `llm.provider` | not set | `litellm`, `openai`, `anthropic` or `gemini`. Needed for `docs` answers and `analyse`. |
| `llm.model` | not set | Model name as the provider or your gateway names it. |
| `llm.baseUrl` | not set | Gateway address. Required for `litellm`; the others have a built-in address. |
| `profiles.<name>.baseUrl` | `https://cloud.langfuse.com` | Langfuse address for that environment. |
| `profiles.<name>.envFile` | not set | File holding `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and, for models, `LLM_API_KEY`. |

### Making it fit a different Langfuse

If your project records feedback differently, change only `conventions`. For example, a project whose turns are called `assistant-turn`, whose thumbs score is `thumbs` with the value `yes`, and whose reasons are named `why.wrong` and `why.slow`:

```json
"conventions": {
  "turnName": "assistant-turn",
  "ratingScore": "thumbs",
  "reasonScorePrefix": "why.",
  "reasons": ["wrong", "slow"],
  "yesValues": ["yes"],
  "assistantName": "Aria"
}
```

The same change from the command line, in a shell:

```sh
jeves config set conventions.turnName assistant-turn
jeves config set conventions.ratingScore thumbs
jeves config set conventions.reasonScorePrefix "why."
jeves config set conventions.reasons "wrong, slow"
jeves config set conventions.yesValues yes
```

Why each of these matters is in [docs/langfuse-setup.md](docs/langfuse-setup.md).

## Everyday use

In a shell:

```sh
jeves                                     # open the interactive session
jeves --demo feedback export              # try it on built-in sample data, no Langfuse needed
jeves feedback export                     # last month, both Excel files
jeves feedback export --dry-run           # count only, write nothing
jeves feedback export --from 2026-08-01 --to 2026-09-01
jeves feedback export --where 'rating = negative AND has_comment = true'
jeves feedback export --format json       # JSON files instead of Excel (or --format csv)
jeves feedback export --no-mask           # keep user ids and personal details (default: masked)
jeves feedback report                     # read the ratings full screen
jeves feedback report --format csv        # print CSV to the screen or a pipe (or --format json)
jeves feedback shell                      # the interactive session, same as plain `jeves`
jeves feedback suggest 'rating = '        # what can come next in a filter (no network)
jeves feedback fields                     # every filter field and its values
jeves compare before.xlsx after.xlsx      # did the problems go away?
jeves doctor                              # check the setup, print a fix for each problem
jeves soul                                # a short picture tour of the tool
jeves --version                           # the version
jeves --help                              # all commands, and the profiles you have
```

In the session (prompt `jeves[dev]>`), the same work looks like this. The session loads last month when it opens:

```
where                                          # show the loaded ratings as a table
where rating = negative AND has_comment = true # only these
window 2026-08-01 2026-09-01                   # other dates (the end date is not included)
export                                         # both Excel files
export where rating = negative                 # only these (the word "where" is needed)
report                                         # read the ratings full screen
fields                                         # every filter field and its values
help                                           # every command; add ? after one for its card
exit                                           # leave the session
```

Output formats: `feedback export` writes Excel by default. `--format json` or `--format csv` writes `feedback-positive-<name>.json` (or `.csv`) and `feedback-negative-<name>.json` instead, with the same positive and negative split. `feedback report --format json|csv` prints the rows to the screen instead of opening the reader, so a script can read them. The JSON and CSV rows hold the time, rating, reasons, comment, environment, trace, session and observation ids, turn number, question and answer. They leave out the user id and the full conversation. Files are readable by you only.

Large runs: over 5000 ratings, `--yes` goes ahead without stopping. A run that would be refused as too large for the machine (over 25000 ratings) needs `--force-large`. `analyse --yes` sends more than 600 ratings to the model.

`feedback suggest <partial filter>` prints what can come next after a half-typed filter, without calling Langfuse. `feedback shell` opens the same interactive session as running `jeves` with no command. `soul` prints a short picture tour of the tool.

`report` opens a full-screen reader (a pager, like `less`). Move with j/k or the arrow keys, Space and b for a page, g and G for the top and bottom. Search with `/text`, then n and N for the next and previous match. Leave with q, Esc or `:q`.

`compare` takes two exported reports and writes one workbook with three sheets: the before report, the after report, and a comparison of each question (still negative, improved, got worse, or new problem). It reads files only and does not call Langfuse.

In the interactive session, `clear` clears the screen and forgets the `docs` conversation. `docs` remembers the last few questions of the session, so a follow-up like "and how do I change that?" works; `jeves docs "..."` from the shell is always a single question. Typing `docs` alone in the session opens a chat mode (prompt `docs>`) where every line is a question: `done` goes back to the session, and `exit` or `quit` leaves the program.

`credits` (or `/credits`) shows who built the tool: Byron Thanopoulos (IcodeNet), byronth@gmail.com.

Files are written to `reports/`. The file name holds the dates and the filter, so a different filter never overwrites another export. If one side has no ratings, for example no thumbs up, that file is not written. Change the folder with `--out <folder>` or `jeves config set outDir <folder>` in a shell, or `set outDir <folder>` in the session.

Every command shows the banner first, so you can see the profile, the Langfuse address and the date window. Every step it takes is reported on screen, including when Langfuse asks it to slow down. On a terminal each step has its own emoji and colour; in a pipe or CI the output is plain text.

## Try it without Langfuse (demo mode)

`--demo` runs a command on about 60 built-in sample ratings, so you can see every output before you connect a real project. Nothing is read from Langfuse, and no keys, env file or config file are needed. The banner says `DEMO` and the project is named `SAMPLE DATA (demo)`.

```sh
jeves --demo feedback export --out /tmp/demo     # Excel files from the sample data
jeves --demo feedback report --format csv        # print the sample rows
jeves --demo analyse --out /tmp/demo             # groups the sample ratings by reason; no model is called
jeves --demo query run --all                     # two sample queries with rules
jeves --demo doctor                              # checks the built-in setup
```

The sample data includes made-up email addresses (example.com), phone numbers and a test card number, so you can watch the masking replace them. The same data comes out on every run. Commands that change or check the config file (`config set`, `config init`, `config check`, `config use`, `query save`, `query remove`) and the interactive session refuse `--demo` and exit with code 2, so a demo can never change your real settings.

## Saved queries for CI

A saved query is a named entry in the config file: a filter, a window and rules. `jeves query run` checks the rules and sets an exit code a pipeline can act on, so a rising complaint rate fails a build.

```sh
jeves query save weekly-health --window 7d --rule "negative-rate <= 0.2" --rule "count >= 50"
jeves query save no-harm --window 7d --where "category IN (harmful_content)" --rule "count <= 0"
jeves query list                      # what is saved
jeves query run weekly-health         # one line per rule, on the screen
jeves query run --all --json          # every query, as JSON on the screen
jeves query remove no-harm            # delete one
```

- `--window` takes today, yesterday, a number of days such as 7d or 14d, this-week, last-week, this-month or last-month. Without it the query uses last month.
- A rule is a measure, a comparison and a number. Measures: `count` (ratings that match the filter), `negative-count` (matching ratings that are negative) and `negative-rate` (matching negatives divided by every rating in the window, from 0 to 1). Comparisons: `<=`, `>=`, `<`, `>` and `=`.
- Exit codes: **0** every rule passed, **1** a rule failed, **2** the check could not be made (bad config, missing keys, Langfuse not reachable, unknown query name, or a `negative-rate` over a window with no ratings). Code 2 is kept apart from 1 so a broken setup never looks like a clean pass or a false failure. With `--all` the worst result wins: 1, then 2, then 0.
- `--json` prints `{ exit, queries: [...] }` on the screen. Progress and warnings go to the error stream, so the JSON stays clean in a pipe.
- A query with no rules only counts and exits 0. `--yes` goes ahead with a window of over 5000 ratings.
- The filter is checked when you save, so a typo fails there and not in CI. Queries are stored under `queries` in the config file; `jeves query save` and `jeves query remove` rewrite the file as plain JSON, which removes any comments.

## More than one environment

A profile is a named set of settings: Langfuse address and env file.

In a shell:

```sh
jeves config use prod --base-url https://cloud.langfuse.com   # create and switch
jeves config set profile.envFile /abs/path/prod.env
jeves config use dev                                          # switch back
jeves --profile prod feedback export --dry-run                # one run, other profile
```

In the session (prompt `jeves[dev]>`), `use prod` switches profile and loads its ratings. There is no one-run `--profile` there: `use` changes the active profile, and the prompt changes to `jeves[prod]>`. `profiles` lists the profiles and marks the active one.

Each profile reads its own env file, so keys never mix between profiles. Settings are saved in `~/.config/langfuse-reporter/config.json` (override the location with `LANGFUSE_CLI_CONFIG`). That file holds no secrets.

## Turn on the prod profile

Production is a second, separate profile with its own keys. Prod holds real customer conversations, so take the extra care in step 4.

**1. Create read keys in the production Langfuse project.** Settings, API Keys, Create new API key. Use a key pair made for this purpose, and do not reuse the one from dev.

**2. Save them in a separate env file**, for example `prod.env`, and `chmod 600` it.

**3. Create the profile.** The first command creates `prod` and makes it active. In a shell:

```sh
jeves config use prod --base-url <prod langfuse address>
jeves config set profile.envFile /abs/path/prod.env
```

**4. Check before you export.** In a shell, run `jeves --profile prod doctor`, then `jeves feedback export --dry-run`. In the session, type `use prod`, then `doctor` and `where`. None of these writes anything. Read the project name it prints and confirm it is the production one. Only then run a real export.

When the profile or the project is named like production, every run prints a `PRODUCTION` warning naming both, and in the session the prompt turns red.

If the first run fails with 401, the keys belong to a different project or region than the address in the profile.

## Reading the Excel files

- **Result** is Pass for a thumbs up and Fail for a thumbs down.
- **Question** and **Answer** are the input and output of the rated turn.
- **Turn #** is the position of that answer in its conversation, oldest first.
- **Trace link** opens the trace in Langfuse with the rated answer selected.
- **Full conversation** shows every turn, with the rated one marked.
- The second sheet, **Method and caveats**, states the project, the date window, the filter and the row count.
- The **Config and filters** sheet lists the profile, the date window, the filter and the naming settings used, plus the shell command that makes the same report again. The Langfuse keys are never written into it.
- Times are UTC. The Langfuse screen shows local time.

## Why the ratings are requested twice

A run asks Langfuse for the scores two times (two score requests, not merged into one). This is on purpose, and it is left as it is. It is not a bug.

- **First request:** only the thumbs ratings, with no comments or reasons. That is enough to count them and to check the size of the run.
- **Second request:** the same dates again, now with the reasons and the comments.

The first request exists so that a window with far too many ratings stops there. The reasons, comments and conversation text are never downloaded for a run that is refused. To merge the two requests (join them into one) would save a single cheap call, but it would download the comments before the size check could stop the run. The results are the same either way, so nothing is lost or wrong. The cost is one extra, small request per run.

A dry run (`feedback export --dry-run`) makes both score requests but reads no conversations, unless the filter uses `user` or `session`, which only exist on the conversation.

## Author and licence

Written by Byron Thanopoulos (IcodeNet), byronth@gmail.com. Released under the MIT licence; see the `LICENSE` file.

## Keep the data safe

Exports and `analyse` mask by default: each user id becomes a short code (`user-1a2b3c4d`, new for every run), and emails, phone numbers, card numbers (Luhn-checked), IBANs and UK National Insurance numbers in the question, answer and comment are replaced with `[email]`, `[phone]`, `[card]`, `[iban]` and `[ni-number]`. The rules are pattern-based, so names, addresses and free-form account details are NOT caught. Pass `--no-mask` to keep everything as it is; the run then says so. Masked files still hold customer chat text. The `reports/` folder and `*.env` files are ignored by git on purpose. Do not email the files, attach them to tickets, or move them out of approved storage. Delete exports you no longer need. Keeping personal data out of Langfuse is still the application's job.

## If something goes wrong

| You see | What it means |
| --- | --- |
| `has no Langfuse keys` | The profile's env file is missing, empty, or uses other key names. |
| `Cannot read the env file ... ENOENT` | The path saved in the profile is wrong. `config set profile.envFile` saves the full path, so it works from any folder. A relative path already in your config file counts from the folder you run in; replace it. Fix it with `jeves config set profile.envFile <absolute-path>`, or remove it with `jeves config unset profile.envFile`. |
| `Langfuse ... failed: 401` | The keys belong to a different Langfuse project or region than the address in the profile. |
| `Langfuse answered 429; retry ...` | Langfuse asked the tool to slow down. It waits and retries by itself. |
| `0 rating scores` | No feedback in the window, or your application does not record it the way [the setup guide](docs/langfuse-setup.md) describes. |
| `rating(s) point at an answer Langfuse no longer returns` | A score sits on a turn that was deleted or is not named `chat-turn`. |
| `The config file ... has problems` | A value in the config file is wrong. The message lists each one with its place; fix the file, or run `jeves config check` in a shell (`config check` in the session). |
| `Unknown field feedback` (or another command word) in the session | A shell command was typed at the `jeves[dev]>` prompt, so it was read as a filter. Type the session form instead, for example `where` for `feedback export --dry-run`. See "Two places to type commands". |
| `No model is set up` | Set `llm.provider` and `llm.model`; the message gives the exact commands. |
| `Invalid filter` with a caret | The filter has a typo. The message points at it and suggests the right word. |
