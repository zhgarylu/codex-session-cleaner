import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deepAnalyzeSession, quickAnalyzeSession } from '../src/sessionAnalyzer.js';
import { scanSessions } from '../src/sessionScanner.js';

async function makeSessionFile(lines) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-analyzer-'));
  const sessionsDir = path.join(root, 'sessions', '2026', '01', '01');
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.mkdir(path.join(root, 'process_manager'), { recursive: true });
  const filePath = path.join(sessionsDir, 'rollout-2026-01-01T00-00-00-01900000-0000-7000-8000-000000000010.jsonl');
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  const date = new Date('2026-01-01T00:00:00.000Z');
  await fs.utimes(filePath, date, date);
  return { root, filePath };
}

test('quick analysis samples windows and counts JSONL types', async () => {
  const meta = JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', type: 'session_meta', payload: { id: '01900000-0000-7000-8000-000000000010', cwd: '/tmp/project' } });
  const response = JSON.stringify({ timestamp: '2026-01-01T01:00:00.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] } });
  const event = JSON.stringify({ timestamp: '2026-01-01T02:00:00.000Z', type: 'event_msg', payload: { type: 'token_count' } });
  const fx = await makeSessionFile([meta, response, event]);
  const result = await quickAnalyzeSession(fx.filePath, { codexHome: fx.root, windowBytes: 1024 });
  assert.equal(result.mode, 'quick');
  assert.ok(result.aggregate.typeCounts.some((row) => row.name === 'response_item'));
  assert.ok(result.aggregate.payloadTypeCounts.some((row) => row.name === 'message'));
  assert.equal(result.aggregate.featureCounts.tokenCounts, 1);
});

test('quick analysis reports long base64-like blocks without returning full content', async () => {
  const longText = 'A'.repeat(2 * 1024 * 1024);
  const line = JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', type: 'response_item', payload: { type: 'message', content: [{ type: 'input_text', text: longText }] } });
  const fx = await makeSessionFile([line]);
  const result = await quickAnalyzeSession(fx.filePath, { codexHome: fx.root, windowBytes: 1024 * 1024 });
  assert.ok(result.aggregate.largeBlocks.length >= 1);
  assert.ok(result.aggregate.largeBlocks[0].snippet.length <= 220);
});

test('deep analysis streams full file and returns aggregate counts', async () => {
  const lines = Array.from({ length: 20 }, (_, index) => JSON.stringify({ timestamp: `2026-01-01T${String(index % 10).padStart(2, '0')}:00:00.000Z`, type: index % 2 ? 'event_msg' : 'response_item', payload: { type: index % 2 ? 'token_count' : 'message' } }));
  const fx = await makeSessionFile(lines);
  const result = await deepAnalyzeSession(fx.filePath, { codexHome: fx.root });
  assert.equal(result.mode, 'deep');
  assert.equal(result.aggregate.lines, 20);
  assert.ok(result.aggregate.typeCounts.some((row) => row.name === 'event_msg'));
});

test('project sessions can be filtered and sorted by size from scan results', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-project-detail-'));
  const sessionsDir = path.join(root, 'sessions', '2026', '01', '01');
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.mkdir(path.join(root, 'process_manager'), { recursive: true });
  const cwd = path.join(root, 'project');
  await fs.mkdir(cwd, { recursive: true });
  const ids = ['01900000-0000-7000-8000-000000000011', '01900000-0000-7000-8000-000000000012'];
  for (const [index, id] of ids.entries()) {
    const filePath = path.join(sessionsDir, `rollout-2026-01-01T00-00-0${index}-${id}.jsonl`);
    const meta = JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', type: 'session_meta', payload: { id, cwd } });
    await fs.writeFile(filePath, `${meta}\n${'x'.repeat(index ? 2000 : 20)}\n`, 'utf8');
    const date = new Date('2026-01-01T00:00:00.000Z');
    await fs.utimes(filePath, date, date);
  }
  const scan = await scanSessions({ codexHome: root, now: new Date('2026-07-11T00:00:00.000Z'), activeFiles: [] });
  const sessions = scan.sessions.filter((session) => session.cwd === cwd).sort((a, b) => b.size - a.size);
  assert.equal(sessions.length, 2);
  assert.ok(sessions[0].size > sessions[1].size);
});
