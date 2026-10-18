import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSettings, type Settings } from './api';
import { Docs } from './Docs';
import { Doctor } from './Doctor';
import { Reports } from './Reports';
import { Wizard } from './Wizard';

type View = 'wizard' | 'doctor' | 'reports' | 'docs';

export function App() {
  const [settings, setSettings] = useState<Settings | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [view, setView] = useState<View>('wizard');

  const latest = useRef(0);

  /** Only the newest answer is kept, so a slow older reply cannot overwrite a newer setting. */
  const reload = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const fresh = await fetchSettings();
      if (mine !== latest.current) return;
      setSettings(fresh);
      setError(undefined);
    } catch (err) {
      if (mine !== latest.current) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <main>
      <header>
        <img className="logo" src="images/jeves-logo.svg" alt="Jeves" width="638" height="148" />
        <nav aria-label="Pages">
          <button
            type="button"
            className={view === 'wizard' ? 'tab on' : 'tab'}
            onClick={() => setView('wizard')}
          >
            Guided setup
          </button>
          <button
            type="button"
            className={view === 'reports' ? 'tab on' : 'tab'}
            onClick={() => setView('reports')}
          >
            Reports
          </button>
          <button
            type="button"
            className={view === 'doctor' ? 'tab on' : 'tab'}
            onClick={() => setView('doctor')}
          >
            Check everything
          </button>
          <button
            type="button"
            className={view === 'docs' ? 'tab on' : 'tab'}
            onClick={() => setView('docs')}
          >
            Docs
          </button>
        </nav>
      </header>
      {error && <p className="error">Could not read the settings: {error}</p>}
      {settings && view === 'wizard' && (
        <Wizard settings={settings} reload={reload} onFinish={() => setView('doctor')} />
      )}
      {view === 'doctor' && <Doctor />}
      {view === 'docs' && <Docs />}
      {view === 'reports' && <Reports onSetup={() => setView('wizard')} />}
      <footer>
        <img className="langfuse" src="images/langfuse-wordart-white.svg" alt="Langfuse" />
        <p>
          Jeves is an independent tool. It is not made, sponsored or endorsed by Langfuse. The
          Langfuse name and logo belong to their owners and are shown unmodified, only to say which
          product this tool reads from.
        </p>
      </footer>
    </main>
  );
}
