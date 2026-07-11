import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { bytesToHuman, ensureDir, isSubpath, pathExists } from './utils.js';
import { buildPaths } from './config.js';
import { readActiveSessionFiles } from './sessionScanner.js';
import { validateSessionPath } from './sessionAnalyzer.js';
import { appendBackupRecord } from './sessionBackupRecords.js';

const DEFAULT_MAX_PARSE_LINE_BYTES = 16 * 1024 * 1024;
const DEFAULT_LARGE_FIELD_BYTES = 256 * 1024;
const PREFIX_BYTES = 1024 * 1024;
const MAX_FIELD_SAMPLES = 100;
const MAX_LARGE_LINE_SAMPLES = 50;

function looksBase64(text) {
  const compact = String(text || '').replace(/\s/g, '');
  if (compact.length < 2048) return false;
  const sample = compact.slice(0, 8192);
  const valid = sample.match(/[A-Za-z0-9+/=]/g)?.length || 0;
  return valid / sample.length > 0.96;
}

function looksImageLike(text) {
  return String(text || '').includes('data:image') || String(text || '').includes('"image_url"') || String(text || '').includes('"referenced_image_paths"');
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function addStat(summary, fieldPath, originalBytes, replacementBytes, reason) {
  summary.replacements += 1;
  summary.originalBytesRemoved += Math.max(0, originalBytes - replacementBytes);
  if (summary.fields.length < MAX_FIELD_SAMPLES) {
    summary.fields.push({
      path: fieldPath,
      reason,
      originalBytes,
      originalBytesHuman: bytesToHuman(originalBytes),
      replacementBytes,
      replacementBytesHuman: bytesToHuman(replacementBytes)
    });
  } else {
    summary.omittedFieldSamples = (summary.omittedFieldSamples || 0) + 1;
  }
}

function placeholderText(kind, originalBytes, hash, reason) {
  return `[removed ${kind}: ${bytesToHuman(originalBytes)}, sha256=${hash}, reason=${reason}, removed_at=${new Date().toISOString()}]`;
}

function compactValue(value, fieldPath, options, summary) {
  if (typeof value === 'string') {
    const originalBytes = Buffer.byteLength(value);
    const lower = fieldPath.toLowerCase();
    const reason = [
      lower.includes('input_text') || lower.endsWith('.text') ? 'input_text/text' : null,
      lower.includes('encrypted_content') ? 'encrypted_content' : null,
      lower.includes('output') ? 'tool-output' : null,
      looksImageLike(value) ? 'image-like' : null,
      looksBase64(value) ? 'base64-like' : null,
      originalBytes >= options.largeFieldBytes ? 'large-field' : null
    ].filter(Boolean).join(',');
    const shouldReplace = originalBytes >= options.largeFieldBytes || looksBase64(value) || looksImageLike(value);
    if (shouldReplace) {
      const replacement = placeholderText('large field', originalBytes, sha256Text(value), reason || 'large-field');
      addStat(summary, fieldPath, originalBytes, Buffer.byteLength(replacement), reason || 'large-field');
      return replacement;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => compactValue(item, `${fieldPath}[${index}]`, options, summary));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = compactValue(child, fieldPath ? `${fieldPath}.${key}` : key, options, summary);
    }
    return out;
  }
  return value;
}

function extractJsonString(text, key) {
  const match = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1];
  }
}

function placeholderLineFromPrefix(prefix, bytes, hash) {
  const timestamp = extractJsonString(prefix, 'timestamp') || new Date().toISOString();
  const type = extractJsonString(prefix, 'type') || 'compacted_large_line';
  const payloadType = prefix.match(/"payload"\s*:\s*\{\s*"type"\s*:\s*"([^"]+)"/)?.[1] || null;
  return JSON.stringify({
    timestamp,
    type,
    payload: {
      type: 'compacted_large_line',
      original_type: type,
      original_payload_type: payloadType,
      original_bytes: bytes,
      original_bytes_human: bytesToHuman(bytes),
      sha256: hash,
      reason: 'line exceeded safe JSON parse limit and was replaced as a whole',
      compacted_at: new Date().toISOString()
    }
  });
}

function compactNormalLine(line, options, summary) {
  const originalBytes = Buffer.byteLength(line);
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    summary.unparsedLines += 1;
    return { line, changed: false };
  }
  if (parsed?.type === 'session_meta') return { line, changed: false };
  const fieldSummary = { replacements: 0, originalBytesRemoved: 0, fields: [], omittedFieldSamples: 0 };
  const compacted = compactValue(parsed, '', options, fieldSummary);
  if (fieldSummary.replacements === 0) return { line, changed: false };
  const nextLine = JSON.stringify(compacted);
  summary.replacements += fieldSummary.replacements;
  summary.originalBytesRemoved += Math.max(0, originalBytes - Buffer.byteLength(nextLine));
  const remaining = Math.max(0, MAX_FIELD_SAMPLES - summary.fields.length);
  summary.fields.push(...fieldSummary.fields.slice(0, remaining));
  summary.omittedFieldSamples += fieldSummary.omittedFieldSamples + Math.max(0, fieldSummary.fields.length - remaining);
  return { line: nextLine, changed: true };
}

function createSummary(filePath, stat) {
  return {
    filePath,
    originalBytes: stat.size,
    originalBytesHuman: bytesToHuman(stat.size),
    processedLines: 0,
    replacedLines: 0,
    unparsedLines: 0,
    replacements: 0,
    originalBytesRemoved: 0,
    originalBytesRemovedHuman: '0 B',
    fields: [],
    omittedFieldSamples: 0,
    largeLines: []
  };
}

async function writeLine(output, line) {
  if (!output) return;
  if (!output.write(`${line}\n`)) await once(output, 'drain');
}

async function processSessionFile(filePath, options = {}) {
  const stat = await fsp.stat(filePath);
  const summary = createSummary(filePath, stat);
  const maxParseLineBytes = Number(options.maxParseLineBytes || DEFAULT_MAX_PARSE_LINE_BYTES);
  const compactOptions = {
    largeFieldBytes: Number(options.largeFieldBytes || DEFAULT_LARGE_FIELD_BYTES)
  };
  const output = options.outputPath ? fs.createWriteStream(options.outputPath, { flags: 'wx' }) : null;
  const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
  let chunks = [];
  let lineBytes = 0;
  let oversized = null;

  async function finishNormalLine(buffer) {
    const line = buffer.toString('utf8');
    summary.processedLines += 1;
    const compacted = compactNormalLine(line, compactOptions, summary);
    if (compacted.changed) summary.replacedLines += 1;
    await writeLine(output, compacted.line);
  }

  async function finishOversizedLine(finalChunk = Buffer.alloc(0)) {
    if (finalChunk.length > 0) {
      oversized.hash.update(finalChunk);
      oversized.bytes += finalChunk.length;
      if (oversized.prefix.length < PREFIX_BYTES) {
        oversized.prefix = Buffer.concat([oversized.prefix, finalChunk]).subarray(0, PREFIX_BYTES);
      }
    }
    const hash = oversized.hash.digest('hex');
    const prefix = oversized.prefix.toString('utf8');
    const replacement = placeholderLineFromPrefix(prefix, oversized.bytes, hash);
    summary.processedLines += 1;
    summary.replacedLines += 1;
    summary.replacements += 1;
    summary.originalBytesRemoved += Math.max(0, oversized.bytes - Buffer.byteLength(replacement));
    if (summary.largeLines.length < MAX_LARGE_LINE_SAMPLES) {
      summary.largeLines.push({
        originalBytes: oversized.bytes,
        originalBytesHuman: bytesToHuman(oversized.bytes),
        replacementBytes: Buffer.byteLength(replacement),
        replacementBytesHuman: bytesToHuman(Buffer.byteLength(replacement)),
        sha256: hash,
        snippet: prefix.replace(/\s+/g, ' ').slice(0, 220)
      });
    }
    await writeLine(output, replacement);
    oversized = null;
    chunks = [];
    lineBytes = 0;
  }

  for await (const chunk of stream) {
    let start = 0;
    for (let i = 0; i < chunk.length; i += 1) {
      if (chunk[i] !== 10) continue;
      const part = chunk.subarray(start, i);
      if (oversized) {
        await finishOversizedLine(part);
      } else {
        chunks.push(part);
        lineBytes += part.length;
        if (lineBytes > maxParseLineBytes) {
          oversized = {
            hash: crypto.createHash('sha256'),
            bytes: 0,
            prefix: Buffer.alloc(0)
          };
          for (const piece of chunks) {
            oversized.hash.update(piece);
            oversized.bytes += piece.length;
            if (oversized.prefix.length < PREFIX_BYTES) {
              oversized.prefix = Buffer.concat([oversized.prefix, piece]).subarray(0, PREFIX_BYTES);
            }
          }
          await finishOversizedLine();
        } else {
          await finishNormalLine(Buffer.concat(chunks, lineBytes));
          chunks = [];
          lineBytes = 0;
        }
      }
      start = i + 1;
    }
    const tail = chunk.subarray(start);
    if (tail.length === 0) continue;
    if (oversized) {
      oversized.hash.update(tail);
      oversized.bytes += tail.length;
      if (oversized.prefix.length < PREFIX_BYTES) {
        oversized.prefix = Buffer.concat([oversized.prefix, tail]).subarray(0, PREFIX_BYTES);
      }
    } else {
      chunks.push(tail);
      lineBytes += tail.length;
      if (lineBytes > maxParseLineBytes) {
        oversized = {
          hash: crypto.createHash('sha256'),
          bytes: 0,
          prefix: Buffer.alloc(0)
        };
        for (const piece of chunks) {
          oversized.hash.update(piece);
          oversized.bytes += piece.length;
          if (oversized.prefix.length < PREFIX_BYTES) {
            oversized.prefix = Buffer.concat([oversized.prefix, piece]).subarray(0, PREFIX_BYTES);
          }
        }
        chunks = [];
        lineBytes = 0;
      }
    }
  }

  if (oversized) await finishOversizedLine();
  else if (lineBytes > 0) await finishNormalLine(Buffer.concat(chunks, lineBytes));

  if (output) {
    output.end();
    await once(output, 'finish');
  }
  summary.originalBytesRemovedHuman = bytesToHuman(summary.originalBytesRemoved);
  if (options.outputPath) {
    const outStat = await fsp.stat(options.outputPath);
    summary.outputPath = options.outputPath;
    summary.outputBytes = outStat.size;
    summary.outputBytesHuman = bytesToHuman(outStat.size);
  }
  return summary;
}

function compactPathFor(paths, source) {
  const relative = path.relative(paths.sessionsDir, source);
  return path.join(paths.sessionCompactedDir, relative);
}

function backupPathFor(paths, source) {
  const relative = path.relative(paths.sessionsDir, source);
  return path.join(paths.sessionBackupsDir, relative);
}

export async function getCompactState(options = {}) {
  const { paths, resolved } = validateSessionPath(options.path, options.codexHome);
  const compactedPath = compactPathFor(paths, resolved);
  const backupPath = backupPathFor(paths, resolved);
  const [compactedExists, backupExists] = await Promise.all([
    pathExists(compactedPath),
    pathExists(backupPath)
  ]);
  const state = {
    originalPath: resolved,
    compactedPath,
    compactedExists,
    backupPath,
    backupExists
  };
  if (compactedExists) {
    const stat = await fsp.stat(compactedPath);
    state.compactedBytes = stat.size;
    state.compactedBytesHuman = bytesToHuman(stat.size);
    state.compactedMtime = stat.mtime.toISOString();
  }
  if (backupExists) {
    const stat = await fsp.stat(backupPath);
    state.backupBytes = stat.size;
    state.backupBytesHuman = bytesToHuman(stat.size);
    state.backupMtime = stat.mtime.toISOString();
  }
  return state;
}

async function appendManifest(paths, entry) {
  await ensureDir(paths.sessionCompactedDir);
  const manifestPath = path.join(paths.sessionCompactedDir, 'manifest.jsonl');
  await fsp.appendFile(manifestPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

export async function compactPreview(options = {}) {
  const { resolved } = validateSessionPath(options.path, options.codexHome);
  return processSessionFile(resolved, options);
}

export async function compactCopy(options = {}) {
  const { paths, resolved } = validateSessionPath(options.path, options.codexHome);
  const outputPath = options.outputPath ? path.resolve(options.outputPath) : compactPathFor(paths, resolved);
  if (!isSubpath(paths.sessionCompactedDir, outputPath)) throw new Error('compact output must be inside session_compacted');
  if (await pathExists(outputPath)) throw new Error(`compact output already exists: ${outputPath}`);
  await ensureDir(path.dirname(outputPath));
  const originalSha256 = await sha256File(resolved);
  const summary = await processSessionFile(resolved, { ...options, outputPath });
  const compactedSha256 = await sha256File(outputPath);
  await appendManifest(paths, {
    action: 'compact_copy',
    createdAt: new Date().toISOString(),
    originalPath: resolved,
    compactedPath: outputPath,
    originalSha256,
    compactedSha256,
    summary
  });
  return { ...summary, originalSha256, compactedSha256 };
}

export async function replaceWithCompact(options = {}) {
  if (options.confirm !== 'REPLACE WITH COMPACT') throw new Error('confirmation string must be REPLACE WITH COMPACT');
  const { paths, resolved } = validateSessionPath(options.path, options.codexHome);
  const active = await readActiveSessionFiles(paths.sessionsDir, options);
  if (active.has(resolved)) throw new Error('refusing to replace an active session file');
  const compactedPath = options.compactedPath ? path.resolve(options.compactedPath) : compactPathFor(paths, resolved);
  if (!isSubpath(paths.sessionCompactedDir, compactedPath)) throw new Error('compacted file must be inside session_compacted');
  if (!(await pathExists(compactedPath))) throw new Error(`compacted file not found: ${compactedPath}`);
  const backupPath = backupPathFor(paths, resolved);
  if (await pathExists(backupPath)) throw new Error(`backup already exists: ${backupPath}`);
  await ensureDir(path.dirname(backupPath));
  const originalSha256 = await sha256File(resolved);
  await fsp.rename(resolved, backupPath);
  await ensureDir(path.dirname(resolved));
  await fsp.rename(compactedPath, resolved);
  await appendManifest(paths, {
    action: 'replace_with_compact',
    replacedAt: new Date().toISOString(),
    originalPath: resolved,
    backupPath,
    compactedPath,
    originalSha256,
    replacementSha256: await sha256File(resolved)
  });
  const backupRecord = await appendBackupRecord({
    codexHome: paths.codexHome,
    originalPath: resolved,
    backupPath,
    sha256: originalSha256,
    source: 'local_backup',
    status: 'available'
  });
  return { originalPath: resolved, backupPath, backupRecord: backupRecord.record, restoredFromCompact: compactedPath };
}

export async function restoreBackup(options = {}) {
  if (options.confirm !== 'RESTORE BACKUP') throw new Error('confirmation string must be RESTORE BACKUP');
  const { paths, resolved } = validateSessionPath(options.path, options.codexHome);
  const active = await readActiveSessionFiles(paths.sessionsDir, options);
  if (active.has(resolved)) throw new Error('refusing to restore over an active session file');
  const backupPath = options.backupPath ? path.resolve(options.backupPath) : backupPathFor(paths, resolved);
  if (!isSubpath(paths.sessionBackupsDir, backupPath)) throw new Error('backup file must be inside session_backups');
  if (!(await pathExists(backupPath))) throw new Error(`backup file not found: ${backupPath}`);
  const currentPath = `${resolved}.before-restore-${Date.now()}`;
  if (await pathExists(resolved)) await fsp.rename(resolved, currentPath);
  await ensureDir(path.dirname(resolved));
  await fsp.rename(backupPath, resolved);
  await appendManifest(paths, {
    action: 'restore_backup',
    restoredAt: new Date().toISOString(),
    restoredPath: resolved,
    backupPath,
    previousCompactedPath: await pathExists(currentPath) ? currentPath : null,
    restoredSha256: await sha256File(resolved)
  });
  return { restoredPath: resolved, previousCompactedPath: await pathExists(currentPath) ? currentPath : null };
}
