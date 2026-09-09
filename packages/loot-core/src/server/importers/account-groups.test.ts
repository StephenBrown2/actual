import { beforeEach, describe, expect, it, vi } from 'vitest';

import { send } from '#server/main-app';

import { resolveAccountGroups } from './account-groups';

vi.mock('#server/main-app', () => ({
  send: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(send).mockReset();
});

describe('resolveAccountGroups', () => {
  it('maps names to existing group ids without creating anything', async () => {
    vi.mocked(send).mockImplementation(async method => {
      if (method === 'api/account-groups-get') {
        return [{ id: 'g1', name: 'Checking' }];
      }
      throw new Error(`unexpected call: ${method}`);
    });

    const groupIds = await resolveAccountGroups(['Checking']);

    expect(groupIds.get('Checking')).toBe('g1');
  });

  it('creates a group for each new name exactly once, even with duplicates', async () => {
    vi.mocked(send).mockImplementation(async (method, payload) => {
      if (method === 'api/account-groups-get') {
        return [];
      }
      if (method === 'api/account-group-create') {
        return `new-${(payload as { group: { name: string } }).group.name}`;
      }
      throw new Error(`unexpected call: ${method}`);
    });

    const groupIds = await resolveAccountGroups([
      'Checking',
      'Checking',
      'Savings',
      null,
      undefined,
      '',
    ]);

    expect(groupIds.get('Checking')).toBe('new-Checking');
    expect(groupIds.get('Savings')).toBe('new-Savings');
    expect(
      vi
        .mocked(send)
        .mock.calls.filter(([method]) => method === 'api/account-group-create'),
    ).toHaveLength(2);
  });

  it('reuses an existing group instead of recreating it', async () => {
    vi.mocked(send).mockImplementation(async method => {
      if (method === 'api/account-groups-get') {
        return [{ id: 'g1', name: 'Checking' }];
      }
      throw new Error(`unexpected call: ${method}`);
    });

    await resolveAccountGroups(['Checking']);

    expect(
      vi
        .mocked(send)
        .mock.calls.some(([method]) => method === 'api/account-group-create'),
    ).toBe(false);
  });
});
