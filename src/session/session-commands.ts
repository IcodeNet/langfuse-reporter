export const SESSION_COMMANDS: ReadonlyArray<readonly [name: string, hint: string]> = [
  ['where', 'filter the loaded feedback and preview the matches'],
  [
    'window',
    'choose the dates and load them: window 2026-10-01 2026-10-13 | window reset (add --yes if large)',
  ],
  ['columns', 'choose the table columns: columns date rating reasons comment question'],
  ['compare', 'compare two report files: compare <before.xlsx> <after.xlsx>'],
  ['doctor', 'check every link from config to ratings and print the fix for each'],
  ['report', 'read the ratings full screen, like less: report [where <filter>]'],
  ['analyse', 'ask a model for the common problems: analyse [where <filter>]'],
  ['save', 'write the query shown by where to Excel: save [file name]'],
  ['export', 'write the positive and negative Excel files (export where <filter> to narrow)'],
  ['load', 'fetch feedback from Langfuse again (add --yes for a large run)'],
  ['fields', 'list filter fields and their valid values'],
  ['profiles', 'list the available profiles'],
  ['use', 'switch profile: use <name>'],
  ['set', 'change a setting: set <key> <value>'],
  ['unset', 'reset a setting to its default: unset <key>'],
  ['config', 'show or change settings: config show | set | unset | use'],
  [
    'docs',
    'ask about the CLI and how Langfuse must be set up: docs <question>, or docs alone to chat',
  ],
  ['clear', 'clear the screen and forget the docs conversation'],
  ['soul', 'a picture-and-words tour: what this tool does and how anyone can use it'],
  ['credits', 'who built this tool'],
  ['help', 'list the commands, or explain one: help <command>  (any command also answers ?)'],
  ['exit', 'leave the session'],
];

/** Shown by `credits`. */
export const CREDITS: ReadonlyArray<readonly [name: string, hint: string]> = [
  ['built by', 'Byron Thanopoulos (IcodeNet)'],
  ['contact', 'byronth@gmail.com'],
  ['uses', 'the Langfuse public API'],
];

export const CONFIG_SUBCOMMANDS: ReadonlyArray<readonly [name: string, hint: string]> = [
  ['show', 'print every setting with its value'],
  ['check', 'check the config file and report wrong values'],
  ['set', 'change a setting: config set <key> <value>'],
  ['unset', 'reset a setting to its default: config unset <key>'],
  ['use', 'switch profile: config use <name>'],
];

/** Names that run a command without being listed in help, so they are never read as filters. */
const COMMAND_ALIASES = ['quit', '/credits', '?'] as const;

export const COMMAND_NAMES: ReadonlySet<string> = new Set([
  ...SESSION_COMMANDS.map(([name]) => name),
  ...COMMAND_ALIASES,
]);
