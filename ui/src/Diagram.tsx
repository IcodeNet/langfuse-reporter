import { useEffect, useId, useState } from 'react';

/**
 * Draws a Mermaid diagram from its text. The library is loaded only when a page holds a diagram, so
 * the first screen stays small. The text comes from the package's own bundled pages. It is drawn with
 * Mermaid's strict mode, which refuses scripts and links in labels, and the result is shown as an image
 * element and not as page HTML, so nothing in the diagram text can run. Labels are plain SVG text, because
 * a picture loaded from an SVG must be strict XML and the default HTML labels are not.
 */
export function Diagram({ source }: { source: string }) {
  const id = `diagram-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [picture, setPicture] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setPicture(undefined);
    setFailed(false);
    import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          htmlLabels: false,
          flowchart: { htmlLabels: false, useMaxWidth: false },
          theme: 'dark',
          themeVariables: {
            fontFamily: 'system-ui, sans-serif',
            primaryColor: '#161b22',
            primaryTextColor: '#e6edf3',
            lineColor: '#f5c518',
            primaryBorderColor: '#f5c518',
          },
        });
        const { svg } = await mermaid.render(id, source);
        if (live) setPicture(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id, source]);

  if (failed) {
    return (
      <pre className="diagram-source">
        <code>{source}</code>
      </pre>
    );
  }
  if (!picture) return <p className="hint">Drawing the diagram…</p>;
  return (
    <img className="diagram" src={picture} alt="Diagram of how the data flows through Jeves" />
  );
}
