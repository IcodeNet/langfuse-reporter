export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';

export interface Check {
  label: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

export interface DoctorReport {
  failed: number;
  checks: Check[];
}

export interface Settings {
  activeProfile: string;
  profile: { baseUrl: string; envFile?: string };
  outDir: string;
  conventions: {
    turnName: string;
    ratingScore: string;
    reasonScorePrefix: string;
    reasons: string[];
    yesValues: string[];
    assistantName: string;
    passLabel: string;
    failLabel: string;
  };
  llm: { provider?: string; model?: string; baseUrl?: string };
}

export interface Discovery {
  project: { id: string; name: string };
  observationNames: string[];
  scoreNames: string[];
  current: { turnNameFound: boolean; ratingScoreFound: boolean; reasonScoreNames: string[] };
}

export interface BrowseListing {
  path: string;
  parent: string | null;
  entries: Array<{ name: string; kind: 'dir' | 'file' }>;
  truncated: boolean;
}

export interface SaveResult {
  ok: boolean;
  message: string;
}

/** The server puts a one-time token in the address; every request sends it back. */
function token(): string {
  return new URLSearchParams(window.location.search).get('token') ?? '';
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { 'x-setup-token': token() } });
  if (!response.ok) throw new Error(`The server answered ${response.status}`);
  return (await response.json()) as T;
}

export const fetchDoctor = (): Promise<DoctorReport> => getJson('api/doctor');
export const fetchSettings = (): Promise<Settings> => getJson('api/settings');
export const fetchDiscovery = (): Promise<Discovery> => getJson('api/discover');
export const browse = (path?: string, hidden = false): Promise<BrowseListing> => {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  if (hidden) params.set('hidden', '1');
  return getJson(`api/browse?${params.toString()}`);
};

/** One setting, saved by the CLI, which checks it with the same rules as the config file. */
export async function saveSetting(key: string, value: string): Promise<SaveResult> {
  const response = await fetch('api/config-set', {
    method: 'POST',
    headers: { 'x-setup-token': token(), 'content-type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
  if (!response.ok) throw new Error(`The server answered ${response.status}`);
  return (await response.json()) as SaveResult;
}

export interface ReportQuery {
  from: string;
  to: string;
  where?: string;
  format?: 'excel' | 'csv' | 'json';
  dryRun?: boolean;
  yes?: boolean;
}

export interface RowsPage {
  ok: boolean;
  message?: string;
  total: number;
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

export interface WrittenFile {
  kind: string;
  path: string;
}

export interface ExportResult {
  ok: boolean;
  message: string;
  selected?: number;
  found?: number;
  files: WrittenFile[];
}

export interface AnalyseResult {
  ok: boolean;
  message: string;
  themes: string[];
  files: WrittenFile[];
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'x-setup-token': token(), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok && response.status !== 400)
    throw new Error(`The server answered ${response.status}`);
  return (await response.json()) as T;
}

export const fetchRows = (
  query: ReportQuery,
  view: { page: number; pageSize: number; sortBy?: string; sortDir?: 'asc' | 'desc' },
): Promise<RowsPage> => postJson('api/rows', { ...query, ...view });
export const runExport = (query: ReportQuery): Promise<ExportResult> =>
  postJson('api/export', query);
export const runAnalyse = (query: ReportQuery): Promise<AnalyseResult> =>
  postJson('api/analyse', query);

export type DocKind = 'markdown' | 'text';

export interface DocPageInfo {
  name: string;
  title: string;
  kind: DocKind;
}

export interface DocSearchHit {
  page: string;
  title: string;
  kind: DocKind;
  heading: string;
  text: string;
}

export const fetchDocPages = async (): Promise<DocPageInfo[]> =>
  (await getJson<{ pages: DocPageInfo[] }>('api/docs')).pages;
export const fetchDocPage = (
  name: string,
): Promise<{ title: string; text: string; kind: DocKind }> =>
  getJson(`api/docs?page=${encodeURIComponent(name)}`);
export const searchDocs = async (question: string): Promise<DocSearchHit[]> =>
  (await getJson<{ results: DocSearchHit[] }>(`api/docs?q=${encodeURIComponent(question)}`))
    .results;
