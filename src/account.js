/**
 * Users manage their existing Authentik account via Connected services.
 * If a dedicated deletion token is configured, /unlink also offers a
 * confirmed, self-service deletion of their own Discord OAuth connection.
 */
export function userSettingsUrl(authentikUrl) {
  const base = new URL(authentikUrl);
  if (base.protocol !== 'https:' && base.hostname !== 'localhost') {
    throw new Error('Authentik user settings must use HTTPS');
  }
  return new URL('/if/user/#/settings', base).toString();
}

export function accountReply(action, config, discordId = null) {
  if (action !== 'link' && action !== 'unlink') throw new Error('Unsupported account command');
  const url = userSettingsUrl(config.authentikUrl);
  const source = `**${config.sourceSlug}**`;
  const linkButton = { type: 2, style: 5, label: 'Avaa Authentik-asetukset', url };
  if (action === 'link') {
    return {
      content: `**Yhdistä Discord Authentik-tiliisi**\n` +
        `1. Kirjaudu olemassa olevalle Authentik-tilillesi.\n` +
        `2. Avaa **Connected services / Yhdistetyt palvelut** ja valitse ${source}.\n` +
        `3. Yhdistä Discord ja hyväksy valtuutus.\n\n` +
        'Roolit synkronoidaan seuraavalla onnistuneella LIVE-ajolla.',
      components: [{ type: 1, components: [linkButton] }],
    };
  }
  const content = `**Katkaise Discordin ja Authentikin yhteys**\n` +
    `Discord-lähde: ${source}.\n` +
    'Varmista ensin, että voit kirjautua Authentikiin muutenkin kuin Discordilla.\n' +
    (config.unlinkApiToken
      ? 'Vahvista alla, niin botti poistaa **vain sinun Discord-tilisi** OAuth-yhteyden Authentikista.\n'
      : 'Avaa Authentikin Connected services ja valitse **Disconnect / Katkaise yhteys**.\n') +
    (config.removeUnlinked
      ? 'Botin hallinnoimat roolit poistuvat seuraavalla onnistuneella LIVE-synkronoinnilla.'
      : 'Botin hallinnoimia rooleja ei automaattisesti poisteta (REMOVE_UNLINKED=false).');
  const components = config.unlinkApiToken && discordId
    ? [linkButton, {
      type: 2, style: 4, label: 'Vahvista yhteyden katkaisu',
      custom_id: `unlink:confirm:${discordId}`,
    }]
    : [linkButton];
  return { content, components: [{ type: 1, components }] };
}
