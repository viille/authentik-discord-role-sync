/**
 * Help users manage their OWN Discord source connection through authentik.
 * No user connection is created/deleted by the bot, so its API token remains read-only.
 * https://docs.goauthentik.io/users-sources/user/account-types/internal-users/
 */
export function userSettingsUrl(authentikUrl) {
  const base = new URL(authentikUrl);
  if (base.protocol !== 'https:' && base.hostname !== 'localhost') {
    throw new Error('Authentik user settings must use HTTPS');
  }
  return new URL('/if/user/#/settings', base).toString();
}

/**
 * Return an ephemeral reply body (caller must set MessageFlags.Ephemeral).
 * Raw API component types: Action Row=1, Button=2, Link style=5.
 */
export function accountReply(action, config) {
  if (action !== 'link' && action !== 'unlink') {
    throw new Error('Unsupported account command');
  }
  const url = userSettingsUrl(config.authentikUrl);
  const source = `**${config.sourceSlug}**`;
  let content;
  if (action === 'link') {
    content = `**Yhdistä Discord Authentik-tiliisi**\n` +
      `1. Kirjaudu **olemassa olevalle** Authentik-tilillesi painikkeen kautta.\n` +
      `2. Avaa **Connected services / Yhdistetyt palvelut** ja valitse Discord-lähde (${source}).\n` +
      `3. Valitse **Connect / Yhdistä** ja hyväksy Discordin valtuutus.\n\n` +
      `Botti havaitsee yhdistämisen seuraavalla onnistuneella roolisynkronoinnilla. ` +
      `Tämä komento ei itsessään yhdistä tilejä.`;
  } else {
    const roleEffect = config.removeUnlinked
      ? config.dryRun
        ? `Roolien poistot näkyvät vain testilokissa, koska \`DRY_RUN=true\`. ` +
          `Kun testitila poistetaan käytöstä, botin hallinnoimat roolit poistuvat seuraavalla onnistuneella synkronoinnilla.`
        : `Botin hallinnoimat Discord-roolit poistuvat seuraavalla onnistuneella synkronoinnilla. ` +
          `Muita Discord-rooleja ei muuteta.`
      : `Botin hallinnoimia Discord-rooleja **ei automaattisesti poisteta**, ` +
        `koska \`REMOVE_UNLINKED=false\`.`;
    content = `**Katkaise Discordin ja Authentikin yhteys**\n` +
      `1. Avaa Authentikin käyttäjäasetukset painikkeesta.\n` +
      `2. Valitse **Connected services / Yhdistetyt palvelut**.\n` +
      `3. Etsi Discord-lähde (${source}) ja valitse **Disconnect / Katkaise yhteys**.\n\n` +
      `${roleEffect}\n\n` +
      `**Huomio:** Varmista ennen yhteyden katkaisua, että pääset yhä kirjautumaan ` +
      `Authentikiin muulla tavalla, jos Discord on käytössä kirjautumismenetelmänä. ` +
      `Tämä komento ei itse katkaise yhteyttä.`;
  }
  return {
    content,
    components: [{
      type: 1,
      components: [{ type: 2, style: 5, label: 'Avaa Authentik-asetukset', url }],
    }],
  };
}
