import type { Conventions } from '../config/config-schema.js';
import { lastMonthWindow } from '../config/resolve-config.js';
import type { LangfuseProject, LangfuseScore, LangfuseTurn } from '../langfuse/langfuse-client.js';
import { DEMO_PROJECT_NAME } from './demo-constants.js';

export interface SampleData {
  project: LangfuseProject;
  /** The observation name the sample turns were made for; the fake API only serves that name. */
  turnName: string;
  scores: LangfuseScore[];
  turns: LangfuseTurn[];
  environments: string[];
}

export interface SampleRequest {
  now: Date;
  conventions: Conventions;
}

const RATED_TURNS = 60;
const TRACE_LEVEL_RATINGS = 3;
const USERS = 20;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

interface Topic {
  question: string;
  goodAnswer: string;
  badAnswer: string;
}

const TOPICS: readonly Topic[] = [
  {
    question: 'How do I reset my password?',
    goodAnswer:
      'Open Settings, choose Security, then Reset password. We email you a link that works for one hour.',
    badAnswer: 'Passwords are managed by your administrator.',
  },
  {
    question: 'Can I export my data?',
    goodAnswer: 'Yes. Go to Account, then Export. You get a file within a few minutes.',
    badAnswer: 'Exports are not available.',
  },
  {
    question: 'Why was my payment declined?',
    goodAnswer:
      'The most common causes are an expired card or a billing address that does not match. Check both under Billing.',
    badAnswer: 'Payments are always accepted, so this cannot have happened.',
  },
  {
    question: 'How do I change my notification settings?',
    goodAnswer: 'Under Settings, choose Notifications. Each type can be turned off on its own.',
    badAnswer: 'Please see our website.',
  },
  {
    question: 'What are your opening hours?',
    goodAnswer:
      'Support is open Monday to Friday, 8am to 6pm UK time. The chat assistant is always available.',
    badAnswer: 'We are open at all times, including weekends, with a person on every call.',
  },
  {
    question: 'How do I close my account?',
    goodAnswer:
      'Go to Account, then Close account. You can download your data first. Closing takes effect after 30 days.',
    badAnswer: 'I am not able to help with that. Try something else.',
  },
  {
    question: 'Is my data stored in the UK?',
    goodAnswer: 'Customer data is stored in UK data centres. Backups stay in the same region.',
    badAnswer: 'Data is stored wherever is cheapest.',
  },
  {
    question: 'Can I add a second user to my account?',
    goodAnswer:
      'Yes. Under Team, choose Invite and enter their email. They get access once they accept.',
    badAnswer: 'Each account has exactly one user and this cannot change.',
  },
];

const NEGATIVE_COMMENTS = [
  'This did not answer my question.',
  'The answer was wrong.',
  'Too vague to be useful.',
  'Please let me talk to a person. You can reach me at {email}.',
  'Not what I asked. Call me on {phone}.',
];

const POSITIVE_COMMENTS = ['Thanks, that worked.', 'Clear and quick.', 'Exactly what I needed.'];

/** A small seeded generator, so the same sample data comes out on every run. */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pick<T>(random: () => number, list: readonly T[]): T {
  const item = list[Math.floor(random() * list.length)];
  if (item === undefined) throw new Error('Cannot pick from an empty list');
  return item;
}

function pad(number: number, width = 2): string {
  return String(number).padStart(width, '0');
}

/** Addresses on example.com and numbers in the range Ofcom keeps for drama, so none belongs to a real person. */
function fakeEmail(random: () => number): string {
  return `customer${pad(Math.floor(random() * 90) + 10)}@example.com`;
}

function fakePhone(random: () => number): string {
  return `07700 900${pad(Math.floor(random() * 1000), 3)}`;
}

function withPersonalDetails(text: string, random: () => number): string {
  const roll = random();
  if (roll < 0.15) return `${text} My email is ${fakeEmail(random)}.`;
  if (roll < 0.25) return `${text} You can call me on ${fakePhone(random)}.`;
  if (roll < 0.3) return `${text} My test card is 4111 1111 1111 1111.`;
  return text;
}

function fillComment(template: string, random: () => number): string {
  return template.replace('{email}', fakeEmail(random)).replace('{phone}', fakePhone(random));
}

interface ReasonPools {
  negative: readonly string[];
  positive: readonly string[];
}

/** The first half of the configured reasons are for a thumbs down, the rest for a thumbs up. */
function splitReasons(reasons: readonly string[]): ReasonPools {
  const cut = Math.ceil(reasons.length / 2);
  return { negative: reasons.slice(0, cut), positive: reasons.slice(cut) };
}

function someOf(random: () => number, pool: readonly string[]): string[] {
  if (pool.length === 0) return [];
  const first = pick(random, pool);
  const second = pick(random, pool);
  return random() < 0.4 && second !== first ? [first, second] : [first];
}

export function buildSampleData({ now, conventions }: SampleRequest): SampleData {
  const random = makeRandom(20_261_016);
  const start = Date.parse(lastMonthWindow(now).from);
  const latestStart = Date.parse(lastMonthWindow(now).to) - HOUR_MS;
  const reasons = splitReasons(conventions.reasons);
  const yes = conventions.yesValues[0] ?? 'true';
  const environments = ['uat-like', 'preprod'];
  const turns: LangfuseTurn[] = [];
  const scores: LangfuseScore[] = [];
  let scoreNumber = 0;

  const addScore = (score: Omit<LangfuseScore, 'id' | 'updatedAt'>): void => {
    scoreNumber += 1;
    scores.push({ ...score, id: `demo-score-${pad(scoreNumber, 4)}`, updatedAt: score.timestamp });
  };

  for (let index = 0; index < RATED_TURNS; index += 1) {
    const topic = pick(random, TOPICS);
    const environment = random() < 0.85 ? 'uat-like' : 'preprod';
    const userId = `demo-user-${pad((index % USERS) + 1)}`;
    const sessionId = `demo-session-${pad(index + 1, 3)}`;
    const turnCount = 1 + Math.floor(random() * 3);
    const ratedPosition = Math.floor(random() * turnCount);
    const base = start + Math.pow(random(), 0.5) * (latestStart - start - 4 * MINUTE_MS);
    const positive = random() >= 0.35;

    for (let position = 0; position < turnCount; position += 1) {
      const isRated = position === ratedPosition;
      const other = pick(random, TOPICS);
      const shown = isRated ? topic : other;
      const answer = isRated && !positive ? shown.badAnswer : shown.goodAnswer;
      turns.push({
        id: `demo-obs-${pad(index + 1, 3)}-${position + 1}`,
        traceId: `demo-trace-${pad(index + 1, 3)}-${position + 1}`,
        sessionId,
        userId,
        environment,
        startTime: new Date(base + (position - ratedPosition) * 2 * MINUTE_MS).toISOString(),
        input: isRated ? withPersonalDetails(shown.question, random) : shown.question,
        output: answer,
      });
      if (!isRated) continue;

      const rated = turns[turns.length - 1];
      if (!rated) continue;
      const ratedAt = new Date(
        Date.parse(rated.startTime) + (1 + Math.floor(random() * 29)) * MINUTE_MS,
      );
      const subject = { kind: 'observation', id: rated.id, traceId: rated.traceId };
      const wantsComment = random() < 0.4;
      const commentPool = positive ? POSITIVE_COMMENTS : NEGATIVE_COMMENTS;
      addScore({
        name: conventions.ratingScore,
        value: positive ? yes : 'false',
        comment: wantsComment ? fillComment(pick(random, commentPool), random) : null,
        timestamp: ratedAt.toISOString(),
        environment,
        subject,
      });
      for (const reason of someOf(random, positive ? reasons.positive : reasons.negative)) {
        addScore({
          name: `${conventions.reasonScorePrefix}${reason}`,
          value: yes,
          comment: null,
          timestamp: ratedAt.toISOString(),
          environment,
          subject,
        });
      }
    }
  }

  for (let index = 0; index < TRACE_LEVEL_RATINGS; index += 1) {
    const turn = turns[index * 7];
    if (!turn) continue;
    addScore({
      name: conventions.ratingScore,
      value: yes,
      comment: null,
      timestamp: new Date(Date.parse(turn.startTime) + 5 * MINUTE_MS).toISOString(),
      environment: turn.environment,
      subject: { kind: 'trace', id: turn.traceId },
    });
  }

  scores.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return {
    project: { id: 'demo-project', name: DEMO_PROJECT_NAME },
    turnName: conventions.turnName,
    scores,
    turns,
    environments,
  };
}
