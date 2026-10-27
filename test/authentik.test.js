import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthentikClient } from '../src/authentik.js';

const discordId = '123456789012345678';
const groupId = '11111111-1111-4111-8111-111111111111';
const inheritedRoleId = '33333333-3333-4333-8333-333333333333';
const validUser = { pk: 17, is_active: true, groups: [groupId], roles: [] };
const connection = {
  pk: 101, user: 17, identifier: discordId, source_obj: { slug: 'discord' },
};
const client = () => new AuthentikClient({
  authentikUrl: 'https://example.test',
  authentikToken: 'fake-token', sourceSlug: 'discord',
  unlinkApiToken: 'delete-only-token',
});

function fakeFetch(connections, users, { status = 200, group = null } = {}) {
  return async (url, options) => {
    const pathname = new URL(url).pathname;
    if (options?.method === 'DELETE') {
      assert.equal(pathname, '/api/v3/sources/user_connections/oauth/101/');
      assert.equal(options.headers.Authorization, 'Bearer delete-only-token');
      return { status: 204 };
    }
    assert.equal(options.headers.Authorization, 'Bearer fake-token');
    if (status !== 200) return { ok: false, status };
    const records = pathname.includes('user_connections') ? connections : users;
    return {
      ok: true,
      json: async () => pathname.includes('/core/groups/')
        ? group
        : ({ pagination: { total_pages: 1 }, results: records }),
    };
  };
}

test('snapshot connects Discord source ID to the correct authentik user', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = fakeFetch([connection], [validUser]);
  try {
    const data = await client().snapshot();
    assert.equal(data.discordToUser.get(discordId), 17);
    assert.equal(data.connectionsByDiscordId.get(discordId), 101);
  } finally { globalThis.fetch = old; }
});

test('incomplete user list is a fatal error, not an unlink event', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = fakeFetch([connection], []);
  try {
    await assert.rejects(() => client().snapshot(), /Incomplete authentik user list/);
  } finally { globalThis.fetch = old; }
});

test('duplicate connections abort entire run', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = fakeFetch([connection, { ...connection, pk: 102 }], [validUser]);
  try {
    await assert.rejects(() => client().snapshot(), /Multiple authentik source connections/);
  } finally { globalThis.fetch = old; }
});

test('authentik API error fails closed', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = fakeFetch([], [], { status: 403 });
  try {
    await assert.rejects(() => client().snapshot(), /API 403/);
  } finally { globalThis.fetch = old; }
});

test('effective-role group lookup includes inherited roles', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = fakeFetch([connection], [validUser], {
    group: { pk: groupId, roles: [], inherited_roles_obj: [{ pk: inheritedRoleId }] },
  });
  try {
    const data = await client().snapshot({
      mappings: [{ authentik_type: 'effective_role', authentik_id: inheritedRoleId }],
    });
    assert.equal(data.groupRoles.get(groupId).has(inheritedRoleId), true);
  } finally { globalThis.fetch = old; }
});

test('missing inherited role information aborts instead of revoking roles', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = fakeFetch([connection], [validUser], { group: { pk: groupId, roles: [] } });
  try {
    await assert.rejects(() => client().snapshot({
      mappings: [{ authentik_type: 'effective_role', authentik_id: inheritedRoleId }],
    }), /Missing inherited role information/);
  } finally { globalThis.fetch = old; }
});

test('confirmed unlink deletes only caller matching source connection', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = fakeFetch([connection], [validUser]);
  try { assert.equal(await client().unlinkSelf(discordId), true); }
  finally { globalThis.fetch = old; }
});

test('unlink without matching connection is harmless', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = fakeFetch([connection], [validUser]);
  try { assert.equal(await client().unlinkSelf('223456789012345678'), false); }
  finally { globalThis.fetch = old; }
});
