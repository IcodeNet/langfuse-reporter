import { describe, expect, it } from 'vitest';
import { DEFAULT_CONVENTIONS } from '../config/config-schema.js';
import { LangfuseClient } from '../langfuse/langfuse-client.js';
import { createDemoFetch } from './demo-fetch.js';
import { buildSampleData } from './sample-data.js';

const NOW = new Date('2026-10-16T12:00:00Z');
const DATA = buildSampleData({ now: NOW, conventions: DEFAULT_CONVENTIONS });

function makeClient(): LangfuseClient {
  return new LangfuseClient({
    baseUrl: 'https://demo.invalid',
    publicKey: 'p',
    secretKey: 's',
    turnName: DEFAULT_CONVENTIONS.turnName,
    fetchImpl: createDemoFetch(DATA),
  });
}

describe('createDemoFetch through the real client', () => {
  it('should return the sample project when the project is asked for', async () => {
    expect(await makeClient().getProject()).toEqual({
      id: 'demo-project',
      name: 'SAMPLE DATA (demo)',
    });
  });

  it('should return every rating score across pages when the scores are listed', async () => {
    const scores = await makeClient().listScores({
      names: [DEFAULT_CONVENTIONS.ratingScore],
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
    });

    expect(scores).toHaveLength(63);
  });

  it('should leave out scores outside the window when the window is narrow', async () => {
    const scores = await makeClient().listScores({
      names: [DEFAULT_CONVENTIONS.ratingScore],
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-02T00:00:00.000Z',
    });

    expect(scores.every((score) => score.timestamp < '2026-09-02T00:00:00.000Z')).toBe(true);
  });

  it('should return the turns of one session in time order when the session is asked for', async () => {
    const [first] = DATA.turns;
    const turns = await makeClient().getTurns('session', first?.sessionId ?? '');

    const times = turns.map((turn) => turn.startTime);

    expect(times).toEqual(times.toSorted());
  });

  it('should return nothing when another observation name is asked for', async () => {
    const client = new LangfuseClient({
      baseUrl: 'https://demo.invalid',
      publicKey: 'p',
      secretKey: 's',
      turnName: 'other-name',
      fetchImpl: createDemoFetch(DATA),
    });

    expect(await client.getTurns('trace', DATA.turns[0]?.traceId ?? '')).toEqual([]);
  });

  it('should list the sample environments when the environments are asked for', async () => {
    expect(await makeClient().listEnvironments(NOW)).toEqual(['preprod', 'uat-like']);
  });

  it('should answer 404 when an endpoint the tool never uses is called', async () => {
    const response = await createDemoFetch(DATA)('https://demo.invalid/api/public/traces');

    expect(response.status).toBe(404);
  });
});
