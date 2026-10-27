# Authentik Discord Role Sync

Katso myös [CHANGELOG.md](CHANGELOG.md) aiempien versioiden ja päivitysten muutoksista.

Node.js Discord-botti synkronoi määritetyt Authentik-ryhmät, suorat RBAC-roolit ja perityt RBAC-roolit Discordiin. Authentik on käyttöoikeuksien lähde. Version 1.2.0 tietoturvakovennukset estävät tahattoman massapoiston.

## Toiminnot

- Authentik OAuth Source -yhteyden `identifier`-kenttä tunnistaa Discord-käyttäjän ID:n.
- `config/roles.json` määrää botin hallinnoimat roolit. Muut Discord-roolit säilyvät.
- `group` kohdistaa käyttäjän suoraan Authentik-ryhmään. `role` kohdistaa käyttäjälle suoraan annettuun RBAC-rooliin. `effective_role` sisältää myös ryhmältä ja sen vanhemmilta perityt RBAC-roolit.
- `/link` antaa Authentikin Connected services -linkin.
- `/unlink` antaa Authentik-asetukset ja **valinnaisesti** käyttäjän vahvistaman suoran OAuth-yhteyden katkaisun.
- `/rolesync dryrun` esikatselee roolimuutokset. `/rolesync activate` aktivoi LIVE-ajot käyttöönotossa ja roolikonfiguraation muuttuessa.
- `/rolesync now` suorittaa synkronoinnin heti; `/rolesync status` näyttää tilanteen; `/rolesync history` näyttää pysyvän auditointilokin viimeisimmät tapahtumat.

## Turvallinen käyttöönotto

**`DRY_RUN=false` on oletus**, mutta uusi asennus aloittaa lukitussa tilassa. Aja Discordissa ylläpitäjänä:

1. `/rolesync dryrun` (tarkista esikatselu).
2. `/rolesync activate` **30 minuutin kuluessa** onnistuneesta esikatselusta.
3. `/rolesync now` (ensimmäinen varsinainen LIVE-ajo).

Aktivointi tallentuu tiedostoon `/data/state.json` Docker-nimetyssä taltiolla ja säilyy uudelleenkäynnistyksen yli. **Jos synkronoitavat roolit, palvelin, Authentik-palvelin, source tai REMOVE_UNLINKED muuttuvat, aktivointi raukeaa**, ja ylläpitäjän on katselmoitava muutokset uudelleen.

Vain `Manage Server` -oikeudella voi käyttää hallintakomentoja. Botille riittää `Manage Roles`, ja sen rooli tulee sijoittaa synkronoitavien roolien yläpuolelle. Ota käyttöön myös **Server Members Intent** ja kutsu botti scopeilla `bot`, `applications.commands`.

## Konfigurointi

1. Luo Authentikiin Discord OAuth Source. Lisää Discord Developer Portalin Client ID, secret ja callback `https://AUTHENTIK-DOMAIN/source/oauth/callback/discord/` (kun source slug on `discord`).
2. Käyttäjät yhdistävät omat Authentik- ja Discord-tilinsä Authentikin **Connected services** -asetuksissa. Älä luo uusia Authentik-tilejä tämän linkityksen yhteydessä.
3. Luo Authentik-palvelutili, jolla on lukuoikeus `core/users/`- ja `sources/user_connections/oauth/` -rajapintoihin. Jos käytössä on `effective_role`, tarvitaan lisäksi `core/groups/{uuid}/` -lukuoikeus.
4. Kopioi `.env.example` tiedostoksi `.env` ja täytä Discord- sekä Authentik-arvot. Älä tallenna tokeneita versionhallintaan.
5. Muokkaa `config/roles.json` sisältämään omat Authentik-UUID:t ja Discord-roolien ID:t.

Roolimääritys:

```json
[
  {
    "authentik_type": "group",
    "authentik_id": "11111111-1111-4111-8111-111111111111",
    "discord_role_id": "111111111111111111"
  },
  {
    "authentik_type": "effective_role",
    "authentik_id": "33333333-3333-4333-8333-333333333333",
    "discord_role_id": "333333333333333333"
  }
]
```

Roolien periytymisessä käytetään Authentikin `include_inherited_roles=true` -rajapintaa. RBAC:n `role`- ja `effective_role`-kartoitukset edellyttävät Authentik 2025.12 -versiota tai uudempaa.

| Asetus | Oletus | Kuvaus |
| --- | --- | --- |
| `DRY_RUN` | `false` | `true` pakottaa kaikki roolisynkronoinnit read-only-tilaan |
| `REMOVE_UNLINKED` | `true` | Poista botin hallinnoimat roolit, jos Discord-käyttäjällä ei ole OAuth-yhteyttä |
| `SYNC_INTERVAL_SECONDS` | `300` | Automaattisen synkronoinnin väli |
| `MAX_MUTATIONS_PER_RUN` | `50` | LIVE-ajon korkeintaan sallittu muutosmäärä |
| `MAX_REMOVALS_PER_RUN` | `10` | LIVE-ajon korkeintaan sallittu roolien poistomäärä |
| `MAX_LINK_DROP_PERCENT` | `25` | Ajo keskeytyy, jos aiempaan onnistuneeseen ajoon verrattuna linkitysten pudotus ylittää rajan (lähtötaso vähintään 5) |
| `MIN_LINKED_USERS` | `1` | Vähimmäismäärä Authentik–Discord-yhteyksiä |
| `STATE_FILE` | `./data/state.json` | Pysyvän tilan ja auditointihistorian tiedosto (Docker: `/data/state.json`) |
| `AUTHENTIK_UNLINK_API_TOKEN` | Ei asetettu | Erillinen **vain OAuth source connection -poiston salliva** token suoraan `/unlink`-toimintoon |

`MAX_REMOVALS_PER_RUN` ja `MAX_MUTATIONS_PER_RUN` estävät aidot muutokset myös aktivoinnin jälkeen. Esikatselu kertoo eston syyn ilman muutoksia. Odottamattoman poistopiikin tapauksessa selvitä aiheuttaja ensin ja korota rajaa vain tietoisesti.

### /unlink: valinnainen suora katkaisu

Jos `AUTHENTIK_UNLINK_API_TOKEN` on asetettu, komento näyttää käyttäjälle vahvistuspainikkeen. Botti poistaa **ainoastaan kyseisen Discord-käyttäjä-ID:n** Authentik OAuth Source -yhteyden erillistä poistotokenia käyttäen. Käyttäjä ei voi katkaista muiden yhteyksiä komennolla.

Jos tokenia ei ole, `/unlink` ohjaa Authentikin Connected services -asetuksiin. Näin botti voidaan ajaa kokonaan vain lukuoikeuksilla Authentikiin.

**Ennen katkaisua on varmistettava toinen kirjautumistapa Authentikiin.** Discord-roolit päivittyvät seuraavalla onnistuneella LIVE-ajolla, kun `REMOVE_UNLINKED=true`.

## Käynnistys ja päivitys

```bash
cp .env.example .env
# Täytä .env ja config/roles.json
docker compose up -d --build
docker compose logs -f role-sync
```

Päivitä tuotanto:

```bash
git pull
docker compose up -d --build
```

Docker Compose sisältää nimetyn taltion `role_sync_state`. **Älä poista taltiota `docker compose down -v` -komennolla**, tai aktivointi ja auditointihistoria katoavat. Uudelleenkäynnistyksen jälkeen botin tila säilyy, ellei konfiguraatio muutu.

## Testit ja turvallisuus

```bash
npm ci
npm test
npm run check
```

- Tuntemattomaan Authentik-käyttäjään viittaava source connection pysäyttää koko synkronoinnin. Myös Authentik-API-virheet, virheelliset yhteydet ja puutteellinen Discord-jäsenluettelo pysäyttävät ajon.
- Ryhmistä perittyjen roolien tiedon puuttuminen pysäyttää niiden synkronoinnin.
- Pysyvä auditointihistoria (viimeiset 1500 tapahtumaa), viimeiset 100 ajoa ja viimeisin onnistunut LIVE-käyttäjämäärä säilytetään paikallisessa tilatiedostossa.
- Poistot eivät ole atomisia Discordin API:n kanssa. Jos palvelin kaatuu kesken roolimuutosten, seuraava onnistunut ajo täsmäyttää tilanteen. Virheellisiä tai keskeytyneitä ajoja ei kirjata onnistuneiksi.
- Yksi Discord-palvelin ja yksi aktiivinen synkronointiprosessi kerrallaan. Täysi todentaminen edellyttää integraatiotestiä oikeaa Authentikia ja Discordia vasten.

Authendik API: https://api.goauthentik.io/reference/sources-user-connections-oauth-list/ ja https://api.goauthentik.io/reference/core-groups-retrieve/
