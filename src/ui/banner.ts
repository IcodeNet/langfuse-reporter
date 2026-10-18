import { brand } from '../brand/brand.js';
import { brandLogoLines } from '../brand/logo.js';
import { displayWidth, truncateToWidth, wrapToWidth, wrapWords } from './display-width.js';
import { basename } from 'node:path';
import { stripControlCharacters as safe } from './untrusted-text.js';
import { createPalette, padVisible, visibleWidth, type Palette } from './ansi.js';

const TWO_COLUMN_MIN_COLUMNS = 96;
const COLUMN_GAP = 4;
const PANEL_CHROME = 4;

interface ProfileSummary {
  name: string;
  baseUrl: string;
  /** The env file whose keys pick the Langfuse project; shown by file name. */
  envFile?: string;
  active: boolean;
}

export interface BannerInfo {
  version: string;
  configRows: ReadonlyArray<readonly [string, string]>;
  profiles: readonly ProfileSummary[];
  commands: ReadonlyArray<readonly [string, string]>;
  showLogo: boolean;
}

export interface BannerOptions {
  columns: number;
  color: boolean;
}

function truncate(text: string, width: number): string {
  return truncateToWidth(text, width);
}

/** Values are never cut: one that is wider than the room continues on the next line, under the value column. */
const PROFILE_EXPLANATION =
  'A profile is a Langfuse address plus the env file whose keys choose the project you read.';

function keysName(profile: ProfileSummary): string {
  return profile.envFile ? basename(profile.envFile) : '(no env file)';
}

function leftLines(info: BannerInfo, paint: Palette, maxWidth: number): string[] {
  const labelWidth = Math.max(...info.configRows.map(([label]) => displayWidth(safe(label))));
  const valueRoom = Math.max(8, maxWidth - labelWidth - 2);
  return info.configRows.flatMap(([label, value]) =>
    wrapToWidth(safe(value), valueRoom).map(
      (piece, index) =>
        `${paint.amber(padVisible(index === 0 ? safe(label) : '', labelWidth))}  ${paint.cream(piece)}`,
    ),
  );
}

function rightLines(info: BannerInfo, paint: Palette, maxWidth: number): string[] {
  const nameWidth = Math.max(
    0,
    ...info.profiles.map((profile) => displayWidth(safe(profile.name))),
  );
  const keysWidth = Math.max(
    0,
    ...info.profiles.map((profile) => displayWidth(safe(keysName(profile)))),
  );
  const profiles = info.profiles.flatMap((profile) => {
    const marker = profile.active ? paint.gold('*') : ' ';
    const shownName = padVisible(safe(profile.name), nameWidth);
    const name = profile.active ? paint.gold(shownName) : paint.cream(shownName);
    const keys = padVisible(safe(keysName(profile)), keysWidth);
    const url = safe(profile.baseUrl);
    const oneLine = nameWidth + keysWidth + displayWidth(url) + 6 <= maxWidth;
    if (oneLine) return [`${marker} ${name}  ${paint.amber(keys)}  ${paint.dim(url)}`];
    return [
      `${marker} ${name}  ${paint.amber(keys)}`,
      ...wrapToWidth(url, Math.max(8, maxWidth - 4)).map((piece) => `    ${paint.dim(piece)}`),
    ];
  });
  const explanation = wrapWords(PROFILE_EXPLANATION, Math.min(48, Math.max(20, maxWidth))).map(
    (piece) => paint.dim(piece),
  );
  const commandWidth = Math.max(0, ...info.commands.map(([name]) => displayWidth(safe(name))));
  const commands = info.commands.map(
    ([name, hint]) =>
      `${paint.amber(padVisible(safe(name), commandWidth))}  ${paint.dim(truncate(safe(hint), Math.max(8, maxWidth - commandWidth - 2)))}`,
  );
  const sections = [paint.bold(paint.amber('Profiles')), ...explanation, ...profiles];
  if (commands.length > 0) sections.push('', paint.bold(paint.amber('Commands')), ...commands);
  return sections;
}

function framed(title: string, lines: string[], paint: Palette): string {
  const inner = Math.max(visibleWidth(title) + 2, ...lines.map(visibleWidth));
  const width = inner + PANEL_CHROME;
  const top = `${paint.bronze('╭─ ')}${paint.gold(title)}${paint.bronze(` ${'─'.repeat(width - visibleWidth(title) - 5)}╮`)}`;
  const body = lines.map(
    (line) => `${paint.bronze('│')} ${padVisible(line, inner)} ${paint.bronze('│')}`,
  );
  const bottom = paint.bronze(`╰${'─'.repeat(width - 2)}╯`);
  return [top, ...body, bottom].join('\n');
}

function sideBySide(left: string[], right: string[]): string[] {
  const leftWidth = Math.max(...left.map(visibleWidth));
  const rows = Math.max(left.length, right.length);
  return Array.from({ length: rows }, (_, index) => {
    const leftCell = padVisible(left[index] ?? '', leftWidth);
    return `${leftCell}${' '.repeat(COLUMN_GAP)}${right[index] ?? ''}`;
  });
}

/** Header: gold gradient logo, then a bordered panel with config on the left, profiles and commands on the right. */
export function renderBanner(info: BannerInfo, { columns, color }: BannerOptions): string {
  const paint = createPalette(color);
  const logoRows = info.showLogo ? brandLogoLines(columns) : [];
  const palette = [paint.gold, paint.gold, paint.amber, paint.amber, paint.bronze, paint.bronze];
  const logo =
    logoRows.length > 0
      ? `${logoRows.map((row, index) => (palette[index] ?? paint.bronze)(row)).join('\n')}\n\n`
      : '';

  const panelRoom = Math.max(20, columns - PANEL_CHROME);
  const left = leftLines(info, paint, panelRoom);
  const right = rightLines(info, paint, panelRoom);
  const leftWidth = Math.max(...left.map(visibleWidth));
  const rightWidth = Math.max(...right.map(visibleWidth));
  const fitsSideBySide =
    columns >= TWO_COLUMN_MIN_COLUMNS &&
    leftWidth + COLUMN_GAP + rightWidth + PANEL_CHROME <= columns;
  const body = fitsSideBySide ? sideBySide(left, right) : [...left, '', ...right];

  return `\n${logo}${framed(`${brand.name} · Langfuse feedback CLI v${info.version}`, body, paint)}\n`;
}
