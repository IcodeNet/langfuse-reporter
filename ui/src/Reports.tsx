import { useCallback, useEffect, useState } from 'react';
import {
  fetchDoctor,
  fetchRows,
  runAnalyse,
  runExport,
  type AnalyseResult,
  type ExportResult,
  type ReportQuery,
  type RowsPage,
} from './api';
import { activePreset, PRESETS } from './dates';

const PAGE_SIZES = [10, 25, 50, 100];
const SHOWN_COLUMNS = ['created', 'rating', 'reasons', 'comment', 'question', 'answer'];
const FORMATS = [
  { id: 'excel', label: 'Excel' },
  { id: 'csv', label: 'CSV' },
  { id: 'json', label: 'JSON' },
] as const;

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return Array.isArray(value) ? value.join('; ') : String(value);
}

/** Lets a long id such as wrong_answer wrap after an underscore, never in the middle of a word. */
function breakable(text: string): string {
  return text.replaceAll('_', '_\u200b');
}

function Files({ files }: { files: Array<{ kind: string; path: string }> }) {
  if (files.length === 0) return null;
  return (
    <ul className="files">
      {files.map((file) => (
        <li key={file.path}>
          <strong>{file.kind}</strong> <code>{file.path}</code>
        </li>
      ))}
    </ul>
  );
}

/** Reports from the page. Everything runs through the CLI, masked, and files go to the output folder. */
export function Reports({ onSetup }: { onSetup: () => void }) {
  const [failed, setFailed] = useState<number | undefined>();
  useEffect(() => {
    fetchDoctor()
      .then((report) => setFailed(report.failed))
      .catch(() => setFailed(undefined));
  }, []);

  const now = new Date();
  const first = PRESETS[0]?.window(now) ?? { from: '', to: '' };
  const [from, setFrom] = useState(first.from);
  const [to, setTo] = useState(first.to);
  const selectedPreset = activePreset(from, to, now);
  const [where, setWhere] = useState('');
  const [format, setFormat] = useState<'excel' | 'csv' | 'json'>('excel');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ by?: string; dir: 'asc' | 'desc' }>({ dir: 'asc' });
  const [data, setData] = useState<RowsPage | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState<'rows' | 'export' | 'analyse' | undefined>();
  const [exported, setExported] = useState<ExportResult | undefined>();
  const [analysed, setAnalysed] = useState<AnalyseResult | undefined>();
  const [askBig, setAskBig] = useState<'export' | 'analyse' | undefined>();

  const query = useCallback(
    (): ReportQuery => ({ from, to, ...(where.trim() ? { where: where.trim() } : {}) }),
    [from, to, where],
  );

  const load = async (nextPage = 0, nextSort = sort, nextSize = pageSize) => {
    setBusy('rows');
    setError(undefined);
    try {
      const result = await fetchRows(query(), {
        page: nextPage,
        pageSize: nextSize,
        sortBy: nextSort.by,
        sortDir: nextSort.dir,
      });
      if (!result.ok) {
        setData(undefined);
        setError(result.message || 'The ratings could not be read.');
      } else {
        setData(result);
        setPage(nextPage);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  };

  const doExport = async (yes = false) => {
    setBusy('export');
    setError(undefined);
    setAskBig(undefined);
    setExported(undefined);
    try {
      const result = await runExport({ ...query(), format, yes });
      if (!result.ok && /--yes|large run|over \d+/i.test(result.message)) setAskBig('export');
      else if (!result.ok) setError(result.message || 'The export failed.');
      setExported(result.ok ? result : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  };

  const doAnalyse = async (yes = false) => {
    setBusy('analyse');
    setError(undefined);
    setAskBig(undefined);
    setAnalysed(undefined);
    try {
      const result = await runAnalyse({ ...query(), yes });
      if (!result.ok && /--yes|600|large/i.test(result.message)) setAskBig('analyse');
      else if (!result.ok) setError(result.message || 'The analysis failed.');
      setAnalysed(result.ok ? result : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  };

  const columns = data ? SHOWN_COLUMNS.filter((name) => data.columns.includes(name)) : [];
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  const sortBy = (name: string) => {
    const next = {
      by: name,
      dir: sort.by === name && sort.dir === 'asc' ? ('desc' as const) : ('asc' as const),
    };
    setSort(next);
    void load(0, next);
  };

  return (
    <section>
      <h2>Reports</h2>
      {failed !== undefined && failed > 0 && (
        <div className="confirm" role="alert">
          <p>
            Setup is not complete: {failed} check{failed === 1 ? '' : 's'} failed, so reports may
            not work yet.
          </p>
          <button type="button" onClick={onSetup}>
            Go to the guided setup
          </button>
        </div>
      )}
      <p className="hint">
        Pick a window, look at the ratings, and write Excel, CSV or JSON files to your output
        folder. User ids and personal details are masked. There is no switch to turn that off here.
      </p>

      <div className="presets" role="group" aria-label="Window presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-pressed={selectedPreset === preset.id}
            className={selectedPreset === preset.id ? 'chip on' : 'chip'}
            onClick={() => {
              const window = preset.window(new Date());
              setFrom(window.from);
              setTo(window.to);
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="row">
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From date"
          />
        </label>
        <label>
          To (not included)
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To date"
          />
        </label>
      </div>
      <div className="field">
        <label htmlFor="where">Filter (optional)</label>
        <p className="hint">
          For example <code>rating = negative</code> or <code>category IN (wrong_answer)</code>.
          Leave it empty for every rating.
        </p>
        <input
          id="where"
          value={where}
          onChange={(e) => setWhere(e.target.value)}
          placeholder="rating = negative"
        />
      </div>

      <div className="row">
        <button type="button" onClick={() => void load(0)} disabled={busy !== undefined}>
          {busy === 'rows' ? 'Reading…' : 'Show the ratings'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      {data && (
        <>
          <p className="summary">
            {data.total === 0
              ? 'No ratings match.'
              : `${data.total} rating${data.total === 1 ? '' : 's'} match.`}
          </p>
          {data.total > 0 && (
            <>
              <div className="tablewrap">
                <table className="grid">
                  <thead>
                    <tr>
                      {columns.map((name) => (
                        <th
                          key={name}
                          aria-sort={
                            sort.by === name
                              ? sort.dir === 'asc'
                                ? 'ascending'
                                : 'descending'
                              : 'none'
                          }
                        >
                          <button type="button" className="th" onClick={() => sortBy(name)}>
                            {name}
                            {sort.by === name ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row, index) => (
                      <tr
                        key={`${page}-${index}`}
                        className={cell(row.rating) === 'negative' ? 'neg' : 'pos'}
                      >
                        {columns.map((name) => (
                          <td key={name}>
                            {name === 'reasons' ? breakable(cell(row[name])) : cell(row[name])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pager">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void load(page - 1)}
                  disabled={page === 0 || busy !== undefined}
                >
                  Previous
                </button>
                <span>
                  Page {page + 1} of {pages}
                </span>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void load(page + 1)}
                  disabled={page + 1 >= pages || busy !== undefined}
                >
                  Next page
                </button>
                <label>
                  Rows per page
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      const size = Number(e.target.value);
                      setPageSize(size);
                      void load(0, sort, size);
                    }}
                  >
                    {PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          )}

          <h3>Write the files</h3>
          <div className="chips" role="radiogroup" aria-label="File format">
            {FORMATS.map((each) => (
              <button
                key={each.id}
                type="button"
                role="radio"
                aria-checked={format === each.id}
                className={format === each.id ? 'chip on' : 'chip'}
                onClick={() => setFormat(each.id)}
              >
                {each.label}
              </button>
            ))}
          </div>
          <div className="row">
            <button
              type="button"
              onClick={() => void doExport()}
              disabled={busy !== undefined || data.total === 0}
            >
              {busy === 'export' ? 'Writing…' : 'Write the files'}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => void doAnalyse()}
              disabled={busy !== undefined || data.total === 0}
            >
              {busy === 'analyse' ? 'Analysing…' : 'Find the common problems'}
            </button>
          </div>
          <p className="hint">
            Finding common problems sends the masked questions, answers and comments to the model
            you set up, and writes an Excel file of the themes.
          </p>
          {askBig && (
            <div className="confirm" role="alert">
              <p>
                This is a large run.{' '}
                {askBig === 'analyse'
                  ? 'More than 600 ratings would be sent to the model.'
                  : 'More than 5000 ratings would be written.'}
              </p>
              <button
                type="button"
                onClick={() => void (askBig === 'export' ? doExport(true) : doAnalyse(true))}
              >
                Yes, go ahead
              </button>{' '}
              <button type="button" className="ghost" onClick={() => setAskBig(undefined)}>
                Cancel
              </button>
            </div>
          )}
        </>
      )}

      {exported && (
        <div className="result">
          <p className="ok-text">
            ✓ Wrote {exported.selected ?? 0} of {exported.found ?? 0} ratings.
          </p>
          <Files files={exported.files} />
        </div>
      )}
      {analysed && (
        <div className="result">
          <p className="ok-text">✓ Analysis done.</p>
          <pre className="themes">{analysed.themes.join('\n')}</pre>
          <Files files={analysed.files} />
        </div>
      )}
    </section>
  );
}
