import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const MAX_AUDIT = 1500;
const MAX_RUNS = 100;
const PREVIEW_LIFETIME_MS = 30 * 60 * 1000;

export function configurationKey(config) {
  // A change to any permission-relevant setting requires reactivation.
  const relevant = {
    guildId: config.guildId,
    authentikUrl: config.authentikUrl,
    sourceSlug: config.sourceSlug,
    removeUnlinked: config.removeUnlinked,
    maxMutations: config.maxMutations,
    maxRemovals: config.maxRemovals,
    maxLinkDropPercent: config.maxLinkDropPercent,
    minLinkedUsers: config.minLinkedUsers,
    mappings: [...config.mappings].map((m) => ({ ...m })).sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
  return createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
}

export class StateStore {
  constructor(filename, configKey) {
    this.filename = filename;
    this.configKey = configKey;
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    if (!fs.existsSync(filename)) {
      this.state = this.fresh();
      this.save();
      return;
    }
    let data;
    try { data = JSON.parse(fs.readFileSync(filename, 'utf8')); }
    catch (error) { throw new Error(`Unsafe state file, refusing to start: ${error.message}`); }
    if (data?.schema !== 1 || !Array.isArray(data.audit) ||
        !Array.isArray(data.runs) || typeof data.activated !== 'boolean') {
      throw new Error('Invalid state file schema, refusing to start');
    }
    this.state = data;
    if (data.configKey !== configKey) {
      this.state.configKey = configKey;
      this.state.activated = false;
      this.state.previewAt = null;
      this.state.previewKey = null;
      this.state.baseline = null;
      this.appendAudit({ action: 'deactivated', reason: 'configuration changed' });
    }
  }

  fresh() {
    return {
      schema: 1, configKey: this.configKey, activated: false,
      previewAt: null, previewKey: null, baseline: null,
      audit: [], runs: [],
    };
  }

  save() {
    const temp = `${this.filename}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.state, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temp, this.filename);
  }

  appendAudit(event) {
    this.state.audit.push({ at: new Date().toISOString(), ...event });
    this.state.audit = this.state.audit.slice(-MAX_AUDIT);
    this.save();
  }

  recordRun(result, actor = 'system') {
    this.state.runs.push({
      at: new Date().toISOString(), actor,
      dryRun: result.dryRun, planned: result.planned,
      added: result.added, removed: result.removed, errors: result.errors,
      linked: result.linked, members: result.members,
    });
    this.state.runs = this.state.runs.slice(-MAX_RUNS);
    this.save();
  }

  recordPreview() {
    this.state.previewAt = new Date().toISOString();
    this.state.previewKey = this.configKey;
    this.save();
  }

  activate(actor) {
    if (this.state.activated) return false;
    if (this.state.previewKey !== this.configKey ||
        !this.state.previewAt ||
        Date.now() - Date.parse(this.state.previewAt) > PREVIEW_LIFETIME_MS) {
      throw new Error('Run /rolesync dryrun within the last 30 minutes before activation.');
    }
    this.state.activated = true;
    this.appendAudit({ action: 'activated', actor });
    return true;
  }

  setBaseline(snapshot, memberCount) {
    this.state.baseline = {
      linked: snapshot.linkedCount,
      users: snapshot.usersById.size,
      members: memberCount,
      at: new Date().toISOString(),
    };
    this.save();
  }

  history(limit = 10) {
    return this.state.audit.slice(-limit).reverse();
  }
}
