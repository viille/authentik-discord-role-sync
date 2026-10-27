import test from 'node:test';
import assert from 'node:assert/strict';
import { accountReply, userSettingsUrl } from '../src/account.js';

const config = {
  authentikUrl: 'https://sso.example.org', sourceSlug: 'discord',
  removeUnlinked: true, dryRun: false,
};

function validateButton(reply) {
  assert.equal(reply.components.length, 1);
  const row = reply.components[0];
  assert.equal(row.type, 1);
  assert.equal(row.components.length, 1);
  const button = row.components[0];
  assert.equal(button.type, 2);
  assert.equal(button.style, 5);
  assert.equal(button.url, 'https://sso.example.org/if/user/#/settings');
  assert.ok(button.label);
}

test('Authentik user settings URL uses documented route', () => {
  assert.equal(userSettingsUrl('https://sso.example.org/'), 'https://sso.example.org/if/user/#/settings');
  assert.throws(() => userSettingsUrl('http://sso.example.org'), /HTTPS/);
});

test('/link has actionable Authentik settings button and source instructions', () => {
  const reply = accountReply('link', config);
  validateButton(reply);
  assert.match(reply.content, /Connect/);
  assert.match(reply.content, /Discord/);
  assert.match(reply.content, /olemassa olevalle/);
});

test('/unlink has actionable button and accurately explains role removal', () => {
  const reply = accountReply('unlink', config);
  validateButton(reply);
  assert.match(reply.content, /Disconnect/);
  assert.match(reply.content, /poistuvat seuraavalla onnistuneella synkronoinnilla/);
  assert.match(reply.content, /ei itse katkaise yhteyttä/);
});

test('/unlink does not claim role removal with REMOVE_UNLINKED=false', () => {
  const reply = accountReply('unlink', { ...config, removeUnlinked: false });
  assert.match(reply.content, /ei automaattisesti poisteta/);
  assert.match(reply.content, /REMOVE_UNLINKED=false/);
});

test('/unlink explains DRY_RUN effect', () => {
  const reply = accountReply('unlink', { ...config, dryRun: true });
  assert.match(reply.content, /DRY_RUN=true/);
  assert.match(reply.content, /testilokissa/);
});

test('unexpected account command fails closed', () => {
  assert.throws(() => accountReply('delete', config), /Unsupported/);
});
