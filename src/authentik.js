const SNOWFLAKE = /^\d{16,22}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AuthentikClient {
  constructor({ authentikUrl, authentikToken, sourceSlug, unlinkApiToken }) {
    this.baseUrl = authentikUrl;
    this.token = authentikToken;
    this.sourceSlug = sourceSlug;
    this.unlinkApiToken = unlinkApiToken;
  }

  async get(path, query = {}, token = this.token) {
    const url = new URL(`/api/v3/${path.replace(/^\/+/, '')}`, this.baseUrl);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
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

  async connections() {
    return this.listAll('sources/user_connections/oauth/', { source__slug: this.sourceSlug });
  }

  async snapshot({ mappings = [] } = {}) {
    const connections = await this.connections();
    const users = await this.listAll('core/users/', {
      include_groups: 'true', include_roles: 'true',
    });
    const needRoles = mappings.some((m) => m.authentik_type !== 'group');
    const needsEffectiveRoles = mappings.some((m) => m.authentik_type === 'effective_role');
    const usersById = new Map();
    for (const user of users) {
      if (!Number.isInteger(user.pk) || typeof user.is_active !== 'boolean' ||
          !Array.isArray(user.groups) || (needRoles && !Array.isArray(user.roles))) {
        throw new Error('Unexpected authentik user schema (pk/is_active/groups/roles)');
      }
      if (usersById.has(user.pk)) throw new Error('Duplicate authentik user ID returned');
      const groups = user.groups.map((id) => String(id).toLowerCase());
      const roles = Array.isArray(user.roles) ? user.roles.map((id) => String(id).toLowerCase()) : [];
      if (groups.some((id) => !UUID.test(id)) || roles.some((id) => !UUID.test(id))) {
        throw new Error('Unexpected authentik group/role identifier');
      }
      usersById.set(user.pk, { ...user, groups, roles });
    }

    const discordToUser = new Map();
    const connectionsByDiscordId = new Map();
    let invalid = 0;
    for (const connection of connections) {
      if (connection.source_obj?.slug !== this.sourceSlug) {
        throw new Error('Unexpected OAuth source returned by authentik');
      }
      const id = String(connection.identifier ?? '');
      if (!SNOWFLAKE.test(id) || !Number.isInteger(connection.user) ||
          !Number.isInteger(connection.pk)) {
        invalid++;
        continue;
      }
      if (discordToUser.has(id)) {
        // Even same-user duplicates are ambiguous for deletion.
        throw new Error(`Multiple authentik source connections for Discord user ${id}`);
      }
      discordToUser.set(id, connection.user);
      connectionsByDiscordId.set(id, connection.pk);
    }
    if (invalid) throw new Error(`${invalid} OAuth source connections have invalid identifiers`);

    // Fail closed: a token with only partial user access must never trigger bulk revocation.
    for (const [discordId, userPk] of discordToUser) {
      if (!usersById.has(userPk)) {
        throw new Error(`Incomplete authentik user list: Discord ${discordId} references unseen user ${userPk}`);
      }
    }

    const groupRoles = new Map();
    if (needsEffectiveRoles) {
      const groupIds = new Set();
      for (const user of usersById.values()) for (const id of user.groups) groupIds.add(id);
      for (const groupId of groupIds) {
        // This includes parent-group roles (not merely roles directly assigned to a group).
        const group = await this.get(`core/groups/${groupId}/`, {
          include_inherited_roles: 'true', include_users: 'false',
        });
        if (!Array.isArray(group.roles) || !Array.isArray(group.inherited_roles_obj)) {
          throw new Error(`Missing inherited role information for group ${groupId}`);
        }
        const roleIds = new Set([...group.roles, ...group.inherited_roles_obj.map((r) => r.pk)]
          .map((id) => String(id).toLowerCase()));
        if ([...roleIds].some((id) => !UUID.test(id))) {
          throw new Error(`Invalid group role for ${groupId}`);
        }
        groupRoles.set(groupId, roleIds);
      }
    }

    return {
      usersById, discordToUser, connectionsByDiscordId,
      linkedCount: discordToUser.size, groupRoles,
    };
  }

  /**
   * Delete ONLY the calling Discord user's corresponding Authentik source connection.
   * Requires separate narrow-scoped write token, and an explicit user confirmation.
   */
  async unlinkSelf(discordId) {
    if (!this.unlinkApiToken) throw new Error('Direct unlink is not configured');
    if (!SNOWFLAKE.test(discordId)) throw new Error('Invalid Discord identifier');
    const matching = (await this.connections()).filter((c) =>
      c.source_obj?.slug === this.sourceSlug && String(c.identifier) === discordId);
    if (matching.length === 0) return false;
    if (matching.length !== 1 || !Number.isInteger(matching[0].pk)) {
      throw new Error('Ambiguous authentik account connection; no deletion performed');
    }
    const url = new URL(`/api/v3/sources/user_connections/oauth/${matching[0].pk}/`, this.baseUrl);
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.unlinkApiToken}` },
      signal: AbortSignal.timeout(20000),
    });
    if (response.status !== 204) {
      throw new Error(`authentik OAuth unlink failed (HTTP ${response.status})`);
    }
    return true;
  }
}
