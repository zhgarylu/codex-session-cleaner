import fs from 'node:fs/promises';
import path from 'node:path';

export function bytesToHuman(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function parseJsonLine(line) {
  if (!line || !line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export async function readFirstLine(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const chunks = [];
    const buffer = Buffer.alloc(8192);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const slice = buffer.subarray(0, bytesRead);
      const newline = slice.indexOf(10);
      if (newline >= 0) {
        chunks.push(slice.subarray(0, newline));
        break;
      }
      chunks.push(slice);
      position += bytesRead;
      if (position > 1024 * 1024) break;
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await handle.close();
  }
}

export async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export function isSubpath(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export function parseDurationDays(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number') return value;
  const match = String(value).trim().match(/^(\d+)(?:d|day|days)?$/i);
  return match ? Number(match[1]) : fallback;
}

export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function monthKeyFromPath(filePath) {
  const parts = filePath.split(path.sep);
  for (let i = 0; i < parts.length - 2; i += 1) {
    if (/^\d{4}$/.test(parts[i]) && /^\d{2}$/.test(parts[i + 1]) && /^\d{2}$/.test(parts[i + 2])) {
      return `${parts[i]}-${parts[i + 1]}`;
    }
  }
  return 'unknown';
}

export function dayKeyFromPath(filePath) {
  const parts = filePath.split(path.sep);
  for (let i = 0; i < parts.length - 2; i += 1) {
    if (/^\d{4}$/.test(parts[i]) && /^\d{2}$/.test(parts[i + 1]) && /^\d{2}$/.test(parts[i + 2])) {
      return `${parts[i]}-${parts[i + 1]}-${parts[i + 2]}`;
    }
  }
  return null;
}
