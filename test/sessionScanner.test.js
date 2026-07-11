import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { archiveSessions, restoreSession } from '../src/archiveManager.js';
import { scanSessions } from '../src/sessionScanner.js';

async function makeCodexFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-cleaner-'));
  const sessions = path.join(root, 'sessions', '2026', '01', '01');
  await fs.mkdir(sessions, { recursive: true });
  await fs.mkdir(path.join(root, 'process_manager'), { recursive: true });
  const project = path.join(root, 'project');
  await fs.mkdir(project, { recursive: true });
  return { root, sessions, project };
}

async function writeSession(dir, id, cwd, timestamp = '2026-01-01T00:00:00.000Z') {
  const filePath = path.join(dir, `rollout-2026-01-01T00-00-00-${id}.jsonl`);
  const line = {
    timestamp,
    type: 'session_meta',
    payload: {
      id,
      timestamp,
      cwd,
      originator: 'test'
    }
  };
  await fs.writeFile(filePath, `${JSON.stringify(line)}\n{"type":"event"}\n`, 'utf8');
  const date = new Date(timestamp);
  await fs.utimes(filePath, date, date);
  return filePath;
}

test('scan classifies old inactive sessions as archive candidates', async () => {
  const fx = await makeCodexFixture();
  const id = '01900000-0000-7000-8000-000000000001';
  await writeSession(fx.sessions, id, fx.project);
  await fs.writeFile(path.join(fx.root, 'session_index.jsonl'), `${JSON.stringify({ id, thread_name: 'old work', updated_at: '2026-01-01T00:00:00.000Z' })}\n`);
  const scan = await scanSessions({ codexHome: fx.root, now: new Date('2026-07-11T00:00:00.000Z'), activeFiles: [] });
  assert.equal(scan.sessions.length, 1);
  assert.equal(scan.sessions[0].recommendation, 'archive_candidate');
  assert.equal(scan.sessions[0].cwd, fx.project);
});

test('scan protects active session files', async () => {
  const fx = await makeCodexFixture();
  const id = '01900000-0000-7000-8000-000000000002';
  const filePath = await writeSession(fx.sessions, id, fx.project);
  const scan = await scanSessions({ codexHome: fx.root, now: new Date('2026-07-11T00:00:00.000Z'), activeFiles: [filePath] });
  assert.equal(scan.sessions[0].recommendation, 'protect');
  assert.equal(scan.sessions[0].active, true);
});

test('scan sends missing metadata to manual review', async () => {
  const fx = await makeCodexFixture();
  const filePath = path.join(fx.sessions, 'rollout-2026-01-01T00-00-00-01900000-0000-7000-8000-000000000003.jsonl');
  await fs.writeFile(filePath, '{"type":"session_meta","payload":{}}\n', 'utf8');
  const date = new Date('2026-01-01T00:00:00.000Z');
  await fs.utimes(filePath, date, date);
  const scan = await scanSessions({ codexHome: fx.root, now: new Date('2026-07-11T00:00:00.000Z'), activeFiles: [] });
  assert.equal(scan.sessions[0].recommendation, 'manual_review');
});

test('archive and restore round trip through gzip manifest', async () => {
  const fx = await makeCodexFixture();
  const id = '01900000-0000-7000-8000-000000000004';
  const filePath = await writeSession(fx.sessions, id, fx.project);
  const archive = await archiveSessions({ codexHome: fx.root, now: new Date('2026-07-11T00:00:00.000Z'), activeFiles: [], apply: true });
  assert.equal(archive.results[0].status, 'archived');
  await assert.rejects(fs.access(filePath));
  const restored = await restoreSession({ codexHome: fx.root, sessionId: id });
  assert.equal(restored.restoredPath, filePath);
  await fs.access(filePath);
});
