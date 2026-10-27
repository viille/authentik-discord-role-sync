import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthentikClient } from '../src/authentik.js';

const discordId = '123456789012345678';
const validUser = {
  pk: 17,
  is_active: true,
  groups: ['11111111-1111-4111-8111-111111111111'],
  roles: [],
};
const connection = {
  user: 17,
  identifier: discordId,
  source_obj: { slug: 'discord' },
};

function fakeFetch(connections, users, status = 200) {
  return async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer fake-token');
    const { pathname, searchParams } = new URL(url);
    if (status !== 200) return { ok: false, status };
    const records = pathname.includes('user_connections') ? connections : users;
    assert.equal(searchParams.get('page'), '1');
    return {
      ok: true,
      json: async () => ({ pagination: { total_pages: 1 }, results: records }),
    };
  };
}

const client = () => new AuthentikClient({ authentikUrl: 'https://example.test', authentikToken: 'fake-token', sourceSlug: 'discord' });

test('snapshot connects Discord ID to authentik user primary key', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch([connection], [validUser]);
  try {
    const data = await client().snapshot();
    assert.equal(data.discordToUser.get(discordId), 17);
    assert.deepEqual(data.usersById.get(17), validUser);
  } finally { globalThis.fetch = originalFetch; }
});

test('ambiguous Discord account connections abort the entire run', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch([connection, { ...connection, user: 18 }], [validUser]);
  try {
    await assert.rejects(() => client().snapshot(), /linked to multiple/);
  } finally { globalThis.fetch = originalFetch; }
});

test('Auth API failure stops sync rather than treating members as unlinked', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch([], [], 403);
  try {
    await assert.rejects(() => client().snapshot(), /API 403/);
  } finally { globalThis.fetch = originalFetch; }
});
