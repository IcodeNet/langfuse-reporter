import { useState } from 'react';
import {
  fetchDiscovery,
  fetchDoctor,
  saveSetting,
  type Check,
  type Discovery,
  type Settings,
} from './api';
import { Field } from './Field';
import { FilePicker } from './FilePicker';

interface Props {
  settings: Settings;
  reload: () => Promise<void>;
  onFinish: () => void;
}

const CLOUDS = [
  { id: 'eu', label: 'Langfuse Cloud (EU)', url: 'https://cloud.langfuse.com', note: '' },
  { id: 'us', label: 'Langfuse Cloud (US)', url: 'https://us.cloud.langfuse.com', note: '' },
  {
    id: 'local',
    label: 'Langfuse on this computer',
    url: 'http://localhost:3000',
    note: 'Self-hosted, for example with Docker. Change the port on the next line if needed.',
  },
  {
    id: 'own',
    label: 'Another address',
    url: '',
    note: 'A server on your network or your own domain.',
  },
];

const STEPS = ['Langfuse', 'Keys', 'Project', 'Names', 'Model', 'Done'] as const;

function Progress({ step }: { step: number }) {
  return (
    <ol className="steps" aria-label="Progress">
      {STEPS.map((name, index) => (
        <li key={name} className={index === step ? 'now' : index < step ? 'past' : ''}>
          <span>{index + 1}</span> {name}
        </li>
      ))}
    </ol>
  );
}

function Message({ text, kind }: { text: string; kind: 'ok' | 'error' }) {
  return <p className={kind === 'ok' ? 'ok-text' : 'error'}>{text}</p>;
}

/** Addresses that mean "this computer", which is where a self-hosted Langfuse usually runs. */
function isLocalAddress(address: string): boolean {
  try {
    const host = new URL(address).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === 'host.docker.internal';
  } catch {
    return false;
  }
}

function AddressStep({ settings, reload }: Pick<Props, 'settings' | 'reload'>) {
  const current = settings.profile.baseUrl;
  const known = CLOUDS.find((cloud) => cloud.url === current);
  const [choice, setChoice] = useState(known?.id ?? (isLocalAddress(current) ? 'local' : 'own'));
  const [localKey, setLocalKey] = useState(0);
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'error' } | undefined>();

  const pick = async (id: string) => {
    setChoice(id);
    setMessage(undefined);
    const cloud = CLOUDS.find((each) => each.id === id);
    if (!cloud || cloud.url === '') return;
    if (id === 'local' && isLocalAddress(current)) return;
    const result = await saveSetting('profile.baseUrl', cloud.url);
    setMessage(
      result.ok
        ? { text: `✓ Saved ${cloud.url}`, kind: 'ok' }
        : { text: result.message, kind: 'error' },
    );
    if (result.ok) {
      await reload();
      if (id !== 'local') setLocalKey((key) => key + 1);
    }
  };

  return (
    <section>
      <h2>Which Langfuse do you use?</h2>
      <p className="hint">Pick where your Langfuse project lives. You can change this later.</p>
      <div className="choices" role="radiogroup" aria-label="Langfuse address">
        {CLOUDS.map((cloud) => (
          <button
            key={cloud.id}
            type="button"
            role="radio"
            aria-checked={choice === cloud.id}
            className={choice === cloud.id ? 'choice on' : 'choice'}
            onClick={() => void pick(cloud.id)}
          >
            {cloud.label}
            {cloud.url && <small>{cloud.url}</small>}
            {cloud.note && <small>{cloud.note}</small>}
          </button>
        ))}
      </div>
      {choice === 'local' && (
        <Field
          key={`local-${localKey}`}
          label="Address on this computer"
          help="A self-hosted Langfuse listens on port 3000 unless you changed it. Change the port here if yours is different. The address must start with http://"
          settingKey="profile.baseUrl"
          value={isLocalAddress(current) ? current : 'http://localhost:3000'}
          placeholder="http://localhost:3000"
          onSaved={() => void reload()}
        />
      )}
      {choice === 'own' && (
        <Field
          label="Address"
          help="The address of your Langfuse, starting with https:// (or http:// for a server on your network)"
          settingKey="profile.baseUrl"
          value={known || isLocalAddress(current) ? '' : current}
          placeholder="https://langfuse.example.com"
          onSaved={() => void reload()}
        />
      )}
      {message && <Message {...message} />}
      <p className="hint">Now using: {current}</p>
    </section>
  );
}

function KeysStep({ settings, reload }: Pick<Props, 'settings' | 'reload'>) {
  const [picking, setPicking] = useState(false);
  const [checks, setChecks] = useState<Check[] | undefined>();
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'error' } | undefined>();
  const [busy, setBusy] = useState(false);

  const verify = async () => {
    setBusy(true);
    try {
      const report = await fetchDoctor();
      setChecks(
        report.checks.filter((check) => check.label === 'Env file' || check.label === 'Keys'),
      );
    } finally {
      setBusy(false);
    }
  };

  const choose = async (path: string) => {
    setPicking(false);
    const result = await saveSetting('profile.envFile', path);
    setMessage(
      result.ok ? { text: `✓ Saved ${path}`, kind: 'ok' } : { text: result.message, kind: 'error' },
    );
    if (result.ok) {
      await reload();
      await verify();
    }
  };

  return (
    <section>
      <h2>Where are your keys?</h2>
      <p className="hint">
        Your Langfuse keys live in a small text file (an env file) that you keep private. Pick it
        here. This page never opens the file and never shows a key. It only checks that both keys
        are there.
      </p>
      <p className="current">
        {settings.profile.envFile ? (
          <code>{settings.profile.envFile}</code>
        ) : (
          'No env file chosen yet.'
        )}
      </p>
      <div className="row">
        <button type="button" onClick={() => setPicking(true)}>
          {settings.profile.envFile ? 'Choose another file' : 'Choose the env file'}
        </button>
        {settings.profile.envFile && (
          <button type="button" className="ghost" onClick={() => void verify()} disabled={busy}>
            {busy ? 'Checking…' : 'Check the keys'}
          </button>
        )}
      </div>
      {picking && (
        <FilePicker
          title="Choose your env file"
          mode="file"
          onPick={(path) => void choose(path)}
          onCancel={() => setPicking(false)}
        />
      )}
      {message && <Message {...message} />}
      {checks && (
        <ul className="checks">
          {checks.map((check) => (
            <li key={check.label} className={`check ${check.status}`}>
              <span className="mark" aria-hidden="true">
                {check.status === 'ok'
                  ? '✓'
                  : check.status === 'warn'
                    ? '!'
                    : check.status === 'fail'
                      ? '✗'
                      : '·'}
              </span>
              <div>
                <div className="label">{check.label}</div>
                <div className="detail">{check.detail}</div>
                {check.fix && check.status !== 'ok' && (
                  <div className="fix">
                    Fix: <code>{check.fix}</code>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function useDiscovery() {
  const [found, setFound] = useState<Discovery | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setFound(await fetchDiscovery());
    } catch {
      setFound(undefined);
      setError(
        'Langfuse did not answer with these keys. Go back and check the address and the env file, then try again.',
      );
    } finally {
      setBusy(false);
    }
  };
  return { found, error, busy, run };
}

function ProjectStep({ discovery }: { discovery: ReturnType<typeof useDiscovery> }) {
  const { found, error, busy, run } = discovery;
  return (
    <section>
      <h2>Which project did your keys open?</h2>
      <p className="hint">
        A pair of keys opens exactly one Langfuse project. Check the name below is the one you
        expect.
      </p>
      <button type="button" onClick={() => void run()} disabled={busy}>
        {busy ? 'Asking Langfuse…' : found ? 'Check again' : 'Ask Langfuse'}
      </button>
      {error && <Message text={error} kind="error" />}
      {found && (
        <p className="project">
          <span className="mark good">✓</span> Project <strong>{found.project.name}</strong>
          <small> ({found.project.id})</small>
        </p>
      )}
    </section>
  );
}

function NamesStep({
  settings,
  reload,
  discovery,
}: Pick<Props, 'settings' | 'reload'> & { discovery: ReturnType<typeof useDiscovery> }) {
  const { found, error, busy, run } = discovery;
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'error' } | undefined>();
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  /** Reload the settings, then ask the project again, and say so until both are done. */
  const refresh = async () => {
    setRefreshing(true);
    try {
      await reload();
      await run();
    } finally {
      setRefreshing(false);
    }
  };

  const set = async (key: string, value: string) => {
    setSaving(true);
    try {
      const result = await saveSetting(key, value);
      if (result.ok) await refresh();
      setMessage(
        result.ok
          ? { text: `✓ Saved ${value}`, kind: 'ok' }
          : { text: result.message, kind: 'error' },
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <h2>What do you call your turns, thumbs and reasons?</h2>
      <p className="hint">
        Your app chose these names, not Jeves. Click the right ones from what your project really
        uses. If a name is missing, no rating has been recorded under it in the last 90 days.
      </p>
      {!found && (
        <>
          <button type="button" onClick={() => void run()} disabled={busy}>
            {busy ? 'Asking Langfuse…' : 'Look at my project'}
          </button>
          {error && <Message text={error} kind="error" />}
        </>
      )}
      {found && (
        <>
          <h3>Which observation holds a question and its answer?</h3>
          <div className="chips">
            {found.observationNames.length === 0 && <p className="hint">No observations found.</p>}
            {found.observationNames.map((name) => (
              <button
                key={name}
                type="button"
                className={name === settings.conventions.turnName ? 'chip on' : 'chip'}
                disabled={saving}
                onClick={() => void set('conventions.turnName', name)}
              >
                {name}
              </button>
            ))}
          </div>
          <h3>Which score is the thumb?</h3>
          <div className="chips">
            {found.scoreNames.length === 0 && <p className="hint">No scores found.</p>}
            {found.scoreNames.map((name) => (
              <button
                key={name}
                type="button"
                className={name === settings.conventions.ratingScore ? 'chip on' : 'chip'}
                disabled={saving}
                onClick={() => void set('conventions.ratingScore', name)}
              >
                {name}
              </button>
            ))}
          </div>
          <Field
            label="Text before each reason"
            help={
              busy || refreshing
                ? 'Reason scores start with this. Checking your project…'
                : `Reason scores start with this. With "${settings.conventions.reasonScorePrefix}" Jeves found ${found.current.reasonScoreNames.length} reason score(s).`
            }
            settingKey="conventions.reasonScorePrefix"
            value={settings.conventions.reasonScorePrefix}
            onSaved={() => void refresh()}
          />
          {found.current.reasonScoreNames.length > 0 && (
            <p className="hint">Found: {found.current.reasonScoreNames.slice(0, 8).join(', ')}</p>
          )}
          <ul className="checks">
            <li className={found.current.turnNameFound ? 'check ok' : 'check warn'}>
              <span className="mark">{found.current.turnNameFound ? '✓' : '!'}</span>
              <div className="detail">
                {found.current.turnNameFound
                  ? `Turns are called "${settings.conventions.turnName}" and Langfuse has them.`
                  : `No observation is called "${settings.conventions.turnName}". Pick one above.`}
              </div>
            </li>
            <li className={found.current.ratingScoreFound ? 'check ok' : 'check warn'}>
              <span className="mark">{found.current.ratingScoreFound ? '✓' : '!'}</span>
              <div className="detail">
                {found.current.ratingScoreFound
                  ? `The thumb score "${settings.conventions.ratingScore}" exists.`
                  : `No score is called "${settings.conventions.ratingScore}". Pick one above.`}
              </div>
            </li>
          </ul>
        </>
      )}
      {message && <Message {...message} />}
    </section>
  );
}

const PROVIDERS = ['litellm', 'openai', 'anthropic', 'gemini'];

function ModelStep({ settings, reload }: Pick<Props, 'settings' | 'reload'>) {
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'error' } | undefined>();
  const choose = async (provider: string) => {
    const result = await saveSetting('llm.provider', provider);
    setMessage(
      result.ok
        ? { text: `✓ Saved ${provider}`, kind: 'ok' }
        : { text: result.message, kind: 'error' },
    );
    if (result.ok) await reload();
  };
  return (
    <section>
      <h2>Do you want a model?</h2>
      <p className="hint">
        Optional. A model lets <code>analyse</code> group the ratings into common problems and lets{' '}
        <code>docs</code> write answers. Customer text is masked before it is sent. You can skip
        this.
      </p>
      <div className="chips">
        {PROVIDERS.map((provider) => (
          <button
            key={provider}
            type="button"
            className={settings.llm.provider === provider ? 'chip on' : 'chip'}
            onClick={() => void choose(provider)}
          >
            {provider}
          </button>
        ))}
      </div>
      {settings.llm.provider && (
        <>
          <Field
            label="Model name"
            help="The model to ask, for example the name your gateway lists."
            settingKey="llm.model"
            value={settings.llm.model ?? ''}
            onSaved={() => void reload()}
          />
          {settings.llm.provider === 'litellm' && (
            <Field
              label="Gateway address"
              help="The address of your LiteLLM gateway."
              settingKey="llm.baseUrl"
              value={settings.llm.baseUrl ?? ''}
              placeholder="https://gateway.example.com"
              onSaved={() => void reload()}
            />
          )}
          <p className="hint">
            The model key goes in your env file as <code>LLM_API_KEY</code>. This page cannot edit
            it.
          </p>
        </>
      )}
      {message && <Message {...message} />}
    </section>
  );
}

function DoneStep({ onFinish }: { onFinish: () => void }) {
  return (
    <section>
      <h2>That is the setup</h2>
      <p className="hint">
        Run the full check to see every link from the config file to your ratings, with a fix for
        anything that is wrong.
      </p>
      <button type="button" onClick={onFinish}>
        Run the full check
      </button>
    </section>
  );
}

/** One plain question per page. Every answer is saved by the CLI, which checks it with its own rules. */
export function Wizard({ settings, reload, onFinish }: Props) {
  const [step, setStep] = useState(0);
  const discovery = useDiscovery();
  const last = STEPS.length - 1;

  return (
    <div className="wizard">
      <Progress step={step} />
      {step === 0 && <AddressStep settings={settings} reload={reload} />}
      {step === 1 && <KeysStep settings={settings} reload={reload} />}
      {step === 2 && <ProjectStep discovery={discovery} />}
      {step === 3 && <NamesStep settings={settings} reload={reload} discovery={discovery} />}
      {step === 4 && <ModelStep settings={settings} reload={reload} />}
      {step === 5 && <DoneStep onFinish={onFinish} />}
      <div className="nav">
        <button
          type="button"
          className="ghost"
          onClick={() => setStep(step - 1)}
          disabled={step === 0}
        >
          Back
        </button>
        {step < last && (
          <button type="button" onClick={() => setStep(step + 1)}>
            {step === 4 ? 'Skip or continue' : 'Next'}
          </button>
        )}
      </div>
    </div>
  );
}
