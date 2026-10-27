import fs from 'node:fs';

const discordId = /^\d{16,22}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseMappings(json) {
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error('config/roles.json must be a nonempty JSON array');
  }
  const seen = new Set();
  return json.map((item, index) => {
    if (!item || typeof item !== 'object' ||
        !['group', 'role'].includes(item.authentik_type) ||
        !uuid.test(item.authentik_id ?? '') ||
        !discordId.test(item.discord_role_id ?? '')) {
      throw new Error(`Invalid role mapping at index ${index}`);
    }
    const key = `${item.authentik_type}:${item.authentik_id}:${item.discord_role_id}`;
    if (seen.has(key)) throw new Error(`Duplicate mapping at index ${index}`);
    seen.add(key);
    return Object.freeze({
      authentik_type: item.authentik_type,
      authentik_id: item.authentik_id.toLowerCase(),
      discord_role_id: item.discord_role_id,
    });
  });
}

function intEnv(value, name, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return number;
}

function boolEnv(value, name, fallback) {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

export function loadConfig(env = process.env, mappingFile = './config/roles.json') {
  const required = [
    'DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID',
    'AUTHENTIK_BASE_URL', 'AUTHENTIK_API_TOKEN',
    'AUTHENTIK_DISCORD_SOURCE_SLUG',
  ];
  for (const name of required) {
    if (!env[name] || env[name] === 'replace-me') throw new Error(`Missing ${name}`);
  }
  if (!discordId.test(env.DISCORD_GUILD_ID)) throw new Error('Invalid DISCORD_GUILD_ID');
  const url = new URL(env.AUTHENTIK_BASE_URL);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new Error('Authentik URL must use HTTPS');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(env.AUTHENTIK_DISCORD_SOURCE_SLUG)) {
    throw new Error('Invalid AUTHENTIK_DISCORD_SOURCE_SLUG');
  }
  return Object.freeze({
    botToken: env.DISCORD_BOT_TOKEN,
    guildId: env.DISCORD_GUILD_ID,
    authentikUrl: url.origin,
    authentikToken: env.AUTHENTIK_API_TOKEN,
    sourceSlug: env.AUTHENTIK_DISCORD_SOURCE_SLUG,
    syncIntervalSeconds: intEnv(env.SYNC_INTERVAL_SECONDS, 'SYNC_INTERVAL_SECONDS', 300, 60, 86400),
    dryRun: boolEnv(env.DRY_RUN, 'DRY_RUN', false),
    removeUnlinked: boolEnv(env.REMOVE_UNLINKED, 'REMOVE_UNLINKED', true),
    maxMutations: intEnv(env.MAX_MUTATIONS_PER_RUN, 'MAX_MUTATIONS_PER_RUN', 50, 1, 100000),
    minLinkedUsers: intEnv(env.MIN_LINKED_USERS, 'MIN_LINKED_USERS', 1, 0, 100000),
    mappings: parseMappings(JSON.parse(fs.readFileSync(mappingFile, 'utf8'))),
  });
}
