import { describe, expect, it } from 'vitest';
import {
  createWorkspaceInput,
  isValidTimezone,
  slugify,
  updateWorkspaceInput,
} from './workspaces.js';

describe('workspace contracts', () => {
  it('normalises slugs', () => {
    expect(slugify('  Acme Café — Team #1 ')).toBe('acme-cafe-team-1');
    expect(createWorkspaceInput.parse({ name: 'Acme', slug: 'ACME Corp' }).slug).toBe('acme-corp');
    expect(createWorkspaceInput.safeParse({ name: 'Acme', slug: '!!' }).success).toBe(false);
  });

  it('TC-TEN-007-1 validates IANA timezones', () => {
    expect(isValidTimezone('Europe/London')).toBe(true);
    expect(isValidTimezone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('+02:00')).toBe(false);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(updateWorkspaceInput.safeParse({ timezone: 'Not/AZone' }).success).toBe(false);
    expect(updateWorkspaceInput.safeParse({}).success).toBe(false);
  });
});
