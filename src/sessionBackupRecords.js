import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { buildPaths } from './config.js';
import { readActiveSessionFiles } from './sessionScanner.js';
import { validateSessionPath } from './sessionAnalyzer.js';
import { bytesToHuman, ensureDir, isSubpath, parseJsonLine, pathExists, readFirstLine } from './utils.js';

const RECORDS_FILE = 'backup_records.jsonl';

function recordsPath(paths) {
  return path.join(paths.sessionBackupsDir, RECORDS_FILE);
}

function makeRecordId(record) {
  return crypto
    .createHash('sha256')
    .update([record.originalPath, record.backupPath || record.externalPath || '', record.sha256 || ''].join('\n'))
    .digest('hex')
    .slice(0, 24);
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function statRecordPath(record) {
  const filePath = record.backupPath || record.externalPath;
  if (!filePath) return { exists: false };
  try {
    const stat = await fsp.stat(filePath);
    return {
      exists: stat.isFile(),
      size: stat.size,
      sizeHuman: bytesToHuman(stat.size),
      mtime: stat.mtime.toISOString()
    };
  } catch {
    return { exists: false };
  }
}

async function readRecordsFile(paths) {
  const filePath = recordsPath(paths);
  if (!(await pathExists(filePath))) return [];
  const text = await fsp.readFile(filePath, 'utf8');
  return text
    .split('\n')
    .map((line) => parseJsonLine(line))
    .filter(Boolean);
}

async function readSessionMeta(filePath) {
  try {
    const first = parseJsonLine(await readFirstLine(filePath));
    const payload = first?.payload || {};
    return {
      sessionId: payload.session_id || payload.id || null,
      cwd: payload.cwd || payload.session_meta?.payload?.cwd || null,
      title: payload.title || null
    };
  } catch {
    return { sessionId: null, cwd: null, title: null };
  }
}

function dedupeRecords(records) {
  const map = new Map();
  for (const record of records) {
    if (!record?.recordId) continue;
    map.set(record.recordId, record);
  }
  return [...map.values()].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function readBackupRecords(codexHome) {
  const paths = buildPaths(codexHome);
  const records = dedupeRecords(await readRecordsFile(paths));
  return Promise.all(records.map(async (record) => ({
    ...record,
    file: await statRecordPath(record)
  })));
}

export async function appendBackupRecord(options = {}) {
  const paths = buildPaths(options.codexHome);
  const filePath = options.backupPath || options.externalPath;
  if (!options.originalPath) throw new Error('originalPath is required');
  if (!filePath) throw new Error('backupPath or externalPath is required');
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) throw new Error(`backup is not a file: ${filePath}`);
  const meta = await readSessionMeta(filePath);
  const record = {
    recordId: null,
    originalPath: path.resolve(options.originalPath),
    backupPath: options.backupPath ? path.resolve(options.backupPath) : null,
    externalPath: options.externalPath ? path.resolve(options.externalPath) : null,
    sessionId: options.sessionId || meta.sessionId,
    title: options.title || meta.title,
    cwd: options.cwd || meta.cwd,
    size: options.size || stat.size,
    sizeHuman: bytesToHuman(options.size || stat.size),
    sha256: options.sha256 || await sha256File(filePath),
    createdAt: options.createdAt || new Date().toISOString(),
    source: options.source || 'local_backup',
    status: options.status || 'available'
  };
  record.recordId = makeRecordId(record);

  await ensureDir(paths.sessionBackupsDir);
  const existing = await readRecordsFile(paths);
  if (existing.some((row) => row.recordId === record.recordId)) {
    return { record, appended: false };
  }
  await fsp.appendFile(recordsPath(paths), `${JSON.stringify(record)}\n`, 'utf8');
  return { record, appended: true };
}

export async function listBackupRecordsForSession(options = {}) {
  const { paths, resolved } = validateSessionPath(options.path, options.codexHome);
  const meta = await readSessionMeta(resolved);
  const records = await readBackupRecords(paths.codexHome);
  return {
    originalPath: resolved,
    records: records.filter((record) => (
      record.originalPath === resolved ||
      (meta.sessionId && record.sessionId === meta.sessionId)
    ))
  };
}

async function walkJsonlFiles(root) {
  if (!(await pathExists(root))) return [];
  const out = [];
  async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.DS_Store' || entry.name === RECORDS_FILE || entry.name === 'manifest.jsonl') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        out.push(fullPath);
      }
    }
  }
  await walk(root);
  return out;
}

async function loadCompactManifest(paths) {
  const manifestPath = path.join(paths.sessionCompactedDir, 'manifest.jsonl');
  if (!(await pathExists(manifestPath))) return [];
  const text = await fsp.readFile(manifestPath, 'utf8');
  return text.split('\n').map((line) => parseJsonLine(line)).filter(Boolean);
}

export async function reconcileBackupRecords(options = {}) {
  const paths = buildPaths(options.codexHome);
  const manifestByBackup = new Map();
  for (const entry of await loadCompactManifest(paths)) {
    if (entry?.backupPath && entry?.originalPath) manifestByBackup.set(path.resolve(entry.backupPath), entry);
  }

  const files = await walkJsonlFiles(paths.sessionBackupsDir);
  const results = [];
  for (const backupPath of files) {
    const manifest = manifestByBackup.get(path.resolve(backupPath));
    const relative = path.relative(paths.sessionBackupsDir, backupPath);
    const originalPath = manifest?.originalPath || (
      relative.startsWith(`imported${path.sep}`) ? null : path.join(paths.sessionsDir, relative)
    );
    if (!originalPath) continue;
    const stat = await fsp.stat(backupPath);
    const result = await appendBackupRecord({
      codexHome: paths.codexHome,
      originalPath,
      backupPath,
      size: stat.size,
      sha256: manifest?.originalSha256,
      createdAt: manifest?.replacedAt || stat.mtime.toISOString(),
      source: manifest ? 'local_backup' : 'reconciled_backup',
      status: 'available'
    });
    results.push(result);
  }
  return {
    recordsFile: recordsPath(paths),
    scannedFiles: files.length,
    appended: results.filter((row) => row.appended).length,
    skippedExisting: results.filter((row) => !row.appended).length,
    records: results.map((row) => row.record)
  };
}

export async function registerExternalBackup(options = {}) {
  const { paths, resolved } = validateSessionPath(options.path, options.codexHome);
  if (!options.externalPath) throw new Error('externalPath is required');
  const externalPath = path.resolve(options.externalPath);
  if (!externalPath.endsWith('.jsonl')) throw new Error('external backup must be a .jsonl file');
  if (!(await pathExists(externalPath))) throw new Error(`external backup not found: ${externalPath}`);
  return appendBackupRecord({
    codexHome: paths.codexHome,
    originalPath: resolved,
    externalPath,
    source: 'external_backup',
    status: 'available'
  });
}

function importedPathFor(paths, sourcePath, sha256) {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const parsed = path.parse(sourcePath);
  return path.join(paths.sessionBackupsDir, 'imported', yyyy, mm, dd, `${parsed.name}-${sha256.slice(0, 12)}${parsed.ext}`);
}

export async function importBackupFile(options = {}) {
  const { paths, resolved } = validateSessionPath(options.path, options.codexHome);
  const sourcePath = path.resolve(options.sourcePath || options.externalPath || '');
  if (!sourcePath || !sourcePath.endsWith('.jsonl')) throw new Error('source backup must be a .jsonl file');
  if (!(await pathExists(sourcePath))) throw new Error(`source backup not found: ${sourcePath}`);
  const sha256 = await sha256File(sourcePath);
  const destinationPath = importedPathFor(paths, sourcePath, sha256);
  await ensureDir(path.dirname(destinationPath));
  if (!(await pathExists(destinationPath))) {
    await fsp.copyFile(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
  }
  return appendBackupRecord({
    codexHome: paths.codexHome,
    originalPath: resolved,
    backupPath: destinationPath,
    sha256,
    source: 'imported_backup',
    status: 'available'
  });
}

export async function restoreBackupRecord(options = {}) {
  if (options.confirm !== 'RESTORE BACKUP RECORD') throw new Error('confirmation string must be RESTORE BACKUP RECORD');
  const paths = buildPaths(options.codexHome);
  const records = await readRecordsFile(paths);
  const record = records.find((row) => row.recordId === options.recordId);
  if (!record) throw new Error('backup record not found');
  const resolved = path.resolve(record.originalPath);
  if (!isSubpath(paths.sessionsDir, resolved)) throw new Error('record original path is outside Codex sessions directory');
  const sourcePath = path.resolve(record.backupPath || record.externalPath || '');
  if (!sourcePath || !(await pathExists(sourcePath))) throw new Error(`backup file not found: ${sourcePath}`);
  if (record.backupPath && !isSubpath(paths.sessionBackupsDir, sourcePath)) {
    throw new Error('local backup file must be inside session_backups');
  }
  const active = await readActiveSessionFiles(paths.sessionsDir, options);
  if (active.has(resolved)) throw new Error('refusing to restore over an active session file');
  const sourceSha256 = await sha256File(sourcePath);
  if (record.sha256 && sourceSha256 !== record.sha256) throw new Error('backup checksum mismatch');
  const currentPath = `${resolved}.before-restore-${Date.now()}`;
  if (await pathExists(resolved)) await fsp.rename(resolved, currentPath);
  await ensureDir(path.dirname(resolved));
  await fsp.copyFile(sourcePath, resolved, fs.constants.COPYFILE_EXCL);
  const restoredSha256 = await sha256File(resolved);
  if (restoredSha256 !== sourceSha256) throw new Error('restored file checksum mismatch');
  return {
    restoredPath: resolved,
    sourcePath,
    recordId: record.recordId,
    previousCompactedPath: await pathExists(currentPath) ? currentPath : null,
    restoredSha256
  };
}
