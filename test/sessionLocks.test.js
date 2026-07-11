import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getSessionLocks, parseLsofOutput, releaseSessionLock } from '../src/sessionLocks.js';

async function makeSession() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-locks-'));
  const dir = path.join(root, 'sessions', '2026', '01', '01');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, 'rollout-2026-01-01T00-00-00-01900000-0000-7000-8000-000000000030.jsonl');
  await fs.writeFile(filePath, '{}\n', 'utf8');
  return { root, filePath };
}

function lsofLine(command, pid, fd, filePath) {
  return `${command} ${pid} gary ${fd} REG 1,17 123 456 ${filePath}`;
}

test('parseLsofOutput extracts fd mode and target path', () => {
  const target = '/tmp/session.jsonl';
  const output = [
    'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME',
    lsofLine('codex', 34977, '30w', target),
    lsofLine('codex', 34977, '35r', target),
    lsofLine('node', 100, '12u', '/tmp/other.jsonl')
  ].join('\n');
  const locks = parseLsofOutput(output, target);
  assert.equal(locks.length, 2);
  assert.equal(locks[0].mode, 'write');
  assert.equal(locks[0].writable, true);
  assert.equal(locks[1].mode, 'read');
});

test('getSessionLocks supports mocked lsof output', async () => {
  const fx = await makeSession();
  const output = `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n${lsofLine('codex', 34977, '30w', fx.filePath)}\n`;
  const result = await getSessionLocks(fx.filePath, { codexHome: fx.root, lsofOutput: output });
  assert.equal(result.locks.length, 1);
  assert.equal(result.locks[0].pid, 34977);
});

test('releaseSessionLock rejects wrong confirmation', async () => {
  const fx = await makeSession();
  const output = `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n${lsofLine('codex', 34977, '30w', fx.filePath)}\n`;
  await assert.rejects(
    releaseSessionLock({ path: fx.filePath, codexHome: fx.root, pid: 34977, confirm: 'NOPE', lsofOutput: output, dryRun: true }),
    /confirmation/
  );
});

test('releaseSessionLock rejects non-codex processes', async () => {
  const fx = await makeSession();
  const output = `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n${lsofLine('node', 34977, '30w', fx.filePath)}\n`;
  await assert.rejects(
    releaseSessionLock({ path: fx.filePath, codexHome: fx.root, pid: 34977, confirm: 'TERMINATE CODEX PROCESS', lsofOutput: output, dryRun: true }),
    /non-codex/
  );
});

test('releaseSessionLock rejects pid no longer holding target file', async () => {
  const fx = await makeSession();
  const output = `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n${lsofLine('codex', 111, '30w', fx.filePath)}\n`;
  await assert.rejects(
    releaseSessionLock({ path: fx.filePath, codexHome: fx.root, pid: 34977, confirm: 'TERMINATE CODEX PROCESS', lsofOutput: output, dryRun: true }),
    /no longer holds/
  );
});

test('releaseSessionLock dryRun accepts codex process holding target file', async () => {
  const fx = await makeSession();
  const output = `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n${lsofLine('codex', 34977, '30w', fx.filePath)}\n`;
  const result = await releaseSessionLock({ path: fx.filePath, codexHome: fx.root, pid: 34977, confirm: 'TERMINATE CODEX PROCESS', lsofOutput: output, dryRun: true });
  assert.equal(result.status, 'dry-run');
  assert.equal(result.locks.length, 1);
});
