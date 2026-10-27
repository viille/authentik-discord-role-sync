import { PermissionFlagsBits } from 'discord.js';

import { calculateChanges } from './logic.js';

export async function synchronize({ guild, authentik, config, log, dryRun = config.dryRun }) {
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
  if (!dryRun && changes.length > config.maxMutations) {
    throw new Error(`Safety limit: ${changes.length} changes > MAX_MUTATIONS_PER_RUN=${config.maxMutations}`);
  }
  const plannedAdds = changes.filter((change) => change.action === 'add').length;
  const plannedRemoves = changes.length - plannedAdds;
  const result = {
    dryRun,
    plannedAdds,
    plannedRemoves,
    overMutationLimit: changes.length > config.maxMutations,
    // Preview at most 15 operations so slash responses stay within Discord's 2000-character limit.
    preview: dryRun ? changes.slice(0, 15).map((c) => `${c.action} ${c.roleId} ${c.member.id}`) : [],
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
    if (dryRun) {
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

/**
 * Short, administrator-only status/preview for ephemeral slash-command replies.
 */
export function formatSyncResult(result, includePreview = false) {
  const mode = result.dryRun ? 'DRY RUN: rooleja ei muutettu.' : 'LIVE: synkronointi suoritettu.';
  const counts = `Suunniteltu: ${result.planned} (lisäyksiä ${result.plannedAdds}, poistoja ${result.plannedRemoves}).`;
  const processed = `Käyttäjiä: ${result.checked}; yhdistettyjä tilejä: ${result.linked}.`;
  const actual = result.dryRun ? '' :
    `Tehty: lisäyksiä ${result.added}, poistoja ${result.removed}, virheitä ${result.errors}.`;
  const safety = result.overMutationLimit
    ? `Huomio: ${result.planned} muutosta ylittää MAX_MUTATIONS_PER_RUN-rajan; LIVE-ajo estettäisiin.`
    : '';
  const lines = [mode, counts, processed, actual, safety].filter(Boolean);
  if (result.dryRun && includePreview && result.preview?.length) {
    lines.push('Ensimmäiset suunnitellut muutokset:');
    lines.push(...result.preview.map((line) => '`' + line + '`'));
    if (result.planned > result.preview.length) {
      lines.push(`Lisäksi ${result.planned - result.preview.length} muutosta. Tarkempi erittely lokissa.`);
    }
  }
  return lines.join('\n');
}
