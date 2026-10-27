import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { synchronize, formatSyncResult } from '../src/sync.js';

const group = '11111111-1111-4111-8111-111111111111';
const roleId = '111111111111111111';
const linkedId = '123456789012345678';
const unlinkedId = '223456789012345678';

function setup(maxMutations = 2) {
  const actions = [];
  function member(id, hasRole) {
    return {
      id,
      user: { bot: false },
      roles: {
        cache: new Map(hasRole ? [[roleId, {}]] : []),
        add: async (role) => { actions.push(['add', id, role]); },
        remove: async (role) => { actions.push(['remove', id, role]); },
      },
    };
  }
  const members = new Map([
    [linkedId, member(linkedId, false)],
    [unlinkedId, member(unlinkedId, true)],
  ]);
  const guild = {
    memberCount: members.size,
    members: {
      fetchMe: async () => ({
        permissions: { has: (p) => p === PermissionFlagsBits.ManageRoles },
        roles: { highest: { position: 10 } },
      }),
      fetch: async () => members,
    },
    roles: { fetch: async () => new Map([[roleId, { name: 'Synced', managed: false, position: 5 }]]) },
  };
  const authentik = {
    snapshot: async () => ({
      linkedCount: 1,
      discordToUser: new Map([[linkedId, 77]]),
      usersById: new Map([[77, { is_active: true, groups: [group], roles: [] }]]),
    }),
  };
  const config = {
    dryRun: false, removeUnlinked: true,
    minLinkedUsers: 1, maxMutations,
    mappings: [{ authentik_type: 'group', authentik_id: group, discord_role_id: roleId }],
  };
  return { actions, guild, authentik, config, log: () => {} };
}

test('slash-command dryrun override never changes roles, even with live config', async () => {
  const ctx = setup(1);
  const result = await synchronize({ ...ctx, dryRun: true });
  assert.equal(ctx.config.dryRun, false);
  assert.equal(result.dryRun, true);
  assert.equal(result.planned, 2);
  assert.equal(result.plannedAdds, 1);
  assert.equal(result.plannedRemoves, 1);
  assert.equal(result.overMutationLimit, true);
  assert.equal(ctx.actions.length, 0);
  assert.match(formatSyncResult(result, true), /DRY RUN/);
  assert.match(formatSyncResult(result, true), /LIVE-ajo estettäisiin/);
  assert.match(formatSyncResult(result, true), /add/);
  assert.match(formatSyncResult(result, true), /remove/);
});

test('live sync uses false default and applies add/remove', async () => {
  const ctx = setup();
  const result = await synchronize(ctx);
  assert.equal(result.dryRun, false);
  assert.equal(result.added, 1);
  assert.equal(result.removed, 1);
  assert.deepEqual(ctx.actions, [['add', linkedId, roleId], ['remove', unlinkedId, roleId]]);
  assert.match(formatSyncResult(result), /LIVE/);
});

test('live sync still enforces mutation safety ceiling', async () => {
  const ctx = setup(1);
  await assert.rejects(() => synchronize(ctx), /Safety limit/);
  assert.deepEqual(ctx.actions, []);
});

test('preview from config DRY_RUN=true is read-only', async () => {
  const ctx = setup();
  ctx.config.dryRun = true;
  const result = await synchronize(ctx);
  assert.equal(result.dryRun, true);
  assert.deepEqual(ctx.actions, []);
});
