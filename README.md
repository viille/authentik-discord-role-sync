# Authentik → Discord Role Sync

Authentik-ryhmien ja suoraan liitettyjen RBAC-roolien yksisuuntainen synkronointi valittuihin Discord-rooleihin. Node.js 22+ ja Docker Compose.

## Toiminta

- Authentik on roolitietojen lähde. Discord-tunniste tunnistetaan Authentikin Discord OAuth Source -yhteyden `identifier`-kentästä, ei käyttäjänimestä.
- Synkronoi vain `config/roles.json`-tiedostoon määritetyt Discord-roolit. Kaikki muut roolit säilyvät.
- Tukee yhtä Authentik-ryhmää tai suoraa RBAC-roolia sekä useita vastaavuuksia samaan Discord-rooliin (OR).
- Synkronointi ajastetusti (oletus 300 s) ja ylläpitäjän pyynnöstä komennolla `/rolesync now`.
- `/link` ja `/unlink` näyttävät yksityisen viestin ja painikkeen Authentikin käyttäjäasetuksiin. **Komennot eivät itse yhdistä tai irrota OAuth-yhteyttä.**
- Aloittaa turvallisesti: `DRY_RUN=true` ja `MAX_MUTATIONS_PER_RUN=50`.

## Asennus

### 1. Discord

1. Luo Discord-sovellus osoitteessa https://discord.com/developers/applications ja ota talteen Bot Token.
2. Ota botille käyttöön **Server Members Intent** ja kutsu se halutulle palvelimelle scopeilla `bot` ja `applications.commands`.
3. Anna oikeus **Manage Roles**, ei Administrator-oikeuksia.
4. Sijoita botin rooli Discordin roolihierarkiassa kaikkien synkronoitavien roolien yläpuolelle.
5. Kopioi Discord-palvelimen ID ja hallinnoitavien roolien ID:t (Developer Mode).

### 2. Authentik

1. Luo Authentikiin **Discord OAuth Source**: https://docs.goauthentik.io/users-sources/sources/social-logins/discord/
2. Määritä Discord Developer Portalissa OAuth2 Redirect URI `https://AUTHENTIK-DOMAIN/source/oauth/callback/discord/`, kun Authentik-source slug on `discord`. Lisää Discord OAuth client ID ja secret Authentikiin.
3. Käyttäjät yhdistävät Discordin olemassa olevaan Authentik-tiliinsä valitsemalla **Connected services / Yhdistetyt palvelut**. Jos Discord on kirjautumistapa, varmista ettei käyttäjä luo vahingossa toista Authentik-tiliä.
4. Luo Authentik-palvelutili ja sille **vain lukuoikeudet** `/api/v3/core/users/`- ja `/api/v3/sources/user_connections/oauth/`-rajapintoihin. Botti ei tarvitse kirjoitusoikeuksia Authentikiin.
5. Kopioi Authentik-ryhmien ja/tai suoraan annettujen RBAC-roolien UUID-tunnisteet.

> `authentik_type: "role"` vastaa käyttäjän suoraan liitettyjä `roles`-arvoja. Se ei automaattisesti tarkoita ryhmältä perittyjä RBAC-oikeuksia. Käytä `group`-määritystä, jos käyttöoikeudet määräytyvät ryhmistä.

### 3. Asetukset

```bash
cp .env.example .env
```

Täytä `.env`-tiedostossa `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `AUTHENTIK_BASE_URL`, `AUTHENTIK_API_TOKEN` ja `AUTHENTIK_DISCORD_SOURCE_SLUG`.

Muokkaa `config/roles.json`-tiedostoon oikeat Authentik UUID:t ja Discord-role ID:t. Esimerkki:

```json
[
  {
    "authentik_type": "group",
    "authentik_id": "11111111-1111-4111-8111-111111111111",
    "discord_role_id": "111111111111111111"
  },
  {
    "authentik_type": "role",
    "authentik_id": "33333333-3333-4333-8333-333333333333",
    "discord_role_id": "333333333333333333"
  }
]
```

Sallitut asetukset:

| Muuttuja | Oletus | Tarkoitus |
| --- | --- | --- |
| `DRY_RUN` | `true` | Suunnitellut muutokset lokiin, ei Discord-muutoksia |
| `REMOVE_UNLINKED` | `true` | Poistaa botin hallinnoimat roolit jäseniltä, joilla ei ole Authentik-Discord-liitosta |
| `MIN_LINKED_USERS` | `1` | Estää muutokset, jos lähdetilejä löytyy liian vähän |
| `MAX_MUTATIONS_PER_RUN` | `50` | Estää ajon, jos muutoksia olisi yli rajan |
| `SYNC_INTERVAL_SECONDS` | `300` | Synkronointien väli sekunteina (vähintään 60) |

**Huomio:** `REMOVE_UNLINKED=true` käsittelee kaikki konfiguroidut Discord-roolit täysin botin hallinnoimina. Jos niitä on aiemmin jaettu käsin, ne voidaan poistaa yhdistämättömiltä jäseniltä. Tarkista suunnitellut poistot dry-run-lokeista ennen `DRY_RUN=false`-asetusta. Jos `REMOVE_UNLINKED=false`, `/unlink` ei johda automaattiseen Discord-roolien poistoon.

### 4. Käynnistys

```bash
docker compose up -d --build
docker compose logs -f role-sync
```

Paikallisesti:

```bash
npm install
npm test
npm run check
npm start
```

Kun dry-run on tarkastettu, vaihda `.env`-tiedostossa `DRY_RUN=false` ja suorita:

```bash
docker compose up -d --force-recreate
```

## Discord-komennot

| Komento | Oikeus | Toiminto |
| --- | --- | --- |
| `/link` | Kaikki jäsenet | Yksityinen linkki Authentikin **Connected services** -näkymään Discordin yhdistämiseksi |
| `/unlink` | Kaikki jäsenet | Yksityinen linkki Authentikin **Connected services** -näkymään Discordin irrottamiseksi |
| `/rolesync status` | Manage Server | Viimeinen synkronointitulos |
| `/rolesync now` | Manage Server | Käynnistää synkronoinnin heti |

Authentikin käyttäjäasetusten osoite on `/if/user/#/settings`. Kun käyttäjä irrottaa Discordin siellä, synkronoijan hallitsemat roolit poistuvat seuraavalla onnistuneella ajolla, **jos** `REMOVE_UNLINKED=true` ja `DRY_RUN=false`. Varmista vaihtoehtoinen kirjautumistapa ennen yhteyden poistamista, jos Discord on ainoa Authentik-kirjautumismenetelmä.

## Turvallisuus ja rajoitukset

- Authentik-API:n virhe tai epäselvä Discord-tunniste keskeyttää synkronoinnin sen sijaan, että kyseinen tilanne tulkittaisiin massairrottamiseksi.
- Botti tarkistaa oikeudet, roolihierarkian, jäsenluettelon ja muutoskaton ennen muutoksia.
- Yksittäiset Discord-API-virheet kirjataan lokiin ja yritetään myöhemmällä ajolla uudelleen.
- Synkronointi on polling-pohjainen, ei reaaliaikainen webhook. Tuettu on yksi Discord-palvelin.
- Botti ei muuta nimimerkkejä, kanavia, käyttäjätietoja eikä synkronoi Discord-rooleja takaisin Authentikiin.
- **Älä koskaan commitoi `.env`-tiedostoa tai API-tokenia.** Esimerkkitiedosto on `.env.example`.

### Kehitys

GitHub Actions suorittaa `npm test` ja `npm run check` aina pushin ja pull requestin yhteydessä. Testit eivät korvaa oikeaan Authentik- ja Discord-ympäristöön tehtävää integraatiotestausta.

Authentik API: https://api.goauthentik.io/reference/core-users-list/ ja https://api.goauthentik.io/reference/sources-user-connections-oauth-list/
