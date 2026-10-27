import 'dotenv/config';
import {
  Client, GatewayIntentBits, Events, PermissionFlagsBits, MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { loadConfig } from './config.js';
import { AuthentikClient } from './authentik.js';
import { synchronize, formatSyncResult } from './sync.js';
import { accountReply } from './account.js';
import { StateStore, configurationKey } from './state.js';

const config = loadConfig();
const store = new StateStore(config.stateFile, configurationKey(config));
const authentik = new AuthentikClient(config);
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

function log(level, message, data) {
  console[level](`[${new Date().toISOString()}] ${message}`, ...(data ? [data] : []));
}

const commands = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Yhdistä Discord-tili Authentik-käyttäjään'),
  new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('Katkaise Discord-tilin yhteys Authentikiin'),
  new SlashCommandBuilder()
    .setName('rolesync')
    .setDescription('Authentik–Discord-roolisynkronoinnin hallinta')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('status').setDescription('Näytä synkronoinnin tila'))
    .addSubcommand((s) => s.setName('now').setDescription('Synkronoi roolit heti, jos aktivoitu'))
    .addSubcommand((s) => s.setName('dryrun').setDescription('Esikatsele ilman roolimuutoksia'))
    .addSubcommand((s) => s.setName('activate').setDescription('Aktivoi LIVE-ajot onnistuneen esikatselun jälkeen'))
    .addSubcommand((s) => s.setName('history').setDescription('Näytä viimeisimmät roolimuutokset')),
];

let running = false;
let lastResult = null;
let lastTime = null;
let lastError = null;
let guild;

async function runSync({ dryRun = false, preview = false, actor = 'system' } = {}) {
  if (running) return { busy: true };
  running = true;
  try {
    const effectiveDryRun = dryRun || !store.state.activated || config.dryRun;
    const result = await synchronize({
      guild, authentik, config, log, dryRun: effectiveDryRun,
      baseline: store.state.baseline,
      onChange: (event) => store.appendAudit({ ...event, actor }),
    });
    const { snapshot, ...summary } = result;
    // A preview only counts toward activation after a successful explicit slash command.
    store.recordRun(summary, actor);
    if (preview) store.recordPreview();
    if (!effectiveDryRun && summary.errors === 0) {
      store.setBaseline(snapshot, summary.members);
    }
    lastResult = summary;
    lastError = null;
    lastTime = new Date().toISOString();
    log('info', 'Synchronization complete', summary);
    return { result: summary };
  } catch (error) {
    lastError = error.message;
    lastTime = new Date().toISOString();
    log('error', `Synchronization failed: ${error.message}`);
    return { error: error.message };
  } finally {
    running = false;
  }
}

client.once(Events.ClientReady, async () => {
  log('info', `Bot connected as ${client.user.tag}`);
  try {
    guild = await client.guilds.fetch(config.guildId);
    await client.application.commands.set(commands.map((c) => c.toJSON()), config.guildId);
    log('info', `Commands registered to guild ${config.guildId}`);
  } catch (error) {
    log('error', `Initialization failed: ${error.message}`);
    process.exitCode = 1;
    await client.destroy();
    return;
  }
  if (!store.state.activated) log('warn', 'LIVE changes blocked: run /rolesync dryrun, then /rolesync activate');
  await runSync();
  setInterval(() => { void runSync(); }, config.syncIntervalSeconds * 1000).unref();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.guildId !== config.guildId) return;
  try {
    if (interaction.isButton() && interaction.customId.startsWith('unlink:confirm:')) {
      const ownerId = interaction.customId.slice('unlink:confirm:'.length);
      if (!config.unlinkApiToken || ownerId !== interaction.user.id) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Tätä toimintoa ei voi suorittaa.' });
        return;
      }
      await interaction.deferUpdate();
      const deleted = await authentik.unlinkSelf(interaction.user.id);
      store.appendAudit({ action: 'unlink', actor: interaction.user.id, deleted });
      await interaction.editReply({
        content: deleted
          ? 'Discord-yhteys katkaistu Authentikista. Roolit päivittyvät seuraavassa onnistuneessa LIVE-ajossa.'
          : 'Discord-yhteyttä ei enää löytynyt Authentikista.',
        components: [],
      });
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'link' || interaction.commandName === 'unlink') {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        ...accountReply(interaction.commandName, config, interaction.user.id),
      });
      return;
    }
    if (interaction.commandName !== 'rolesync') return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Ei käyttöoikeutta.' });
      return;
    }
    const cmd = interaction.options.getSubcommand();
    if (cmd === 'status') {
      const state = store.state.activated ? 'AKTIIVINEN' : 'EI AKTIVOITU';
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `Tila: ${state}; ajo: ${running ? 'käynnissä' : 'valmis'}; asetus: ${config.dryRun ? 'DRY RUN' : 'LIVE'}\n` +
          `Viimeisin ajo: ${lastTime ?? 'ei vielä'}\n` +
          (lastResult ? formatSyncResult(lastResult) + '\n' : '') +
          (lastError ? `Virhe: ${lastError}` : ''),
      });
    } else if (cmd === 'history') {
      const rows = store.history(12);
      const content = rows.length ? rows.map((x) =>
        `${x.at} ${x.action}${x.discordId ? ` ${x.discordId} ${x.roleId}` : ''}${x.actor ? ` (by ${x.actor})` : ''}`).join('\n')
        : 'Auditointihistoria on tyhjä.';
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: content.slice(0, 1900) });
    } else if (cmd === 'activate') {
      if (running) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Synkronointi käynnissä, yritä uudelleen.' });
        return;
      }
      const wasActivated = store.activate(interaction.user.id);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: wasActivated
          ? 'LIVE-synkronointi aktivoitu. Roolit muuttuvat seuraavalla ajoituksella tai /rolesync now -komennolla.'
          : 'LIVE-synkronointi on jo aktivoitu.',
      });
    } else if (cmd === 'now' || cmd === 'dryrun') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const isPreview = cmd === 'dryrun';
      const response = await runSync({ dryRun: isPreview, preview: isPreview, actor: interaction.user.id });
      await interaction.editReply(response.busy ? 'Synkronointi on jo käynnissä.' :
        response.error ? `Synkronointi epäonnistui: ${response.error}` :
        formatSyncResult(response.result, isPreview) +
        (!store.state.activated ? '\nLIVE-muutokset estetty. Aktivoi ensin /rolesync activate.' : ''));
    }
  } catch (error) {
    log('error', `Command failed: ${error.message}`);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ flags: MessageFlags.Ephemeral, content: `Toiminto epäonnistui: ${error.message}` }).catch(() => {});
    } else {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Toiminto epäonnistui: ${error.message}` }).catch(() => {});
    }
  }
});

client.on(Events.Error, (error) => log('error', `Discord error: ${error.message}`));
client.login(config.botToken).catch((error) => {
  log('error', `Discord login failed: ${error.message}`);
  process.exitCode = 1;
});
