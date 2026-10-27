const SNOWFLAKE = /^\d{16,22}$/;

export class AuthentikClient {
  constructor({ authentikUrl, authentikToken, sourceSlug }) {
    this.baseUrl = authentikUrl;
    this.token = authentikToken;
    this.sourceSlug = sourceSlug;
  }

  async get(path, query = {}) {
    const url = new URL(`/api/v3/${path.replace(/^\/+/, '')}`, this.baseUrl);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`authentik API ${response.status} on ${url.pathname}`);
    const json = await response.json();
    if (!json || typeof json !== 'object') throw new Error(`Invalid API response: ${url.pathname}`);
    return json;
  }

  async listAll(path, query = {}) {
    const rows = [];
    for (let page = 1; page <= 1000; page++) {
      const json = await this.get(path, { ...query, page_size: 100, page });
      if (!Array.isArray(json.results) || !json.pagination ||
          !Number.isInteger(json.pagination.total_pages)) {
        throw new Error(`Unexpected authentik pagination: ${path}`);
      }
      if (json.pagination.total_pages > 1000) throw new Error('Too many authentik pages');
      rows.push(...json.results);
      if (page >= json.pagination.total_pages) return rows;
    }
    throw new Error('authentik pagination limit exceeded');
  }

  async snapshot() {
    // The Discord OAuth source's unique identifier is the verified Discord account ID.
    const connections = await this.listAll('sources/user_connections/oauth/', {
      source__slug: this.sourceSlug,
    });
    const users = await this.listAll('core/users/', { include_groups: 'true' });

    const usersById = new Map();
    for (const user of users) {
      if (!Number.isInteger(user.pk) || typeof user.is_active !== 'boolean' ||
          !Array.isArray(user.groups) || !Array.isArray(user.roles)) {
        throw new Error('Unexpected authentik user data (pk/is_active/groups/roles)');
      }
      usersById.set(user.pk, user);
    }

    const discordToUser = new Map();
    const duplicates = new Set();
    let invalidIds = 0;
    for (const connection of connections) {
      // Defense-in-depth: never sync identities from other OAuth sources.
      if (connection.source_obj?.slug !== this.sourceSlug) {
        throw new Error('API returned a connection from an unexpected source');
      }
      const id = String(connection.identifier ?? '');
      if (!SNOWFLAKE.test(id) || !Number.isInteger(connection.user)) {
        invalidIds++;
        continue;
      }
      if (discordToUser.has(id) && discordToUser.get(id) !== connection.user) {
        duplicates.add(id);
        continue;
      }
      discordToUser.set(id, connection.user);
    }
    for (const id of duplicates) discordToUser.delete(id);

    if (duplicates.size > 0) {
      // Do not revoke roles of ambiguous accounts: abort the entire run.
      throw new Error(`${duplicates.size} Discord IDs are linked to multiple authentik accounts`);
    }
    if (invalidIds > 0) {
      // Do not interpret an API schema mismatch as a valid mass unlink.
      throw new Error(`${invalidIds} Discord source identifiers were invalid`);
    }
    return { usersById, discordToUser, linkedCount: discordToUser.size };
  }
}
