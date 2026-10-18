import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Diagram } from './Diagram';
import {
  fetchDocPage,
  fetchDocPages,
  searchDocs,
  type DocKind,
  type DocPageInfo,
  type DocSearchHit,
} from './api';

/**
 * Pictures in the pages are not loaded. The page's security policy allows its own files only, and a
 * remote picture would also tell its host that this page was opened. The description text is shown
 * instead. A Mermaid block is drawn as a diagram, and external links open safely.
 */
const COMPONENTS = {
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
    const raw = String(children ?? '');
    if (className === 'language-mermaid') return <Diagram source={raw.replace(/\n$/, '')} />;
    /* A fenced block always ends in a line break, with or without a language name; inline code never does. */
    const isBlock = Boolean(className) || raw.endsWith('\n') || raw.includes('\n');
    if (!isBlock) return <code>{raw}</code>;
    return (
      <pre>
        <code className={className}>{raw.replace(/\n$/, '')}</code>
      </pre>
    );
  },
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="table-scroll">
      <table>{children}</table>
    </div>
  ),
  img: ({ alt }: { alt?: string }) => (alt ? <em className="noimg">[{alt}]</em> : null),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) =>
    href && /^https?:\/\//.test(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
};

/** Markdown pages are formatted; a text page (the settings file) is shown as it is, with its line breaks. */
function Body({ kind, text, limit }: { kind: DocKind; text: string; limit?: number }) {
  const shown = limit && text.length > limit ? `${text.slice(0, limit)}…` : text;
  if (kind === 'text') {
    return (
      <div className="doc-source" role="region" aria-label="Reference text">
        {shown.split('\n').map((line, index) => {
          const indent = line.length - line.trimStart().length;
          const hang = line.trimStart().startsWith('// ') ? 3 : 0;
          return (
            <div
              key={index}
              className="doc-line"
              style={{ paddingLeft: `${indent + hang}ch`, textIndent: `-${hang}ch` }}
            >
              {line.trimStart() || '\u00a0'}
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <Markdown skipHtml remarkPlugins={[remarkGfm]} components={COMPONENTS}>
      {shown}
    </Markdown>
  );
}

/** The same pages `jeves docs` reads, shown in the browser. */
export function Docs() {
  const [pages, setPages] = useState<DocPageInfo[]>([]);
  const [current, setCurrent] = useState<string | undefined>();
  const [body, setBody] = useState<{ title: string; text: string; kind: DocKind } | undefined>();
  const [question, setQuestion] = useState('');
  const [hits, setHits] = useState<DocSearchHit[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    fetchDocPages()
      .then((list) => {
        setPages(list);
        setCurrent(list.find((page) => page.name === 'readme')?.name ?? list[0]?.name);
      })
      .catch(() => setError('The documentation could not be loaded.'));
  }, []);

  useEffect(() => {
    if (!current) return;
    setError(undefined);
    fetchDocPage(current)
      .then(setBody)
      .catch(() => setError('That page could not be loaded.'));
  }, [current]);

  const search = async () => {
    const asked = question.trim();
    if (asked === '') {
      setHits(undefined);
      return;
    }
    try {
      setHits(await searchDocs(asked));
    } catch {
      setError('The search failed.');
    }
  };

  return (
    <section>
      <h2>Documentation</h2>
      <p className="hint">
        The same pages the <code>docs</code> command reads. Search them, or pick a page.
      </p>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <input
          aria-label="Search the documentation"
          placeholder="For example: how do I connect LiteLLM"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button type="submit">Search</button>
      </form>
      {error && <p className="error">{error}</p>}
      {hits && (
        <div className="hits">
          <h3>
            {hits.length === 0 ? 'Nothing found. Try other words.' : `${hits.length} best matches`}
          </h3>
          {hits.map((hit) => (
            <article key={`${hit.page}-${hit.heading}`} className="hit">
              <h4>
                {hit.heading} <span className="word">in {hit.title}</span>
              </h4>
              <Body kind={hit.kind} text={hit.text} limit={900} />
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setHits(undefined);
                  setCurrent(hit.page);
                }}
              >
                Open the whole page
              </button>
            </article>
          ))}
        </div>
      )}
      <div className="chips" role="group" aria-label="Documentation pages">
        {pages.map((page) => (
          <button
            key={page.name}
            type="button"
            className={page.name === current ? 'chip on' : 'chip'}
            onClick={() => {
              setHits(undefined);
              setCurrent(page.name);
            }}
          >
            {page.title}
          </button>
        ))}
      </div>
      {body && !hits && (
        <article className="doc">
          <Body kind={body.kind} text={body.text} />
        </article>
      )}
    </section>
  );
}
