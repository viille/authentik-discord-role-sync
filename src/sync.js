import { PermissionFlagsBits } from 'discord.js';

import { calculateChanges } from './logic.js';

export async function synchronize({ guild, authentik, config, log }) {
  // All authentik API requests complete BEFORE any Discord change.
  const snapshot = await authentik.snapshot();
  if (snapshot.linkedCount < config.minLinkedUsers) {
    throw new Error(`Only ${snapshot.linkedCount} linked users (minimum ${config.minLinkedUsers}); no changes`);
  }
  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('Bot does not have Manage Roles permission');
  }
  const roles = await guild.roles.fetch();
  for (const roleId of new Set(config.mappings.map((m) => m.discord_role_id))) {
    const role = roles.get(roleId);
    if (!role) throw new Error(`Configured Discord role not found: ${roleId}`);
    if (role.managed) throw new Error(`Managed/integration role cannot be changed: ${roleId}`);
    if (role.position >= me.roles.highest.position) {
      throw new Error(`Bot role must be above target role ${role.name} (${roleId})`);
    }
  }
  // Intent GuildMembers is required for a complete guild-wide role reconciliation.
  const members = await guild.members.fetch();
  if (members.size === 0 || members.size < guild.memberCount) {
    throw new Error(`Incomplete Discord member list: fetched ${members.size}/${guild.memberCount}`);
  }
  const { checked, changes } = calculateChanges(members, snapshot, config.mappings, config.removeUnlinked);
  if (changes.length > config.maxMutations) {
    throw new Error(`Safety limit: ${changes.length} changes > MAX_MUTATIONS_PER_RUN=${config.maxMutations}`);
  }
  const result = {
    dryRun: config.dryRun,
    linked: snapshot.linkedCount,
    members: members.size,
    checked,
    planned: changes.length,
    added: 0,
    removed: 0,
    errors: 0,
  };
  for (const change of changes) {
    const description = `${change.action} ${change.roleId} ${change.member.id}`;
    if (config.dryRun) {
      log('info', `DRY RUN ${description}`);
      continue;
    }
    try {
      if (change.action === 'add') {
        await change.member.roles.add(change.roleId, 'authentik group/RBAC role sync');
        result.added++;
      } else {
        await change.member.roles.remove(change.roleId, 'authentik group/RBAC role sync');
        result.removed++;
      }
      log('info', description);
    } catch (error) {
      result.errors++;
      log('error', `Failed ${description}: ${error.message}`);
    }
  }
  return result;
}
