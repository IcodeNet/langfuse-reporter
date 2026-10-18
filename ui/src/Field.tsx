import { useState } from 'react';
import { saveSetting } from './api';

interface Props {
  label: string;
  help: string;
  settingKey: string;
  value: string;
  placeholder?: string;
  /** Called after the CLI accepted and saved the value. */
  onSaved: (value: string) => void;
}

/** A text setting. It saves through the CLI, so the CLI's rules decide, and shows the CLI's own reason. */
export function Field({ label, help, settingKey, value, placeholder, onSaved }: Props) {
  const [text, setText] = useState(value);
  const [state, setState] = useState<{
    kind: 'idle' | 'saving' | 'saved' | 'error';
    message?: string;
  }>({
    kind: 'idle',
  });

  const save = async () => {
    setState({ kind: 'saving' });
    try {
      const result = await saveSetting(settingKey, text);
      if (result.ok) {
        setState({ kind: 'saved' });
        onSaved(text);
      } else {
        setState({ kind: 'error', message: result.message || 'The value was not accepted.' });
      }
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="field">
      <label htmlFor={settingKey}>{label}</label>
      <p className="hint">{help}</p>
      <div className="row">
        <input
          id={settingKey}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setState({ kind: 'idle' });
          }}
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={state.kind === 'saving' || text === value}
        >
          {state.kind === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </div>
      {state.kind === 'saved' && <p className="ok-text">✓ Saved</p>}
      {state.kind === 'error' && <p className="error">{state.message}</p>}
    </div>
  );
}
