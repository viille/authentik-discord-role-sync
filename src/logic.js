export function desiredRoleIds(user, mappings, groupRoles = new Map()) {
  if (!user || !user.is_active) return new Set();
  const groups = new Set(user.groups.map((s) => String(s).toLowerCase()));
  const roles = new Set(user.roles.map((s) => String(s).toLowerCase()));
  const effective = new Set(roles);
  for (const groupId of groups) for (const roleId of groupRoles.get(groupId) ?? []) effective.add(roleId);
  return new Set(mappings
    .filter((m) => {
      switch (m.authentik_type) {
        case 'group': return groups.has(m.authentik_id);
        case 'role': return roles.has(m.authentik_id);
        case 'effective_role': return effective.has(m.authentik_id);
        default: throw new Error(`Unknown mapping type ${m.authentik_type}`);
      }
    })
    .map((m) => m.discord_role_id));
}

export function calculateChanges(members, snapshot, mappings, removeUnlinked = true) {
  const managedIds = new Set(mappings.map((m) => m.discord_role_id));
  const changes = [];
  let checked = 0;
  let currentlyManaged = 0;
  for (const member of members.values()) {
    if (member.user.bot) continue;
    const userPk = snapshot.discordToUser.get(member.id);
    if (userPk !== undefined && !snapshot.usersById.has(userPk)) {
      throw new Error(`Incomplete authentik data for Discord user ${member.id}`);
    }
    if (userPk === undefined && !removeUnlinked) continue;
    const user = userPk === undefined ? null : snapshot.usersById.get(userPk);
    const desired = desiredRoleIds(user, mappings, snapshot.groupRoles);
    checked++;
    for (const roleId of managedIds) {
      const currentlyHas = member.roles.cache.has(roleId);
      if (currentlyHas) currentlyManaged++;
      const shouldHave = desired.has(roleId);
      if (currentlyHas !== shouldHave) {
        changes.push({ member, roleId, action: shouldHave ? 'add' : 'remove' });
      }
    }
  }
  return { checked, changes, currentlyManaged };
}
