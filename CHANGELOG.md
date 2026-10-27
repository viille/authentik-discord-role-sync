# Changelog

Merkittävät muutokset kirjataan tähän tiedostoon. Versiointi noudattaa Semantic Versioning -periaatetta. Päivämäärät ovat julkaisupäivämääriä silloin, kun ne ovat tiedossa.

## [1.2.0] - 2026-10-27

### Added
- `/rolesync activate`: LIVE-synkronoinnin ensimmäinen käyttöönotto vaatii enintään 30 minuuttia vanhan onnistuneen `/rolesync dryrun`-esikatselun.
- `/rolesync history`: pysyvän auditointihistorian viimeisimmät tapahtumat.
- Valinnainen Authentik OAuth -yhteyden suora irrottaminen `/unlink`-vahvistuspainikkeella. Edellyttää erillistä `AUTHENTIK_UNLINK_API_TOKEN`-tokenia; ilman sitä käyttäjä ohjataan edelleen Authentik-asetuksiin.
- `effective_role`-kartoitustyyppi, joka huomioi suorat ja ryhmiltä perityt RBAC-roolit.
- Pysyvä synkronoinnin tila, auditointiloki ja onnistuneen LIVE-ajon lähtötaso Docker-taltiolla.
- Rajoitukset `MAX_REMOVALS_PER_RUN` ja `MAX_LINK_DROP_PERCENT` automaattisten massapoistojen estämiseksi.
- Testit puutteellisille lähdetiedoille, rooliperiytymiselle, aktivoinnille, poistorajoille ja tilatiedoston säilymiselle.

### Changed
- Uudet asennukset ja synkronointiin vaikuttavat konfiguraatiomuutokset vaativat aktivoinnin, vaikka `DRY_RUN=false` on edelleen oletusarvo.
- `/rolesync dryrun` näyttää myös LIVE-ajon estävät turvarajojen ylitykset.
- Docker ja CI käyttävät lukittuja npm-riippuvuuksia (`package-lock.json`, `npm ci`).
- Käyttäjäryhmien ja roolien lähdetietojen validointia sekä toimintojen virheraportointia tiukennettiin.

### Fixed
- OAuth-yhteyden viittaus Authentik-käyttäjään, jota käyttäjälista ei sisällä, pysäyttää synkronoinnin eikä johda roolien poistamiseen.
- Duplikaattiset tai virheelliset Discord OAuth -yhteydet pysäyttävät synkronoinnin.
- Muuttuneet roolikartoitukset ja synkronoinnin turvarajat mitätöivät aiemman LIVE-aktivoinnin.

### Deployment notes
- Käyttöönoton järjestys: `/rolesync dryrun`, `/rolesync activate`, `/rolesync now`.
- `docker compose up -d --build` ottaa uuden Docker-taltion käyttöön; älä poista sitä komennolla `docker compose down -v`.
- `effective_role` edellyttää Authentikin ryhmätietojen lukuoikeuksia. Tarkista yhteensopivuus omalla Authentik-versiollasi ennen LIVE-käyttöä.
- Todellista Authentik–Discord-integraatiotestiä ei ole vielä vahvistettu.

## [1.1.0]

### Added
- `/link`- ja `/unlink`-komennot, jotka ohjaavat käyttäjän Authentikin **Connected services** -asetuksiin.
- `/rolesync now` ja `/rolesync status` ylläpitokäyttöön.
- Yksisuuntainen Authentik-ryhmien ja suoraan liitettyjen RBAC-roolien synkronointi valittuihin Discord-rooleihin.
- Docker Compose -asennus, ympäristömuuttujaesimerkki ja GitHub Actions -testaus.

### Changed
- `DRY_RUN=false` määritettiin oletusarvoksi ja lisättiin ylläpitäjille kertaluonteinen `/rolesync dryrun` -esikatselu. Tämä muutos toteutettiin v1.1.0-koodipohjaan ennen v1.2.0-kovennuksia.

### Notes
- `/unlink` oli tässä versiossa vain ohjaus Authentikin asetuksiin.
- Ensimmäinen LIVE-käynnistys ei vaatinut erillistä aktivointia ennen v1.2.0-versiota.
