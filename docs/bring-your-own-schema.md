# Use jeves with your own Langfuse names

jeves does not need your application to change. It needs to know three names that your application chose. This page helps you find them, set them, and check that they are right.

The defaults come from the demo application: the turn is called `chat-turn`, the thumb is called `feedback_helpful`, and each reason starts with `feedback_`. If your application uses other names, jeves finds no questions, no answers or no reasons until you set yours. The reference for the setup itself is [langfuse-setup.md](langfuse-setup.md).

**Easiest way:** run `jeves ui` and open step 4 of the Guided setup. It lists the names it finds in your project, and you click the three that are yours. The commands below do the same thing by hand.

Commands here are typed **in a shell**. In the session (prompt `jeves[dev]>`) type the same `config set` lines without `jeves`.

## The three questions

Answer these from your own Langfuse project. Then set the three answers.

### 1. Which observation holds the question and the answer?

Look for the observation whose **input** is what the user asked and whose **output** is what the agent answered. Its **name** is your `turnName`. To list the names your project uses, ask the API for a few observations and read the `name` field:

```
curl -s -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" \
  "https://cloud.langfuse.com/api/public/v2/observations?limit=10&fields=core,basic"
```

Use your own Langfuse address if you do not use the EU cloud.

```
jeves config set conventions.turnName assistant-turn
```

If it is wrong, `jeves doctor` says `[FAIL] Ratings`, and "the answer they were given on is not a "chat-turn" observation" (it names your current setting). An export finds no rows.

### 2. Which score is the thumb?

The thumb is a boolean score, recorded on the same observation as the question and answer. Its **name** is your `ratingScore`. Its comment is the user's free text. To list score names, ask the API:

```
curl -s -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" \
  "https://cloud.langfuse.com/api/public/v3/scores?limit=10&fields=subject"
```

```
jeves config set conventions.ratingScore thumbs
```

If it is wrong, `jeves doctor` says `[CHECK] Ratings`, "none named "feedback_helpful" in this window". That is a warning, not a failure, because an empty window gives the same message. Check the name before you check the window.

If your thumb is not `true` and `false`, set which values mean thumbs up. Anything else counts as thumbs down:

```
jeves config set conventions.yesValues "yes, y"
```

This replaces the list; it does not add to it. With only `yes`, a score of `true` counts as thumbs down, and every rating in the export turns negative. Keep `true` in the list if any rating still arrives as a boolean.

### 3. How are the reasons named?

When a user ticks a reason, such as "wrong answer", your application records one boolean score for it. jeves needs two things: the text before the reason, and the list of reasons.

For a score named `why.wrong_answer`, the prefix is `why.` and the reason is `wrong_answer`:

```
jeves config set conventions.reasonScorePrefix why.
jeves config set conventions.reasons "wrong_answer, too_slow, rude"
```

The prefix may be empty. Names cannot contain a comma.

If these are wrong, the export still succeeds, but the reasons column is empty (`reasons` in CSV and JSON, "Categories ticked" in Excel). A reason that is missing from the list is dropped in the same way. `jeves doctor` looks at up to five rated answers. When they carry other scores and none of them is a listed reason, it prints `[CHECK] Ratings` with the score names it found, so you can see what your prefix should match. It stays quiet when the answers carry no other scores, because an application may record no reasons at all. So an empty reasons column with a clean doctor means the application records none. To be sure, export a few ratings you know carry a ticked reason, and check the reasons are there:

```
jeves feedback export --format csv --out /tmp/check
```

## Check everything at once

```
jeves config check     # every wrong value, with its place in the file
jeves doctor           # each link, from config file to ratings
```

Doctor reads from Langfuse and writes nothing. These are the results that point at a name:

| What doctor prints | What it means |
| --- | --- |
| `[CHECK] Ratings  none named "<name>" in this window` | The score name is wrong, or nobody rated anything in the window. Check the name first. |
| `[FAIL] Ratings  ... is not a "<name>" observation` | Ratings exist, but not on an observation with that turn name. Check `turnName`. |
| `[FAIL] Ratings  ... all sit on the whole trace` | The application recorded each thumb on the trace. jeves needs it on the turn. This is a change in the application, not a setting. |
| `[CHECK] Ratings  ... none of the other scores on N rated answers is a listed reason (found: ...)` | The rating is found, but the reason prefix or the reason list does not match the score names listed after `found:`. |
| `✓ Ratings  3 on a chat turn in this window` | The turn name and the score name are right, and no unmatched scores were seen on the sampled answers. |

## What a setting cannot fix

- Thumbs recorded on the trace or the session. jeves cannot tell which answer was rated.
- Ratings of different turns that share one score id. Langfuse treats the later one as an update, and the earlier rating is gone before jeves reads anything.
- Turns without a session id. The row is exported, but its conversation holds only that one turn.

## The same checks on sample data

`jeves --demo` runs on built-in data with the default names, so it cannot show a wrong setting. Settings that belong to the config file are refused there with a message saying so.
