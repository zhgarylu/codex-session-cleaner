import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { buildPaths } from './config.js';
import { ensureDir, isSubpath, pathExists } from './utils.js';
import { scanSessions } from './sessionScanner.js';

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function archivePathFor(paths, session) {
  const relative = session.relativePath || path.relative(paths.sessionsDir, session.path);
  return path.join(paths.archivedSessionsDir, `${relative}.gz`);
}

async function writeManifest(paths, entry) {
  await ensureDir(paths.archivedSessionsDir);
  const manifestPath = path.join(paths.archivedSessionsDir, 'manifest.jsonl');
  await fsp.appendFile(manifestPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

export async function archiveSessions(options = {}) {
  if (!options.apply) throw new Error('archive requires apply=true');
  const scan = await scanSessions(options);
  const paths = buildPaths(options.codexHome);
  const requested = new Set(options.sessionIds || []);
  const candidates = scan.sessions.filter((session) => {
    if (session.recommendation !== 'archive_candidate') return false;
    return requested.size === 0 || requested.has(session.sessionId);
  });
  const results = [];
  for (const session of candidates) {
    const source = path.resolve(session.path);
    if (!isSubpath(paths.sessionsDir, source)) {
      results.push({ sessionId: session.sessionId, status: 'skipped', reason: 'outside sessions directory' });
      continue;
    }
    const target = archivePathFor(paths, session);
    if (await pathExists(target)) {
      results.push({ sessionId: session.sessionId, status: 'skipped', reason: 'archive already exists' });
      continue;
    }
    await ensureDir(path.dirname(target));
    const sourceSha256 = await sha256File(source);
    await pipeline(fs.createReadStream(source), zlib.createGzip({ level: 9 }), fs.createWriteStream(target, { flags: 'wx' }));
    const entry = {
      action: 'archive',
      archivedAt: new Date().toISOString(),
      sessionId: session.sessionId,
      title: session.title,
      cwd: session.cwd,
      originalPath: source,
      archivePath: target,
      originalSize: session.size,
      originalMtime: session.mtime,
      sha256: sourceSha256
    };
    await writeManifest(paths, entry);
    await fsp.unlink(source);
    results.push({ sessionId: session.sessionId, status: 'archived', originalPath: source, archivePath: target, bytes: session.size });
  }
  return { results };
}

export async function loadManifest(codexHome) {
  const paths = buildPaths(codexHome);
  const manifestPath = path.join(paths.archivedSessionsDir, 'manifest.jsonl');
  if (!(await pathExists(manifestPath))) return [];
  const content = await fsp.readFile(manifestPath, 'utf8');
  return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export async function restoreSession(options = {}) {
  if (!options.sessionId && !options.archivePath) throw new Error('restore requires sessionId or archivePath');
  const entries = await loadManifest(options.codexHome);
  const entry = [...entries].reverse().find((row) => {
    return (options.sessionId && row.sessionId === options.sessionId) || (options.archivePath && row.archivePath === options.archivePath);
  });
  if (!entry) throw new Error('archive manifest entry not found');
  if (await pathExists(entry.originalPath)) throw new Error(`refusing to overwrite existing file: ${entry.originalPath}`);
  await ensureDir(path.dirname(entry.originalPath));
  await pipeline(fs.createReadStream(entry.archivePath), zlib.createGunzip(), fs.createWriteStream(entry.originalPath, { flags: 'wx' }));
  const restoredSha256 = await sha256File(entry.originalPath);
  if (restoredSha256 !== entry.sha256) {
    await fsp.unlink(entry.originalPath);
    throw new Error('restored file checksum mismatch');
  }
  return { restoredPath: entry.originalPath, sessionId: entry.sessionId };
}

export async function deleteArchivedSessions(options = {}) {
  if (!options.apply) throw new Error('delete archives requires apply=true');
  const archiveRetentionDays = Number(options.archiveRetentionDays || 180);
  const cutoff = Date.now() - archiveRetentionDays * 24 * 60 * 60 * 1000;
  const paths = buildPaths(options.codexHome);
  const entries = await loadManifest(options.codexHome);
  const requested = new Set(options.archivePaths || []);
  const results = [];
  const seen = new Set();
  for (const entry of entries) {
    if (entry.action && entry.action !== 'archive') continue;
    if (!entry.archivePath || seen.has(entry.archivePath)) continue;
    seen.add(entry.archivePath);
    if (requested.size > 0 && !requested.has(entry.archivePath)) continue;
    if (!isSubpath(paths.archivedSessionsDir, path.resolve(entry.archivePath))) {
      results.push({ archivePath: entry.archivePath, status: 'skipped', reason: 'outside archived sessions directory' });
      continue;
    }
    let stat;
    try {
      stat = await fsp.stat(entry.archivePath);
    } catch {
      results.push({ archivePath: entry.archivePath, status: 'missing' });
      continue;
    }
    const archivedAtMs = entry.archivedAt ? Date.parse(entry.archivedAt) : stat.mtimeMs;
    if (archivedAtMs >= cutoff) {
      results.push({ archivePath: entry.archivePath, status: 'skipped', reason: 'archive retention window has not elapsed' });
      continue;
    }
    await fsp.unlink(entry.archivePath);
    await writeManifest(paths, {
      action: 'delete_archive',
      deletedAt: new Date().toISOString(),
      sessionId: entry.sessionId,
      archivePath: entry.archivePath,
      bytes: stat.size
    });
    results.push({ archivePath: entry.archivePath, sessionId: entry.sessionId, status: 'deleted', bytes: stat.size });
  }
  return { results };
}
