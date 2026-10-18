import { describe, expect, it } from 'vitest';
import { makeMockRunInfo } from './__mocks__/makeMockRunInfo.mock.js';
import { reproduceCommand } from './run-info.js';

describe('reproduceCommand', () => {
  it('should name the profile and the whole-day window when there is no filter', () => {
    expect(reproduceCommand(makeMockRunInfo())).toBe(
      "jeves --profile 'dev' feedback export --from 2026-10-13 --to 2026-10-15",
    );
  });

  it('should add the filter in quotes when the command is built for pasting into a shell', () => {
    const command = reproduceCommand(makeMockRunInfo({ where: "env = 'uat-like'" }));

    expect(command).toBe(
      "jeves --profile 'dev' feedback export --from 2026-10-13 --to 2026-10-15 --where 'env = '\\''uat-like'\\'''",
    );
  });

  it('should keep the time when the window does not start at midnight', () => {
    const command = reproduceCommand(makeMockRunInfo({ from: '2026-10-13T08:30:00.000Z' }));

    expect(command).toContain('--from 2026-10-13T08:30:00.000Z');
  });
});
