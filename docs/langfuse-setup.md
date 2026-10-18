# How Langfuse must be set up for jeves

jeves reads your users' thumbs up and thumbs down from Langfuse and shows each one next to the question and answer it was given on. That only works if your application records its data in a particular way. This page says how, and why. It is the one place the CLI depends on your setup, so read it before pointing the CLI at a project.

The CLI needs two things, and nothing else: your Langfuse project, and one model provider for the `docs` and `analyse` commands. The names used below are the defaults. They are settings, so if your Langfuse uses other names, see "If your Langfuse is set up differently".

Commands on this page are labelled by where you type them. **In a shell** means your normal terminal, and every command starts with `jeves`. **In the session (prompt `jeves[dev]>`)** means the interactive session you open by running `jeves` with no command; there, commands have no `jeves` in front and no `feedback` word. A shell command typed at the session prompt is read as a filter, which is why `feedback export --dry-run` there gives `Unknown field feedback`. The README's "Two places to type commands" section has the full list of equivalents.

## The setup the CLI expects

### 1. One `chat-turn` observation per question and answer

Every time a user asks something and the agent answers, your application records one observation named exactly `chat-turn`.

- The observation's **input** is the user's question, as text.
- The observation's **output** is the agent's answer, as text.
- The observation carries a **session id**. Every turn of one conversation uses the same session id.
- The observation carries a **user id** if you want to filter by user.

Why: the CLI finds the question and answer by reading `chat-turn` observations. It asks Langfuse for those and nothing else, which keeps the download small. A conversation is the set of `chat-turn` observations that share a session id, and the CLI numbers the turns oldest first.

If your turns have another name, the CLI will find no questions and no answers.

### 2. Each thumb is a score on the turn it rated

When a user rates an answer, your application records scores on that answer's `chat-turn` observation. Not on the trace, and not on the session.

| Score name | Type | Meaning |
| --- | --- | --- |
| `feedback_helpful` | boolean | `true` for thumbs up, `false` for thumbs down. The score's comment holds the user's free-text comment. |
| `feedback_<reason>` | boolean | `true` for each reason the user ticked, for example `feedback_wrong_answer`. |

The reasons the CLI knows are listed by `jeves feedback fields` in a shell, or `fields` in the session (the `category` field).

Why: a score on the trace cannot say which answer was rated, because a trace can hold many answers, and a second thumb overwrites the first. A score on the turn says exactly which question and answer it belongs to, and each answer keeps its own thumb. The CLI therefore never guesses which turn a rating belongs to.

The score id must include the turn, for example `<traceId>:<turnId>:feedback_helpful`. If every turn of a trace reuses one id, Langfuse treats the later score as an update of the earlier one and the earlier rating is lost.

### 3. Scores carry the trace id

Langfuse records a score on a turn with both the observation id and the trace id. The CLI uses the trace id to find the turn quickly, then reads the whole conversation by session id.

### 4. Keys that open the right project

A Langfuse API key pair opens exactly one project. The CLI asks Langfuse which project the keys open and prints its name at the start of every run and in every exported file. A profile called `dev` is only a label; check the project name it prints. To check the whole setup at once, run `jeves doctor` in a shell, or `doctor` in the session. It checks each link in turn (config file, profile, env file, keys, output folder, date window, project, ratings, model) and prints a `Fix:` line with a command for each problem.

## What the CLI does with it

1. Reads the feedback scores recorded in the date window (default: the previous calendar month, UTC).
2. Reads the rated turns, then every turn of the conversations they belong to.
3. Builds one row per rating: when, pass or fail, the reasons, the comment, the question, the answer, the turn number, and a link that opens the trace with that answer selected.
4. Filters with the query language, shows a table, writes Excel files, or sends rows to a model to find common problems.

## If your Langfuse is set up differently

You do not have to change your application. Every name above is a setting in the CLI's config file, and the defaults are the names in the sections above (`chat-turn`, `feedback_helpful`, `feedback_<reason>`). The file is JSON at `~/.config/langfuse-reporter/config.json` (or the path in `LANGFUSE_CLI_CONFIG`).

Every setting is listed, with a comment on each, in [config.json.local](config.json.local). Read it first. To write your own copy with every default, then edit it by hand and start the CLI, in a shell:

```
jeves config init
jeves config check      # reports every wrong value, with where it is
```

Or change settings from the CLI, which checks each value before it saves it. In a shell:

```
jeves config set conventions.turnName assistant-turn
jeves config set conventions.ratingScore thumbs
jeves config set conventions.reasonScorePrefix why.
jeves config set conventions.reasons "wrong, slow, rude"
jeves config set conventions.yesValues "yes"
jeves config unset conventions.turnName      # back to the default
jeves config show                            # every setting, its value, and what it means
```

In the session (prompt `jeves[dev]>`), type the same `config set`, `config unset`, `config show` and `config check` lines without `jeves`, or use the short forms `set <key> <value>` and `unset <key>`. A change to the conventions loads the ratings again. `config init` is a shell command only.

The `conventions` section of the file:

| Setting | Default | What it is |
| --- | --- | --- |
| `turnName` | `chat-turn` | Name of the observation that holds one question and answer. |
| `ratingScore` | `feedback_helpful` | Name of the thumbs score recorded on a turn. |
| `reasonScorePrefix` | `feedback_` | Text before each reason in its score name. May be empty. |
| `reasons` | twelve reasons | The reasons a user can tick, as they appear after the prefix. They feed the `category` filter. |
| `yesValues` | `true`, `1` | Score values that mean yes. Anything else on the rating score means thumbs down. |
| `assistantName` | `Assistant` | Name shown in the answer column of the Excel files. |
| `passLabel` | `Pass` | Word shown for a thumbs up. |
| `failLabel` | `Fail` | Word shown for a thumbs down. |

Other settings: `outDir` (where files go), `profiles` (Langfuse address and env file for each environment), and `llm` (`provider`, `model`, `baseUrl`).

### Wrong values are reported, not guessed

The file is checked every time the CLI starts. A wrong value or an unknown key stops the run and lists every problem with its place in the file:

```
The config file ~/.config/langfuse-reporter/config.json has problems:
  - conventions.turnName: must not be empty
  - conventions.turnNmae: not a setting. Did you mean "turnName"?
  - conventions.reasons[3]: "other_issue" is listed twice
```

Names must be plain text on one line, score names cannot contain a comma, a list cannot repeat an item, and `yesValues` needs at least one value.

## What breaks if the setup differs

If the names in the file do not match what your Langfuse holds, you see this:

| What differs | What you see |
| --- | --- |
| Turns are not named `chat-turn` (and `turnName` is not changed) | No rows. The run reports ratings pointing at answers Langfuse did not return. |
| Scores sit on the trace, not the turn | No rows. |
| Score names are not `feedback_helpful` and `feedback_<reason>` (and the settings are not changed) | No rows. |
| Ratings of different turns share one score id | Later ratings replace earlier ones, so some are missing. |
| A turn has no session id | The row is exported, but its conversation holds only that one turn. |

The CLI never guesses which turn a rating belongs to. That is why the setup must match.

## Model provider

`docs` and `analyse` call a model over plain HTTP. Choose one:

- `litellm`: your own gateway. Set `llm.baseUrl` to the gateway and use your own virtual key.
- `openai`, `gemini`: the provider's OpenAI-compatible endpoint.
- `anthropic`: the Anthropic Messages API.

In a shell (in the session, type the same lines without `jeves`):

```
jeves config set llm.provider litellm
jeves config set llm.baseUrl https://your-gateway.example.com
jeves config set llm.model <model name>
```

Put `LLM_API_KEY` in the profile's env file next to the Langfuse keys. Keys are never stored in the config file.

## Privacy

Exports contain customers' questions and answers, and `analyse` sends them to your chosen model. Both mask user ids and common personal details (emails, phone numbers, card numbers, IBANs, National Insurance numbers) by default; `--no-mask` turns that off. The patterns do not catch names or addresses, so keeping personal data out of Langfuse is still the application's job. Treat exported files as sensitive.
