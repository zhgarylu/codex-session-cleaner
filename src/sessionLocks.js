import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { validateSessionPath } from './sessionAnalyzer.js';

const execFileAsync = promisify(execFile);

export function parseLsofOutput(output, targetPath) {
  const rows = [];
  const lines = String(output || '').split(/\r?\n/).filter(Boolean);
  const header = lines[0] || '';
  const hasHeader = /\bCOMMAND\b/.test(header) && /\bPID\b/.test(header) && /\bFD\b/.test(header);
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const resolvedTarget = targetPath ? path.resolve(targetPath) : null;

  for (const line of dataLines) {
    const match = line.match(/^(\S+)\s+(\d+)\s+\S+\s+(\S+)\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/);
    if (!match) continue;
    const [, command, pidText, fd, name] = match;
    const filePath = path.resolve(name);
    if (resolvedTarget && filePath !== resolvedTarget) continue;
    const mode = fd.endsWith('w') ? 'write' : fd.endsWith('r') ? 'read' : fd.endsWith('u') ? 'read-write' : 'unknown';
    rows.push({
      command,
      pid: Number(pidText),
      fd,
      mode,
      writable: mode === 'write' || mode === 'read-write',
      path: filePath
    });
  }
  return rows;
}

export async function getSessionLocks(sessionPath, options = {}) {
  const { resolved } = validateSessionPath(sessionPath, options.codexHome);
  if (options.lsofOutput !== undefined) {
    return {
      path: resolved,
      locks: parseLsofOutput(options.lsofOutput, resolved)
    };
  }
  try {
    const { stdout } = await execFileAsync('lsof', [resolved], { maxBuffer: 10 * 1024 * 1024 });
    return {
      path: resolved,
      locks: parseLsofOutput(stdout, resolved)
    };
  } catch (error) {
    const stdout = error.stdout || '';
    return {
      path: resolved,
      locks: parseLsofOutput(stdout, resolved)
    };
  }
}

export async function releaseSessionLock(options = {}) {
  const pid = Number(options.pid);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('valid pid is required');
  const signal = options.signal || 'TERM';
  if (!['TERM', 'KILL'].includes(signal)) throw new Error('signal must be TERM or KILL');
  const expectedConfirm = signal === 'KILL' ? 'KILL CODEX PROCESS' : 'TERMINATE CODEX PROCESS';
  if (options.confirm !== expectedConfirm) throw new Error(`confirmation string must be ${expectedConfirm}`);

  const locks = await getSessionLocks(options.path, options);
  const pidLocks = locks.locks.filter((lock) => lock.pid === pid);
  if (pidLocks.length === 0) throw new Error('pid no longer holds this session file');
  if (!pidLocks.every((lock) => lock.command === 'codex')) throw new Error('refusing to release non-codex process');

  if (options.dryRun) {
    return { pid, signal, status: 'dry-run', locks: pidLocks };
  }

  process.kill(pid, signal);
  return { pid, signal, status: 'signal-sent', locks: pidLocks };
}
