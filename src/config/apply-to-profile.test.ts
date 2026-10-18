import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type ConfigFile } from './config-schema.js';
import { applyToProfile } from './apply-to-profile.js';
import { setConfigValue } from './config-store.js';

const TWO_PROFILES: ConfigFile = {
  ...DEFAULT_CONFIG,
  profiles: {
    dev: { baseUrl: 'https://dev.example.com' },
    prod: { baseUrl: 'https://prod.example.com' },
  },
};

describe('applyToProfile', () => {
  it('should change the active profile when no override is given', () => {
    const next = applyToProfile(TWO_PROFILES, undefined, (file) =>
      setConfigValue(file, 'profile.envFile', '/tmp/dev.env'),
    );

    expect(next.profiles.dev?.envFile).toBe('/tmp/dev.env');
  });

  it('should change the overridden profile and leave the active one alone when an override is given', () => {
    const next = applyToProfile(TWO_PROFILES, 'prod', (file) =>
      setConfigValue(file, 'profile.envFile', '/tmp/prod.env'),
    );

    expect(next.profiles.prod?.envFile).toBe('/tmp/prod.env');
    expect(next.profiles.dev?.envFile).toBeUndefined();
  });

  it('should keep the saved active profile when an override is edited', () => {
    const next = applyToProfile(TWO_PROFILES, 'prod', (file) => file);

    expect(next.activeProfile).toBe('dev');
  });

  it('should name the known profiles when the override does not exist', () => {
    expect(() => applyToProfile(TWO_PROFILES, 'ghost', (file) => file)).toThrow(
      'Existing: dev, prod',
    );
  });
});
