import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StateStore, configurationKey } from '../src/state.js';

function tempStore(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'role-sync-state-'));
  try { fn(path.join(dir, 'state.json')); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const config = {
  guildId: '123456789012345678',
  authentikUrl: 'https://sso.example.org', sourceSlug: 'discord',
  removeUnlinked: true,
  mappings: [{ authentik_type: 'group', authentik_id: '11111111-1111-4111-8111-111111111111', discord_role_id: '222222222222222222' }],
};

test('new installation is deactivated until preview and confirmation', () => tempStore((file) => {
  const store = new StateStore(file, configurationKey(config));
  assert.equal(store.state.activated, false);
  assert.throws(() => store.activate('admin'), /dryrun/);
  store.recordPreview();
  assert.equal(store.activate('admin'), true);
  const restarted = new StateStore(file, configurationKey(config));
  assert.equal(restarted.state.activated, true);
  assert.equal(restarted.history()[0].action, 'activated');
}));

test('mapping change invalidates activation and last baseline', () => tempStore((file) => {
  const key = configurationKey(config);
  const store = new StateStore(file, key);
  store.recordPreview();
  store.activate('admin');
  store.setBaseline({ linkedCount: 15, usersById: new Map() }, 50);
  const modified = { ...config, mappings: [...config.mappings, {
    authentik_type: 'group', authentik_id: '22222222-2222-4222-8222-222222222222', discord_role_id: '333333333333333333',
  }] };
  const restarted = new StateStore(file, configurationKey(modified));
  assert.equal(restarted.state.activated, false);
  assert.equal(restarted.state.baseline, null);
  assert.equal(restarted.history()[0].action, 'deactivated');
}));

test('corrupted state prevents silent reactivation', () => tempStore((file) => {
  fs.writeFileSync(file, '{invalid');
  assert.throws(() => new StateStore(file, configurationKey(config)), /Unsafe state file/);
}));

test('audit history survives a process restart', () => tempStore((file) => {
  const key = configurationKey(config);
  const store = new StateStore(file, key);
  store.appendAudit({ action: 'remove', discordId: '123', roleId: '456' });
  const next = new StateStore(file, key);
  assert.equal(next.history()[0].discordId, '123');
}));

test('loosening safety thresholds invalidates activation', () => tempStore((file) => {
  const original = { ...config, maxRemovals: 10, maxMutations: 50, maxLinkDropPercent: 25, minLinkedUsers: 1 };
  const store = new StateStore(file, configurationKey(original));
  store.recordPreview();
  store.activate('admin');
  const modified = { ...original, maxRemovals: 100 };
  const restarted = new StateStore(file, configurationKey(modified));
  assert.equal(restarted.state.activated, false);
}));
