/** The whole day, UTC, as a date the CLI accepts (2026-09-01). */
function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export interface Preset {
  id: string;
  label: string;
  window: (now: Date) => { from: string; to: string };
}

/** Windows people ask for in words. The end date is exclusive, like the CLI's. */
export const PRESETS: Preset[] = [
  {
    id: 'last-month',
    label: 'Last month',
    window: (now) => ({
      from: day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))),
      to: day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
    }),
  },
  {
    id: 'this-month',
    label: 'This month so far',
    window: (now) => ({
      from: day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
      to: day(addDays(now, 1)),
    }),
  },
  {
    id: '7d',
    label: 'Last 7 days',
    window: (now) => ({ from: day(addDays(now, -6)), to: day(addDays(now, 1)) }),
  },
  {
    id: '30d',
    label: 'Last 30 days',
    window: (now) => ({ from: day(addDays(now, -29)), to: day(addDays(now, 1)) }),
  },
];

/** The preset whose window equals these dates today, or undefined once the dates are edited to something else. */
export function activePreset(from: string, to: string, now: Date): string | undefined {
  return PRESETS.find((preset) => {
    const window = preset.window(now);
    return window.from === from && window.to === to;
  })?.id;
}
