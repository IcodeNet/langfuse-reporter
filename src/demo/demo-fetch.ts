import type { SampleData } from './sample-data.js';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function notFound(path: string): Response {
  return new Response(JSON.stringify({ message: `The demo has no ${path}` }), {
    status: 404,
    statusText: 'Not Found',
  });
}

/** One page of a list: `limit` items from the offset the cursor names, and the cursor of the next page. */
function page<T>(
  items: readonly T[],
  params: URLSearchParams,
): { data: T[]; meta: { cursor?: string } } {
  const limit = Number(params.get('limit') ?? items.length) || items.length;
  const offset = Number(params.get('cursor') ?? 0) || 0;
  const next = offset + limit;
  return {
    data: items.slice(offset, next),
    meta: next < items.length ? { cursor: String(next) } : {},
  };
}

/** Answers the group-by counts the client uses to list environments, observation names and score names. */
function metricsResponse(data: SampleData, params: URLSearchParams): Response {
  const query = JSON.parse(params.get('query') ?? '{}') as {
    view?: string;
    dimensions?: Array<{ field: string }>;
  };
  const field = query.dimensions?.[0]?.field ?? '';
  const valuesByView: Record<string, string[]> = {
    'observations:environment': data.environments,
    'observations:name': [data.turnName],
    'scores-boolean:name': [...new Set(data.scores.map((score) => score.name))],
    'scores-numeric:name': [],
  };
  const values = valuesByView[`${query.view}:${field}`] ?? [];
  return json({ data: values.map((value) => ({ [field]: value })) });
}

function scoresResponse(data: SampleData, params: URLSearchParams): Response {
  const names = (params.get('name') ?? '').split(',').filter(Boolean);
  const from = params.get('fromTimestamp');
  const to = params.get('toTimestamp');
  const traceId = params.get('traceId');
  const observationId = params.get('observationId');
  const matching = data.scores.filter(
    (score) =>
      (names.length === 0 || names.includes(score.name)) &&
      (from === null || score.timestamp >= from) &&
      (to === null || score.timestamp < to) &&
      (traceId === null || score.subject?.traceId === traceId || score.subject?.id === traceId) &&
      (observationId === null || score.subject?.id === observationId),
  );
  return json(page(matching, params));
}

function observationsResponse(data: SampleData, params: URLSearchParams): Response {
  if (params.get('name') !== data.turnName) return json({ data: [], meta: {} });
  const traceId = params.get('traceId');
  const sessionId = params.get('sessionId');
  const matching = data.turns
    .filter(
      (turn) =>
        (traceId === null || turn.traceId === traceId) &&
        (sessionId === null || turn.sessionId === sessionId),
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  return json(page(matching, params));
}

/**
 * A stand-in for `fetch` that answers the four Langfuse calls the tool makes, from the sample data.
 * The real client runs on top of it, so paging and parsing are exercised in demo mode too.
 */
export function createDemoFetch(data: SampleData): typeof fetch {
  return async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    switch (url.pathname) {
      case '/api/public/projects':
        return json({ data: [data.project] });
      case '/api/public/v2/metrics':
        return metricsResponse(data, url.searchParams);
      case '/api/public/v3/scores':
        return scoresResponse(data, url.searchParams);
      case '/api/public/v2/observations':
        return observationsResponse(data, url.searchParams);
      default:
        return notFound(url.pathname);
    }
  };
}
