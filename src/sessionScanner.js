import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildPaths, DEFAULT_RETENTION_DAYS, DEFAULT_ARCHIVE_RETENTION_DAYS } from './config.js';
import {
  bytesToHuman,
  dayKey,
  dayKeyFromPath,
  isSubpath,
  monthKeyFromPath,
  parseJsonLine,
  pathExists,
} from './utils.js';

const execFileAsync = promisify(execFile);

async function walkJsonl(dir) {
  const out = [];
  async function visit(current) {
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        out.push(fullPath);
      }
    }));
  }
  await visit(dir);
  return out;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function readSessionIndex(sessionIndexPath) {
  const latest = new Map();
  const conflicts = new Set();
  if (!(await pathExists(sessionIndexPath))) return { latest, conflicts };
  const content = await fs.readFile(sessionIndexPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const row = parseJsonLine(line);
    if (!row?.id) continue;
    const prior = latest.get(row.id);
    if (prior && prior.thread_name && row.thread_name && prior.thread_name !== row.thread_name) {
      conflicts.add(row.id);
    }
    const priorTime = prior?.updated_at ? Date.parse(prior.updated_at) : 0;
    const rowTime = row.updated_at ? Date.parse(row.updated_at) : 0;
    if (!prior || rowTime >= priorTime) {
      latest.set(row.id, {
        id: row.id,
        title: row.thread_name || '',
        updatedAt: row.updated_at || null
      });
    }
  }
  return { latest, conflicts };
}

async function readArchivedSummary(paths, archiveRetentionDays, now) {
  const manifestPath = path.join(paths.archivedSessionsDir, 'manifest.jsonl');
  const empty = {
    files: 0,
    bytes: 0,
    bytesHuman: '0 B',
    deleteCandidateFiles: 0,
    deleteCandidateBytes: 0,
    deleteCandidateBytesHuman: '0 B'
  };
  if (!(await pathExists(manifestPath))) return empty;
  let rows = [];
  try {
    rows = (await fs.readFile(manifestPath, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return empty;
  }
  const cutoff = now.getTime() - archiveRetentionDays * 24 * 60 * 60 * 1000;
  const seen = new Set();
  const totals = { ...empty, bytesHuman: undefined, deleteCandidateBytesHuman: undefined };
  for (const row of rows) {
    if (row.action && row.action !== 'archive') continue;
    if (!row.archivePath || seen.has(row.archivePath)) continue;
    seen.add(row.archivePath);
    let stat;
    try {
      stat = await fs.stat(row.archivePath);
    } catch {
      continue;
    }
    totals.files += 1;
    totals.bytes += stat.size;
    const archivedAtMs = row.archivedAt ? Date.parse(row.archivedAt) : stat.mtimeMs;
    if (archivedAtMs < cutoff) {
      totals.deleteCandidateFiles += 1;
      totals.deleteCandidateBytes += stat.size;
    }
  }
  return {
    ...totals,
    bytesHuman: bytesToHuman(totals.bytes),
    deleteCandidateBytesHuman: bytesToHuman(totals.deleteCandidateBytes)
  };
}

export async function readActiveSessionFiles(sessionsDir, options = {}) {
  if (options.activeFiles) return new Set(options.activeFiles.map((p) => path.resolve(p)));
  let stdout = '';
  try {
    const result = await execFileAsync('lsof', ['-F', 'n'], { maxBuffer: 50 * 1024 * 1024, timeout: 5000 });
    stdout = result.stdout;
  } catch (error) {
    stdout = error.stdout || '';
  }
  const active = new Set();
  const root = path.resolve(sessionsDir);
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('n')) {
      const filePath = path.resolve(line.slice(1));
      if (filePath.endsWith('.jsonl') && isSubpath(root, filePath)) active.add(filePath);
    }
  }
  if (active.size === 0 && !stdout) {
    return new Set();
  }
  return active;
}

function pidLooksAlive(pid) {
  const numeric = Number(pid);
  if (!Number.isInteger(numeric) || numeric <= 0) return false;
  try {
    process.kill(numeric, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readProcessSessionIds(processManagerPath, now = new Date()) {
  const protectedIds = new Set();
  if (!(await pathExists(processManagerPath))) return protectedIds;
  let rows = [];
  try {
    rows = JSON.parse(await fs.readFile(processManagerPath, 'utf8'));
  } catch {
    return protectedIds;
  }
  if (!Array.isArray(rows)) return protectedIds;
  const oneDayAgo = now.getTime() - 24 * 60 * 60 * 1000;
  for (const row of rows) {
    if (!row?.conversationId) continue;
    const updatedAt = Number(row.updatedAtMs || 0);
    const recentlyUpdated = updatedAt >= oneDayAgo;
    const alive = pidLooksAlive(row.osPid) || pidLooksAlive(row.processId);
    if (alive || recentlyUpdated) protectedIds.add(row.conversationId);
  }
  return protectedIds;
}

function sessionIdFromFileName(filePath) {
  const base = path.basename(filePath);
  const match = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1] : null;
}

function extractJsonString(text, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`"${escapedKey}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1];
  }
}

async function readSessionMeta(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const chunks = [];
    const buffer = Buffer.alloc(4096);
    let position = 0;
    let lineCount = 0;
    while (position < 64 * 1024 && lineCount < 20) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const slice = buffer.subarray(0, bytesRead);
      chunks.push(slice);
      position += bytesRead;
      lineCount += [...slice].filter((byte) => byte === 10).length;
      const text = Buffer.concat(chunks).toString('utf8');
      const firstLineEnd = text.indexOf('\n');
      if (firstLineEnd >= 0) {
        const first = parseJsonLine(text.slice(0, firstLineEnd));
        if (first?.type === 'session_meta') return { row: first, payload: first.payload || {} };
      }
      if (
        (text.includes('"session_id"') || text.includes('"id"')) &&
        text.includes('"cwd"') &&
        (text.includes('"type":"session_meta"') || text.includes('"type": "session_meta"'))
      ) {
        const payload = {
          session_id: extractJsonString(text, 'session_id'),
          id: extractJsonString(text, 'id'),
          timestamp: extractJsonString(text, 'timestamp'),
          cwd: extractJsonString(text, 'cwd'),
          originator: extractJsonString(text, 'originator'),
          source: extractJsonString(text, 'source')
        };
        return {
          row: { timestamp: extractJsonString(text, 'timestamp'), type: 'session_meta', payload },
          payload
        };
      }
    }
    const partial = Buffer.concat(chunks).toString('utf8');
    if (!partial.includes('"type":"session_meta"') && !partial.includes('"type": "session_meta"')) {
      return { row: null, payload: {} };
    }
    const payload = {
      session_id: extractJsonString(partial, 'session_id'),
      id: extractJsonString(partial, 'id'),
      timestamp: extractJsonString(partial, 'timestamp'),
      cwd: extractJsonString(partial, 'cwd'),
      originator: extractJsonString(partial, 'originator'),
      source: extractJsonString(partial, 'source')
    };
    return {
      row: { timestamp: extractJsonString(partial, 'timestamp'), type: 'session_meta', payload },
      payload
    };
  } finally {
    await handle.close();
  }
}

async function scanOne(filePath, context) {
  const stat = await fs.stat(filePath);
  const { row: first, payload } = await readSessionMeta(filePath);
  const sessionId = payload.session_id || payload.id || sessionIdFromFileName(filePath);
  const index = sessionId ? context.index.latest.get(sessionId) : null;
  const createdAt = payload.timestamp || first?.timestamp || null;
  const indexUpdatedAtMs = index?.updatedAt ? Date.parse(index.updatedAt) : 0;
  const createdAtMs = createdAt ? Date.parse(createdAt) : 0;
  const relevantTimeMs = Math.max(stat.mtimeMs, indexUpdatedAtMs, createdAtMs);
  const cwd = payload.cwd || null;
  const fileDay = dayKeyFromPath(filePath);
  const month = monthKeyFromPath(filePath);
  const active = context.activeFiles.has(path.resolve(filePath));
  const today = fileDay === context.todayKey;
  const recent = relevantTimeMs >= context.rawCutoffMs;
  const hasProcess = sessionId ? context.processSessionIds.has(sessionId) : false;
  const missingMetadata = !sessionId || !cwd;
  let cwdExists = false;
  if (cwd) {
    if (!context.cwdExistsCache.has(cwd)) {
      context.cwdExistsCache.set(cwd, await pathExists(cwd));
    }
    cwdExists = context.cwdExistsCache.get(cwd);
  }
  const indexConflict = sessionId ? context.index.conflicts.has(sessionId) : false;

  const reasons = [];
  if (active) reasons.push('Codex is currently writing this file');
  if (today) reasons.push('session is from today');
  if (recent) reasons.push(`updated within ${context.retentionDays} days`);
  if (hasProcess) reasons.push('linked to a recent or live process-manager record');
  if (missingMetadata) reasons.push('missing session id or project cwd metadata');
  if (indexConflict) reasons.push('session index has multiple titles for this id');

  let recommendation = 'archive_candidate';
  if (active || today || recent || hasProcess) {
    recommendation = 'protect';
  } else if (missingMetadata || indexConflict) {
    recommendation = 'manual_review';
  }

  return {
    path: filePath,
    relativePath: path.relative(context.paths.sessionsDir, filePath),
    sessionId,
    title: index?.title || '',
    cwd,
    cwdExists,
    source: payload.source || first?.source || null,
    originator: payload.originator || null,
    createdAt,
    indexUpdatedAt: index?.updatedAt || null,
    mtime: new Date(stat.mtimeMs).toISOString(),
    relevantTime: new Date(relevantTimeMs).toISOString(),
    size: stat.size,
    sizeHuman: bytesToHuman(stat.size),
    month,
    day: fileDay,
    active,
    today,
    recent,
    hasProcess,
    missingMetadata,
    indexConflict,
    recommendation,
    reasons
  };
}

async function summarizeSessions(sessions, context) {
  const byMonth = new Map();
  const byProject = new Map();
  const totals = {
    files: sessions.length,
    bytes: 0,
    archiveCandidateBytes: 0,
    archiveCandidateFiles: 0,
    protectedFiles: 0,
    manualReviewFiles: 0
  };

  for (const session of sessions) {
    totals.bytes += session.size;
    if (session.recommendation === 'archive_candidate') {
      totals.archiveCandidateBytes += session.size;
      totals.archiveCandidateFiles += 1;
    }
    if (session.recommendation === 'protect') totals.protectedFiles += 1;
    if (session.recommendation === 'manual_review') totals.manualReviewFiles += 1;

    const month = byMonth.get(session.month) || { month: session.month, files: 0, bytes: 0, archiveCandidateBytes: 0 };
    month.files += 1;
    month.bytes += session.size;
    if (session.recommendation === 'archive_candidate') month.archiveCandidateBytes += session.size;
    byMonth.set(session.month, month);

    const key = session.cwd || '(unknown project)';
    const project = byProject.get(key) || {
      cwd: key,
      exists: !!session.cwd && session.cwdExists,
      files: 0,
      bytes: 0,
      archiveCandidateBytes: 0,
      latest: null,
      currentWorkspace: session.cwd ? isSubpath(session.cwd, process.cwd()) || isSubpath(process.cwd(), session.cwd) : false
    };
    project.files += 1;
    project.bytes += session.size;
    if (session.recommendation === 'archive_candidate') project.archiveCandidateBytes += session.size;
    if (!project.latest || Date.parse(session.relevantTime) > Date.parse(project.latest)) project.latest = session.relevantTime;
    byProject.set(key, project);
  }

  return {
    generatedAt: context.now.toISOString(),
    codexHome: context.paths.codexHome,
    sessionsDir: context.paths.sessionsDir,
    archivedSessionsDir: context.paths.archivedSessionsDir,
    policy: {
      retentionDays: context.retentionDays,
      archiveRetentionDays: context.archiveRetentionDays
    },
    archives: await readArchivedSummary(context.paths, context.archiveRetentionDays, context.now),
    totals: {
      ...totals,
      bytesHuman: bytesToHuman(totals.bytes),
      archiveCandidateBytesHuman: bytesToHuman(totals.archiveCandidateBytes)
    },
    byMonth: [...byMonth.values()]
      .sort((a, b) => b.month.localeCompare(a.month))
      .map((row) => ({ ...row, bytesHuman: bytesToHuman(row.bytes), archiveCandidateBytesHuman: bytesToHuman(row.archiveCandidateBytes) })),
    byProject: [...byProject.values()]
      .sort((a, b) => b.bytes - a.bytes)
      .map((row) => ({ ...row, bytesHuman: bytesToHuman(row.bytes), archiveCandidateBytesHuman: bytesToHuman(row.archiveCandidateBytes) }))
  };
}

export async function scanSessions(options = {}) {
  const paths = buildPaths(options.codexHome);
  const now = options.now || new Date();
  const retentionDays = Number(options.retentionDays || DEFAULT_RETENTION_DAYS);
  const archiveRetentionDays = Number(options.archiveRetentionDays || DEFAULT_ARCHIVE_RETENTION_DAYS);
  const context = {
    paths,
    now,
    retentionDays,
    archiveRetentionDays,
    rawCutoffMs: now.getTime() - retentionDays * 24 * 60 * 60 * 1000,
    todayKey: dayKey(now),
    index: await readSessionIndex(paths.sessionIndexPath),
    activeFiles: await readActiveSessionFiles(paths.sessionsDir, options),
    processSessionIds: await readProcessSessionIds(paths.processManagerPath, now)
  };
  context.cwdExistsCache = new Map();
  const files = await walkJsonl(paths.sessionsDir);
  const sessions = await mapLimit(files, Number(options.concurrency || 64), async (filePath) => {
    try {
      return await scanOne(filePath, context);
    } catch (error) {
      return {
        path: filePath,
        relativePath: path.relative(paths.sessionsDir, filePath),
        sessionId: sessionIdFromFileName(filePath),
        title: '',
        cwd: null,
        cwdExists: false,
        createdAt: null,
        indexUpdatedAt: null,
        mtime: null,
        relevantTime: null,
        size: 0,
        sizeHuman: '0 B',
        month: monthKeyFromPath(filePath),
        day: dayKeyFromPath(filePath),
        active: false,
        today: false,
        recent: false,
        hasProcess: false,
        missingMetadata: true,
        indexConflict: false,
        recommendation: 'manual_review',
        reasons: [`scan failed: ${error.message}`]
      };
    }
  });
  sessions.sort((a, b) => Date.parse(b.relevantTime || 0) - Date.parse(a.relevantTime || 0));
  return {
    summary: await summarizeSessions(sessions, context),
    sessions
  };
}
