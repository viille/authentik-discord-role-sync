import 'dotenv/config';
import {
  Client, GatewayIntentBits, Events, PermissionFlagsBits, MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { loadConfig } from './config.js';
import { AuthentikClient } from './authentik.js';
import { synchronize, formatSyncResult } from './sync.js';
import { accountReply } from './account.js';

const config = loadConfig();
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
    .addSubcommand((s) => s.setName('status').setDescription('Näytä viimeisin synkronointitulos'))
    .addSubcommand((s) => s.setName('now').setDescription('Suorita synkronointi heti'))
    .addSubcommand((s) => s.setName('dryrun').setDescription('Näytä roolimuutokset muuttamatta rooleja')),
];

let running = false;
let lastResult = null;
let lastTime = null;
let lastError = null;
let guild;

async function runSync({ dryRun = config.dryRun } = {}) {
  if (running) return { busy: true };
  running = true;
  try {
    const result = await synchronize({ guild, authentik, config, log, dryRun });
    lastResult = result;
    lastError = null;
    lastTime = new Date().toISOString();
    log('info', 'Synchronization complete', result);
    return { result };
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
  await runSync();
  setInterval(() => { void runSync(); }, config.syncIntervalSeconds * 1000).unref();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.guildId !== config.guildId) return;
  try {
    if (interaction.commandName === 'link' || interaction.commandName === 'unlink') {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        ...accountReply(interaction.commandName, config),
      });
      return;
    }
    if (interaction.commandName !== 'rolesync') return;
    // Recheck live guild permission rather than relying only on command permissions.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Ei käyttöoikeutta.' });
      return;
    }
    const cmd = interaction.options.getSubcommand();
    if (cmd === 'status') {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `Tila: ${running ? 'käynnissä' : 'valmis'}; oletustila: ${config.dryRun ? 'DRY RUN' : 'LIVE'}; ` +
          `viimeisin ajo: ${lastTime ?? 'ei vielä'}\n` +
          (lastResult ? `Tulos: ${formatSyncResult(lastResult)}\n` : '') +
          (lastError ? `Viimeisin virhe: ${lastError}` : ''),
      });
    } else if (cmd === 'now' || cmd === 'dryrun') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      // The slash command's preview never changes persistent config or scheduled mode.
      const response = await runSync(cmd === 'dryrun' ? { dryRun: true } : {});
      await interaction.editReply(response.busy ? 'Synkronointi on jo käynnissä.' :
        response.error ? `Synkronointi epäonnistui: ${response.error}` :
        formatSyncResult(response.result, cmd === 'dryrun'));
    }
  } catch (error) {
    log('error', `Command failed: ${error.message}`);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ flags: MessageFlags.Ephemeral, content: 'Komennon suoritus epäonnistui.' }).catch(() => {});
    } else {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Komennon suoritus epäonnistui.' }).catch(() => {});
    }
  }
});

client.on(Events.Error, (error) => log('error', `Discord error: ${error.message}`));

client.login(config.botToken).catch((error) => {
  log('error', `Discord login failed: ${error.message}`);
  process.exitCode = 1;
});
