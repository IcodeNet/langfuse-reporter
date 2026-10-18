/** Keeps a developer's real Langfuse keys out of tests, which spawn the program with a copy of this environment. */
for (const name of Object.keys(process.env)) {
  if (name.startsWith('LANGFUSE_')) delete process.env[name];
}
