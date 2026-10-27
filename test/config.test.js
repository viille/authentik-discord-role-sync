import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

const env = {
  DISCORD_BOT_TOKEN: 'test-token',
  DISCORD_GUILD_ID: '123456789012345678',
  AUTHENTIK_BASE_URL: 'https://sso.example.org',
  AUTHENTIK_API_TOKEN: 'test-token',
  AUTHENTIK_DISCORD_SOURCE_SLUG: 'discord',
};

test('DRY_RUN defaults to false and remains an explicit override', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'authentik-roles-'));
  const file = path.join(folder, 'roles.json');
  try {
    fs.writeFileSync(file, JSON.stringify([{
      authentik_type: 'group',
      authentik_id: '11111111-1111-4111-8111-111111111111',
      discord_role_id: '111111111111111111',
    }]));
    assert.equal(loadConfig(env, file).dryRun, false);
    assert.equal(loadConfig({ ...env, DRY_RUN: 'false' }, file).dryRun, false);
    assert.equal(loadConfig({ ...env, DRY_RUN: 'true' }, file).dryRun, true);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
