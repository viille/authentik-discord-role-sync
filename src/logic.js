export function desiredRoleIds(user, mappings) {
  if (!user || !user.is_active) return new Set();
  const groups = new Set(user.groups.map((s) => String(s).toLowerCase()));
  const roles = new Set(user.roles.map((s) => String(s).toLowerCase()));
  return new Set(mappings
    .filter((m) => (m.authentik_type === 'group' ? groups : roles).has(m.authentik_id))
    .map((m) => m.discord_role_id));
}

export function calculateChanges(members, snapshot, mappings, removeUnlinked = true) {
  const managedIds = new Set(mappings.map((m) => m.discord_role_id));
  const changes = [];
  let checked = 0;
  for (const member of members.values()) {
    if (member.user.bot) continue;
    const userPk = snapshot.discordToUser.get(member.id);
    if (userPk === undefined && !removeUnlinked) continue;
    const user = userPk === undefined ? null : snapshot.usersById.get(userPk);
    const desired = desiredRoleIds(user, mappings);
    checked++;
    for (const roleId of managedIds) {
      const currentlyHas = member.roles.cache.has(roleId);
      const shouldHave = desired.has(roleId);
      if (currentlyHas !== shouldHave) {
        changes.push({ member, roleId, action: shouldHave ? 'add' : 'remove' });
      }
    }
  }
  return { checked, changes };
}

