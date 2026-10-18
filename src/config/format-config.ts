import type { Block } from '../ui/reporter.js';
import type { ResolvedConfig } from './resolve-config.js';

export type ConfigRow = readonly [label: string, value: string];

function maskKey(value: string | undefined): string {
  if (!value) return '(not set)';
  return `${value.slice(0, 7)}…${'*'.repeat(4)} (${value.length} chars)`;
}

function describeLlm(resolved: ResolvedConfig): string {
  const { provider, model, baseUrl } = resolved.llm;
  if (!provider || !model)
    return '(not set up; needed for docs and analyse: config set llm.provider)';
  const key = resolved.llmApiKey ? 'key set' : 'no LLM_API_KEY';
  return `${provider} / ${model}${baseUrl ? ` via ${baseUrl}` : ''} (${key})`;
}

function envFileText(resolved: ResolvedConfig): string {
  const path = resolved.profile.envFile;
  if (!path) return '(none, using process env)';
  return resolved.envFileProblem ? `${path}  ✗ cannot be read` : path;
}

export function configRows(resolved: ResolvedConfig, configPath: string): ConfigRow[] {
  const { profile } = resolved;
  return [
    ['config file', configPath],
    ['profile', resolved.profileName],
    ['langfuse', profile.baseUrl],
    ['env file', envFileText(resolved)],
    ['public key', maskKey(resolved.publicKey)],
    ['secret key', resolved.secretKey ? 'set' : '(not set)'],
    ['window', `${resolved.from.slice(0, 10)} → ${resolved.to.slice(0, 10)} (UTC)`],
    ['llm', describeLlm(resolved)],
    ['output dir', resolved.outDir],
  ];
}

export function configBlock(resolved: ResolvedConfig, configPath: string): Block {
  return { title: 'Configuration', emoji: '⚙️ ', rows: configRows(resolved, configPath) };
}

/** Plain-text config block, used when output is not a terminal. */
export function formatConfig(resolved: ResolvedConfig, configPath: string): string {
  const rows = configRows(resolved, configPath);
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`).join('\n');
}
