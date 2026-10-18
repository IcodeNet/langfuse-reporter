import { describe, expect, it } from 'vitest';
import { isProduction, productionWarning } from './production.js';

describe('isProduction', () => {
  it.each([
    ['prod', undefined],
    ['production', undefined],
    ['Prod', undefined],
    ['dev', 'acme-production'],
    ['eu-prod', undefined],
    ['dev', 'acme-prod'],
  ])('should be true when the profile is %s and the project is %s', (profile, project) => {
    expect(isProduction(profile, project)).toBe(true);
  });

  it.each([
    ['dev', 'acme-development'],
    ['preprod', 'acme-preprod'],
    ['qa', undefined],
    ['product-review', undefined],
    ['dev', undefined],
  ])('should be false when the profile is %s and the project is %s', (profile, project) => {
    expect(isProduction(profile, project)).toBe(false);
  });
});

describe('productionWarning', () => {
  it('should name the profile and the project when production is in use', () => {
    expect(productionWarning('prod', 'acme-production')).toContain(
      'profile "prod" reads project "acme-production"',
    );
  });
});
