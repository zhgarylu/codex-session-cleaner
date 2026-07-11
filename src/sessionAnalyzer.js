import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildPaths } from './config.js';
import { bytesToHuman, isSubpath } from './utils.js';

const MAX_SNIPPET = 220;
const LARGE_LINE_BYTES = 1024 * 1024;

function addCount(map, key, amount = 1) {
  const safeKey = key || '(unknown)';
  map[safeKey] = (map[safeKey] || 0) + amount;
}

function topEntries(map, limit = 12) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function snippet(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_SNIPPET);
}

function looksBase64(text) {
  const compact = text.replace(/\s/g, '');
  if (compact.length < 2048) return false;
  const sample = compact.slice(0, 8192);
  const valid = sample.match(/[A-Za-z0-9+/=]/g)?.length || 0;
  return valid / sample.length > 0.96;
}

function lineSignals(line) {
  return {
    type: line.match(/"type"\s*:\s*"([^"]+)"/)?.[1] || '(unknown)',
    payloadType: line.match(/"payload"\s*:\s*\{\s*"type"\s*:\s*"([^"]+)"/)?.[1] || null,
    role: line.match(/"role"\s*:\s*"([^"]+)"/)?.[1] || null,
    timestamp: line.match(/"timestamp"\s*:\s*"([^"]+)"/)?.[1] || null,
    hasInputText: line.includes('"input_text"'),
    hasOutputText: line.includes('"output_text"'),
    hasFunctionCall: line.includes('"function_call"') || line.includes('"function_call_output"'),
    hasTokenCount: line.includes('"token_count"'),
    hasImageLikeData: line.includes('data:image') || line.includes('"image_url"') || line.includes('"referenced_image_paths"'),
    hasBase64LikeData: looksBase64(line)
  };
}

function createStats() {
  return {
    lines: 0,
    sampledBytes: 0,
    typeCounts: {},
    payloadTypeCounts: {},
    roleCounts: {},
    featureCounts: {
      inputText: 0,
      outputText: 0,
      functionCalls: 0,
      tokenCounts: 0,
      imageLikeData: 0,
      base64LikeData: 0,
      largeLines: 0
    },
    largeBlocks: [],
    timeline: {}
  };
}

function observeLine(stats, line, absoluteOffset = null, windowName = null) {
  const bytes = Buffer.byteLength(line);
  const signals = lineSignals(line);
  stats.lines += 1;
  stats.sampledBytes += bytes;
  addCount(stats.typeCounts, signals.type);
  if (signals.payloadType) addCount(stats.payloadTypeCounts, signals.payloadType);
  if (signals.role) addCount(stats.roleCounts, signals.role);
  if (signals.hasInputText) stats.featureCounts.inputText += 1;
  if (signals.hasOutputText) stats.featureCounts.outputText += 1;
  if (signals.hasFunctionCall) stats.featureCounts.functionCalls += 1;
  if (signals.hasTokenCount) stats.featureCounts.tokenCounts += 1;
  if (signals.hasImageLikeData) stats.featureCounts.imageLikeData += 1;
  if (signals.hasBase64LikeData) stats.featureCounts.base64LikeData += 1;
  if (bytes >= LARGE_LINE_BYTES || signals.hasBase64LikeData || signals.hasImageLikeData) {
    stats.featureCounts.largeLines += bytes >= LARGE_LINE_BYTES ? 1 : 0;
    stats.largeBlocks.push({
      bytes,
      bytesHuman: bytesToHuman(bytes),
      offset: absoluteOffset,
      window: windowName,
      type: signals.type,
      payloadType: signals.payloadType,
      flags: [
        bytes >= LARGE_LINE_BYTES ? 'large-line' : null,
        signals.hasBase64LikeData ? 'base64-like' : null,
        signals.hasImageLikeData ? 'image-like' : null,
        signals.hasInputText ? 'input_text' : null
      ].filter(Boolean),
      snippet: snippet(line)
    });
    stats.largeBlocks.sort((a, b) => b.bytes - a.bytes);
    stats.largeBlocks = stats.largeBlocks.slice(0, 20);
  }
  if (signals.timestamp) {
    const bucket = signals.timestamp.slice(0, 13).replace('T', ' ');
    const row = stats.timeline[bucket] || { bucket, lines: 0, bytes: 0 };
    row.lines += 1;
    row.bytes += bytes;
    stats.timeline[bucket] = row;
  }
}

function finalizeStats(stats) {
  const timeline = Object.values(stats.timeline)
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
    .map((row) => ({ ...row, bytesHuman: bytesToHuman(row.bytes) }));
  return {
    lines: stats.lines,
    sampledBytes: stats.sampledBytes,
    sampledBytesHuman: bytesToHuman(stats.sampledBytes),
    typeCounts: topEntries(stats.typeCounts),
    payloadTypeCounts: topEntries(stats.payloadTypeCounts),
    roleCounts: topEntries(stats.roleCounts),
    featureCounts: stats.featureCounts,
    largeBlocks: stats.largeBlocks,
    timeline
  };
}

function mergeStats(target, source) {
  target.lines += source.lines;
  target.sampledBytes += source.sampledBytes;
  for (const [key, value] of Object.entries(source.typeCounts)) addCount(target.typeCounts, key, value);
  for (const [key, value] of Object.entries(source.payloadTypeCounts)) addCount(target.payloadTypeCounts, key, value);
  for (const [key, value] of Object.entries(source.roleCounts)) addCount(target.roleCounts, key, value);
  for (const [key, value] of Object.entries(source.featureCounts)) target.featureCounts[key] += value;
  for (const block of source.largeBlocks) target.largeBlocks.push(block);
  target.largeBlocks.sort((a, b) => b.bytes - a.bytes);
  target.largeBlocks = target.largeBlocks.slice(0, 20);
  for (const row of Object.values(source.timeline)) {
    const current = target.timeline[row.bucket] || { bucket: row.bucket, lines: 0, bytes: 0 };
    current.lines += row.lines;
    current.bytes += row.bytes;
    target.timeline[row.bucket] = current;
  }
}

export function validateSessionPath(filePath, codexHome) {
  if (!filePath) throw new Error('session path is required');
  const paths = buildPaths(codexHome);
  const resolved = path.resolve(filePath);
  if (!resolved.endsWith('.jsonl')) throw new Error('session path must be a .jsonl file');
  if (!isSubpath(paths.sessionsDir, resolved)) throw new Error('session path must be inside Codex sessions directory');
  return { paths, resolved };
}

async function readWindow(filePath, start, length) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

function analyzeWindow(text, start, name) {
  const stats = createStats();
  const rawLines = text.split('\n');
  const lines = rawLines.slice(0, 400);
  let offset = start;
  for (const line of lines) {
    if (!line.trim()) {
      offset += Buffer.byteLength(line) + 1;
      continue;
    }
    observeLine(stats, line, offset, name);
    offset += Buffer.byteLength(line) + 1;
  }
  return finalizeStats(stats);
}

function buildWindows(size, windowBytes) {
  const starts = [0];
  if (size > windowBytes * 2) {
    starts.push(Math.max(0, Math.floor(size * 0.25) - Math.floor(windowBytes / 2)));
    starts.push(Math.max(0, Math.floor(size * 0.5) - Math.floor(windowBytes / 2)));
    starts.push(Math.max(0, Math.floor(size * 0.75) - Math.floor(windowBytes / 2)));
  }
  if (size > windowBytes) starts.push(Math.max(0, size - windowBytes));
  return [...new Set(starts)].sort((a, b) => a - b);
}

function inferCauses(result) {
  const causes = [];
  const topType = result.aggregate.typeCounts[0];
  const features = result.aggregate.featureCounts;
  if (result.file.size > 1024 * 1024 * 1024) causes.push('单个 session 文件超过 1GB，通常表示长期同一会话持续追加。');
  if (features.inputText > 0) causes.push('采样中发现 input_text，可能包含重复上下文、用户输入或大块文本。');
  if (features.base64LikeData > 0) causes.push('采样中发现疑似 base64/编码长文本，可能显著放大 session 文件。');
  if (features.imageLikeData > 0) causes.push('采样中发现图片相关字段，可能包含截图或图片引用。');
  if (features.tokenCounts > 0) causes.push('采样中发现 token_count 事件，可用于判断是否长期累计上下文。');
  if (topType) causes.push(`采样中最多的 JSONL type 是 ${topType.name}。`);
  if (causes.length === 0) causes.push('快速采样未发现明显异常，需要手动启动深度分析。');
  return causes;
}

export async function quickAnalyzeSession(filePath, options = {}) {
  const { resolved } = validateSessionPath(filePath, options.codexHome);
  const stat = await fsp.stat(resolved);
  const windowBytes = Number(options.windowBytes || 1024 * 1024);
  const starts = buildWindows(stat.size, windowBytes);
  const aggregate = createStats();
  const windows = [];
  let index = 0;
  for (const start of starts) {
    const length = Math.min(windowBytes, stat.size - start);
    const text = await readWindow(resolved, start, length);
    const name = index === 0 ? 'head' : start + length >= stat.size ? 'tail' : `sample-${index}`;
    const analyzed = analyzeWindow(text, start, name);
    windows.push({
      name,
      start,
      length,
      startHuman: bytesToHuman(start),
      lengthHuman: bytesToHuman(length),
      ...analyzed
    });
    mergeStats(aggregate, {
      ...analyzed,
      typeCounts: Object.fromEntries(analyzed.typeCounts.map((row) => [row.name, row.count])),
      payloadTypeCounts: Object.fromEntries(analyzed.payloadTypeCounts.map((row) => [row.name, row.count])),
      roleCounts: Object.fromEntries(analyzed.roleCounts.map((row) => [row.name, row.count])),
      timeline: Object.fromEntries(analyzed.timeline.map((row) => [row.bucket, row])),
      largeBlocks: analyzed.largeBlocks
    });
    index += 1;
  }
  const result = {
    mode: 'quick',
    file: {
      path: resolved,
      size: stat.size,
      sizeHuman: bytesToHuman(stat.size),
      mtime: stat.mtime.toISOString()
    },
    windows,
    aggregate: finalizeStats(aggregate)
  };
  result.inferredCauses = inferCauses(result);
  return result;
}

export async function deepAnalyzeSession(filePath, options = {}) {
  const { resolved } = validateSessionPath(filePath, options.codexHome);
  const stat = await fsp.stat(resolved);
  const stats = createStats();
  let processed = 0;
  let buffer = '';
  const stream = fs.createReadStream(resolved, { encoding: 'utf8', highWaterMark: 1024 * 1024 });
  if (options.signal) {
    options.signal.addEventListener('abort', () => stream.destroy(new Error('analysis cancelled')), { once: true });
  }
  try {
    for await (const chunk of stream) {
      processed += Buffer.byteLength(chunk);
      buffer += chunk;
      const parts = buffer.split('\n');
      buffer = parts.pop() || '';
      for (const line of parts) {
        if (line.trim()) observeLine(stats, line, Math.max(0, processed - Buffer.byteLength(buffer)), 'full');
      }
      options.onProgress?.({ processed, total: stat.size, percent: stat.size ? processed / stat.size : 1 });
      if (options.signal?.aborted) throw new Error('analysis cancelled');
    }
    if (buffer.trim()) observeLine(stats, buffer, processed - Buffer.byteLength(buffer), 'full');
  } catch (error) {
    if (options.signal?.aborted || error.message === 'analysis cancelled') throw new Error('analysis cancelled');
    throw error;
  }
  const result = {
    mode: 'deep',
    file: {
      path: resolved,
      size: stat.size,
      sizeHuman: bytesToHuman(stat.size),
      mtime: stat.mtime.toISOString()
    },
    aggregate: finalizeStats(stats)
  };
  result.inferredCauses = inferCauses(result);
  return result;
}

export function createJobId() {
  return crypto.randomBytes(8).toString('hex');
}
