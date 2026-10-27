import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMappings } from '../src/config.js';
import { desiredRoleIds, calculateChanges } from '../src/logic.js';

const grp = '11111111-1111-4111-8111-111111111111';
const rb = '33333333-3333-4333-8333-333333333333';
const rid = '111111111111111111';
const rid2 = '333333333333333333';
const mappings = parseMappings([
  { authentik_type: 'group', authentik_id: grp, discord_role_id: rid },
  { authentik_type: 'role', authentik_id: rb, discord_role_id: rid2 },
]);
const member = (id, current = []) => ({
  id, user: { bot: false }, roles: { cache: new Map(current.map((r) => [r, {}])) },
});

test('maps authentik groups and roles to selected discord roles', () => {
  assert.deepEqual([...desiredRoleIds({ is_active: true, groups: [grp], roles: [rb] }, mappings)], [rid, rid2]);
});
test('inactive user is stripped of all managed roles', () => {
  assert.deepEqual([...desiredRoleIds({ is_active: false, groups: [grp], roles: [rb] }, mappings)], []);
});
test('unmapped roles are never changed', () => {
  const m = member('123456789012345678', [rid, '999999999999999999']);
  const snapshot = { discordToUser: new Map([[m.id, 5]]), usersById: new Map([[5, { is_active: true, groups: [], roles: [rb] }]]) };
  assert.deepEqual(calculateChanges(new Map([[m.id, m]]), snapshot, mappings).changes.map((c) => [c.action, c.roleId]),
    [['remove', rid], ['add', rid2]]);
});
test('unlinked members lose only managed roles in strict mode', () => {
  const m = member('123456789012345678', [rid]);
  const snapshot = { discordToUser: new Map(), usersById: new Map() };
  assert.equal(calculateChanges(new Map([[m.id, m]]), snapshot, mappings, false).changes.length, 0);
  assert.equal(calculateChanges(new Map([[m.id, m]]), snapshot, mappings, true).changes.length, 1);
});
test('duplicate mappings are rejected', () => {
  assert.throws(() => parseMappings([mappings[0], mappings[0]]), /Duplicate/);
});
