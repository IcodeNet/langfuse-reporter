import { useEffect, useState } from 'react';
import { browse, type BrowseListing } from './api';

interface Props {
  /** What the user is choosing, for the heading. */
  title: string;
  /** `file` lets a file be picked; `folder` lets the current folder be picked. */
  mode: 'file' | 'folder';
  start?: string;
  onPick: (path: string) => void;
  onCancel: () => void;
}

function join(folder: string, name: string): string {
  return folder.endsWith('/') ? `${folder}${name}` : `${folder}/${name}`;
}

/** Lists names only. The page never opens a file, so it cannot read a key. */
export function FilePicker({ title, mode, start, onPick, onCancel }: Props) {
  const [listing, setListing] = useState<BrowseListing | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [hidden, setHidden] = useState(false);
  const [typed, setTyped] = useState('');

  const open = (path?: string, showHidden = hidden) => {
    setError(undefined);
    browse(path, showHidden)
      .then(setListing)
      .catch(() => setError('That folder cannot be opened.'));
  };

  useEffect(() => {
    open(start);
  }, []);

  return (
    <div className="picker" role="dialog" aria-label={title}>
      <div className="picker-head">
        <strong>{title}</strong>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim() !== '') open(typed.trim());
        }}
      >
        <input
          aria-label="Type a folder path"
          placeholder="Or type a folder path, for example /home/you/keys"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <button type="submit" className="ghost">
          Go
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {listing && (
        <>
          <p className="path">{listing.path}</p>
          <ul className="entries">
            {listing.parent && (
              <li>
                <button
                  type="button"
                  className="entry"
                  onClick={() => open(listing.parent ?? undefined)}
                >
                  📁 ..
                </button>
              </li>
            )}
            {listing.entries.map((entry) => (
              <li key={entry.name}>
                <button
                  type="button"
                  className="entry"
                  onClick={() =>
                    entry.kind === 'dir'
                      ? open(join(listing.path, entry.name))
                      : mode === 'file' && onPick(join(listing.path, entry.name))
                  }
                  disabled={entry.kind === 'file' && mode === 'folder'}
                >
                  {entry.kind === 'dir' ? '📁' : '📄'} {entry.name}
                </button>
              </li>
            ))}
          </ul>
          {listing.truncated && <p className="hint">Only the first entries are shown.</p>}
          {mode === 'folder' && (
            <button type="button" onClick={() => onPick(listing.path)}>
              Use this folder
            </button>
          )}
        </>
      )}
      <label className="hint">
        <input
          type="checkbox"
          checked={hidden}
          onChange={(e) => {
            setHidden(e.target.checked);
            open(listing?.path, e.target.checked);
          }}
        />{' '}
        Show hidden files and folders
      </label>
    </div>
  );
}
