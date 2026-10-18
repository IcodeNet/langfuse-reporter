import { useCallback, useEffect, useState } from 'react';
import { fetchDoctor, type Check, type DoctorReport } from './api';

const MARK: Record<Check['status'], string> = { ok: '✓', warn: '!', fail: '✗', skip: '·' };
const WORD: Record<Check['status'], string> = {
  ok: 'fine',
  warn: 'look at it',
  fail: 'broken',
  skip: 'skipped',
};

function Row({ check }: { check: Check }) {
  return (
    <li className={`check ${check.status}`}>
      <span className="mark" aria-hidden="true">
        {MARK[check.status]}
      </span>
      <div>
        <div className="label">
          {check.label} <span className="word">{WORD[check.status]}</span>
        </div>
        <div className="detail">{check.detail}</div>
        {check.fix && check.status !== 'ok' && (
          <div className="fix">
            Fix: <code>{check.fix}</code>
          </div>
        )}
      </div>
    </li>
  );
}

/** Runs doctor and shows every check. Nothing is written. */
export function Doctor() {
  const [report, setReport] = useState<DoctorReport | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      setReport(await fetchDoctor());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <section>
      <h2>Check everything</h2>
      <p className="hint">
        Checks every link from the config file to your ratings. Nothing is written.
      </p>
      <button type="button" onClick={() => void run()} disabled={busy}>
        {busy ? 'Checking…' : 'Check again'}
      </button>
      {error && <p className="error">{error}</p>}
      {report && (
        <>
          <p className="summary">
            {report.failed === 0 ? 'No check failed.' : `${report.failed} check(s) failed.`}
          </p>
          <ul className="checks">
            {report.checks.map((check) => (
              <Row key={check.label} check={check} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
