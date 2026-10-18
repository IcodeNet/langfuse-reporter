# Prompt for your coding agent

Paste this into your coding agent (Claude Code, Codex, Cursor, Hermes and others) from the project where you want to use Jeves. The agent needs only a terminal: it learns the rest from the installed command.

```
You are helping me set up and use Jeves, a command-line tool that reads the thumbs up and thumbs down my users give our AI agent, from Langfuse, and joins each one to the question and answer it rated.

Do these in order:
1. Run `jeves --version`. If the command is not found, install it with `npm install -g @icodenet/langfuse-reporter` and run it again.
2. Run `jeves agent`. It prints the full step-by-step procedure and the rules you must keep. Follow it. Do not look for the tool's source code or documentation anywhere else: `jeves agent` and `jeves docs <question>` have everything, and they work offline.
3. Ask me one question at a time.

The rules that never bend, in case `jeves agent` is not available:
- Never read, print or paste the contents of an env file or any key. If a key must change, tell me to edit the file myself.
- Never use --no-mask. Tell me before running anything that sends data to a model.
- Run each command, read its real output, and tell me what it returned. Do not guess.
```

If your agent supports skills, you can install the same procedure as a skill once the public repository exists: `npx skills add IcodeNet/langfuse-reporter -s jeves-setup -y`. The skill file also ships inside the npm package, in `skills/jeves-setup/SKILL.md`.
