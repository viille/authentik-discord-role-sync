import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { synchronize, formatSyncResult } from '../src/sync.js';
import { desiredRoleIds, calculateChanges } from '../src/logic.js';

const gid = '11111111-1111-4111-8111-111111111111';
const inherited = '33333333-3333-4333-8333-333333333333';
const rid = '444444444444444444';

function context(size, { linkedCount = size, desired = false, baseline = null } = {}) {
  const actions = [];
  const usersById = new Map();
  const discordToUser = new Map();
  const members = new Map();
  for (let i = 0; i < size; i++) {
    const id = String(BigInt('123456789012345678') + BigInt(i));
    const pk = i + 1;
    const member = {
      id, user: { bot: false }, roles: {
        cache: new Map([[rid, true]]),
        add: async () => actions.push('add'),
        remove: async () => actions.push('remove'),
      },
    };
    members.set(id, member);
    if (i < linkedCount) {
      discordToUser.set(id, pk);
      usersById.set(pk, { is_active: true, groups: desired ? [gid] : [], roles: [] });
    }
  }
  const snapshot = { linkedCount, usersById, discordToUser, groupRoles: new Map() };
  const guild = {
    memberCount: size,
    members: {
      fetchMe: async () => ({ permissions: { has: (x) => x === PermissionFlagsBits.ManageRoles }, roles: { highest: { position: 10 } } }),
      fetch: async () => members,
    },
    roles: { fetch: async () => new Map([[rid, { managed: false, position: 3 }]]) },
  };
  const authentik = { snapshot: async () => snapshot };
  const config = {
    mappings: [{ authentik_type: 'group', authentik_id: gid, discord_role_id: rid }],
    dryRun: false, minLinkedUsers: 1, removeUnlinked: true,
    maxMutations: 50, maxRemovals: 10, maxLinkDropPercent: 25,
  };
  return { guild, authentik, config, log: () => {}, actions, baseline };
}

test('bulk removals blocked by dedicated limit', async () => {
  const c = context(11);
  await assert.rejects(() => synchronize(c), /MAX_REMOVALS_PER_RUN/);
  assert.equal(c.actions.length, 0);
});

test('preview can report a blocked LIVE run without changing roles', async () => {
  const c = context(11);
  const r = await synchronize({ ...c, dryRun: true });
  assert.equal(r.overRemovalLimit, true);
  assert.equal(c.actions.length, 0);
  assert.match(formatSyncResult(r, true), /LIVE-ajo estettäisiin/);
});

test('suspicious drop in linked users blocks LIVE removals', async () => {
  const c = context(10, { linkedCount: 5, baseline: { linked: 10 } });
  await assert.rejects(() => synchronize(c), /Suspicious decrease/);
  assert.equal(c.actions.length, 0);
});

test('missing Authentik user in source map aborts role planning', () => {
  const id = '123456789012345678';
  const snapshot = { discordToUser: new Map([[id, 99]]), usersById: new Map() };
  const members = new Map([[id, { id, user: { bot: false }, roles: { cache: new Map([[rid, true]]) } }]]);
  assert.throws(() => calculateChanges(members, snapshot, [{ authentik_type: 'group', authentik_id: gid, discord_role_id: rid }]), /Incomplete authentik data/);
});

test('effective role combines direct and inherited group roles', () => {
  const mappings = [{ authentik_type: 'effective_role', authentik_id: inherited, discord_role_id: rid }];
  const user = { is_active: true, groups: [gid], roles: [] };
  assert.equal(desiredRoleIds(user, mappings, new Map([[gid, new Set([inherited])]])).has(rid), true);
  assert.equal(desiredRoleIds(user, mappings, new Map()).has(rid), false);
});
