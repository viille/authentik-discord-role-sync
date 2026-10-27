import test from 'node:test';
import assert from 'node:assert/strict';
import { accountReply, userSettingsUrl } from '../src/account.js';

const config = {
  authentikUrl: 'https://sso.example.org', sourceSlug: 'discord',
  removeUnlinked: true, dryRun: false, unlinkApiToken: null,
};

test('Authentik user settings uses documented route', () => {
  assert.equal(userSettingsUrl(config.authentikUrl), 'https://sso.example.org/if/user/#/settings');
  assert.throws(() => userSettingsUrl('http://sso.example.org'), /HTTPS/);
});

test('/link points to authentik settings', () => {
  const r = accountReply('link', config);
  assert.equal(r.components[0].components[0].style, 5);
  assert.match(r.content, /Connected services/);
});

test('/unlink without write access uses authentik settings', () => {
  const r = accountReply('unlink', config, '123456789012345678');
  assert.equal(r.components[0].components.length, 1);
  assert.match(r.content, /Disconnect/);
});

test('/unlink with write token adds explicit user-scoped confirmation', () => {
  const r = accountReply('unlink', { ...config, unlinkApiToken: 'separate-token' }, '123456789012345678');
  assert.equal(r.components[0].components[1].style, 4);
  assert.equal(r.components[0].components[1].custom_id, 'unlink:confirm:123456789012345678');
  assert.match(r.content, /Varmista ensin/);
});

test('/unlink does not promise removal when REMOVE_UNLINKED=false', () => {
  const r = accountReply('unlink', { ...config, removeUnlinked: false });
  assert.match(r.content, /ei automaattisesti poisteta/);
});

test('unexpected account command fails closed', () => {
  assert.throws(() => accountReply('invalid', config), /Unsupported/);
});
