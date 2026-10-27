import { PermissionFlagsBits } from 'discord.js';
import { calculateChanges } from './logic.js';

export async function synchronize({
  guild, authentik, config, log, dryRun = config.dryRun, baseline = null,
  onChange = () => {},
}) {
  // Fetch and validate the complete source snapshot before making Discord changes.
  const snapshot = await authentik.snapshot({ mappings: config.mappings });
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
  const members = await guild.members.fetch();
  if (!members.size || members.size < guild.memberCount) {
    throw new Error(`Incomplete Discord member list: fetched ${members.size}/${guild.memberCount}`);
  }
  const { checked, changes, currentlyManaged } = calculateChanges(
    members, snapshot, config.mappings, config.removeUnlinked,
  );
  const plannedAdds = changes.filter((change) => change.action === 'add').length;
  const plannedRemoves = changes.length - plannedAdds;
  const maxRemovals = config.maxRemovals ?? 10;
  const maxDrop = config.maxLinkDropPercent ?? 25;
  const overMutationLimit = changes.length > config.maxMutations;
  const overRemovalLimit = plannedRemoves > maxRemovals;
  const linkedDropPercent = baseline?.linked >= 5 && snapshot.linkedCount < baseline.linked
    ? Math.round((1 - snapshot.linkedCount / baseline.linked) * 100)
    : 0;
  const overLinkDropLimit = linkedDropPercent > maxDrop;

  const result = {
    dryRun, linked: snapshot.linkedCount, members: members.size, checked,
    planned: changes.length, plannedAdds, plannedRemoves, currentlyManaged,
    linkedDropPercent, overMutationLimit, overRemovalLimit, overLinkDropLimit,
    // Preview a bounded set of changes in Discord's ephemeral response.
    preview: dryRun ? changes.slice(0, 15).map((c) => `${c.action} ${c.roleId} ${c.member.id}`) : [],
    added: 0, removed: 0, errors: 0,
  };
  if (!dryRun) {
    if (overMutationLimit) throw new Error(`Safety limit: ${changes.length} changes > MAX_MUTATIONS_PER_RUN=${config.maxMutations}`);
    if (overRemovalLimit) throw new Error(`Safety limit: ${plannedRemoves} removals > MAX_REMOVALS_PER_RUN=${maxRemovals}`);
    if (overLinkDropLimit) throw new Error(`Suspicious decrease in linked users: ${linkedDropPercent}% > MAX_LINK_DROP_PERCENT=${maxDrop}%`);
  }

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
      continue;
    }
    // If persistent audit recording fails, stop before touching any further roles.
    await onChange({ action: change.action, discordId: change.member.id, roleId: change.roleId });
  }
  return { ...result, snapshot };
}

export function formatSyncResult(result, includePreview = false) {
  const mode = result.dryRun ? 'DRY RUN: rooleja ei muutettu.' : 'LIVE: synkronointi suoritettu.';
  const counts = `Suunniteltu: ${result.planned} (lisäyksiä ${result.plannedAdds}, poistoja ${result.plannedRemoves}).`;
  const processed = `Tarkistettuja: ${result.checked}; yhdistettyjä tilejä: ${result.linked}.`;
  const actual = result.dryRun ? '' :
    `Tehty: lisäyksiä ${result.added}, poistoja ${result.removed}, virheitä ${result.errors}.`;
  const warnings = [
    result.overMutationLimit ? 'LIVE-ajo estettäisiin: liian monta muutosta.' : null,
    result.overRemovalLimit ? 'LIVE-ajo estettäisiin: liian monta poistoa.' : null,
    result.overLinkDropLimit ? `LIVE-ajo estettäisiin: linkitettyjen tilien määrä laski ${result.linkedDropPercent}%.` : null,
  ].filter(Boolean);
  const lines = [mode, counts, processed, actual, ...warnings].filter(Boolean);
  if (result.dryRun && includePreview && result.preview?.length) {
    lines.push('Ensimmäiset suunnitellut muutokset:');
    lines.push(...result.preview.map((line) => '`' + line + '`'));
    if (result.planned > result.preview.length) {
      lines.push(`Lisäksi ${result.planned - result.preview.length} muutosta. Tarkempi erittely lokissa.`);
    }
  }
  // Prevent hitting the Discord message size limit.
  return lines.join('\n').slice(0, 1900);
}
