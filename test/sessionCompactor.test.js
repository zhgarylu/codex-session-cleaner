import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compactCopy, compactPreview, getCompactState, replaceWithCompact, restoreBackup } from '../src/sessionCompactor.js';

async function makeFixture(lines) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-compactor-'));
  const sessionsDir = path.join(root, 'sessions', '2026', '01', '01');
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.mkdir(path.join(root, 'process_manager'), { recursive: true });
  const filePath = path.join(sessionsDir, 'rollout-2026-01-01T00-00-00-01900000-0000-7000-8000-000000000020.jsonl');
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  return { root, filePath };
}

test('compact preview detects large fields without writing output', async () => {
  const lines = [
    JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', type: 'session_meta', payload: { id: '01900000-0000-7000-8000-000000000020', cwd: '/tmp/project', base_instructions: { text: 'x'.repeat(400000) } } }),
    JSON.stringify({ timestamp: '2026-01-01T00:01:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'A'.repeat(400000) }] } }),
    '{not-json'
  ];
  const fx = await makeFixture(lines);
  const result = await compactPreview({ path: fx.filePath, codexHome: fx.root, largeFieldBytes: 1024 });
  assert.equal(result.replacements, 1);
  assert.equal(result.unparsedLines, 1);
  assert.ok(result.originalBytesRemoved > 300000);
});

test('compact copy writes valid JSONL and preserves session_meta', async () => {
  const meta = { timestamp: '2026-01-01T00:00:00.000Z', type: 'session_meta', payload: { id: '01900000-0000-7000-8000-000000000020', cwd: '/tmp/project', base_instructions: { text: 'x'.repeat(400000) } } };
  const lines = [JSON.stringify(meta), JSON.stringify({ timestamp: '2026-01-01T00:01:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'A'.repeat(400000) }] } })];
  const fx = await makeFixture(lines);
  const result = await compactCopy({ path: fx.filePath, codexHome: fx.root, largeFieldBytes: 1024 });
  const output = await fs.readFile(result.outputPath, 'utf8');
  const parsed = output.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(parsed[0].payload.base_instructions.text.length, 400000);
  assert.match(parsed[1].payload.content[0].text, /^\[removed large field:/);
});

test('oversized line is replaced by a valid placeholder line', async () => {
  const huge = JSON.stringify({ timestamp: '2026-01-01T00:01:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'B'.repeat(200000) }] } });
  const fx = await makeFixture([huge]);
  const result = await compactCopy({ path: fx.filePath, codexHome: fx.root, maxParseLineBytes: 4096 });
  const output = await fs.readFile(result.outputPath, 'utf8');
  const parsed = JSON.parse(output.trim());
  assert.equal(parsed.payload.type, 'compacted_large_line');
  assert.ok(result.largeLines.length >= 1);
});

test('replace refuses active files and restore backup returns original content', async () => {
  const lines = [JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', type: 'response_item', payload: { type: 'message', content: [{ type: 'input_text', text: 'C'.repeat(10000) }] } })];
  const fx = await makeFixture(lines);
  await compactCopy({ path: fx.filePath, codexHome: fx.root, largeFieldBytes: 1024 });
  await assert.rejects(replaceWithCompact({ path: fx.filePath, codexHome: fx.root, confirm: 'REPLACE WITH COMPACT', activeFiles: [fx.filePath] }), /active session/);
  const original = await fs.readFile(fx.filePath, 'utf8');
  const replaced = await replaceWithCompact({ path: fx.filePath, codexHome: fx.root, confirm: 'REPLACE WITH COMPACT', activeFiles: [] });
  assert.ok(replaced.backupPath);
  assert.notEqual(await fs.readFile(fx.filePath, 'utf8'), original);
  await restoreBackup({ path: fx.filePath, codexHome: fx.root, confirm: 'RESTORE BACKUP', activeFiles: [] });
  assert.equal(await fs.readFile(fx.filePath, 'utf8'), original);
});

test('compact state reports expected compacted and backup paths', async () => {
  const fx = await makeFixture([JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', type: 'response_item', payload: { type: 'message', content: [{ type: 'input_text', text: 'D'.repeat(10000) }] } })]);
  let state = await getCompactState({ path: fx.filePath, codexHome: fx.root });
  assert.equal(state.compactedExists, false);
  assert.equal(state.backupExists, false);
  await compactCopy({ path: fx.filePath, codexHome: fx.root, largeFieldBytes: 1024 });
  state = await getCompactState({ path: fx.filePath, codexHome: fx.root });
  assert.equal(state.compactedExists, true);
  assert.match(state.compactedPath, /session_compacted/);
  assert.match(state.backupPath, /session_backups/);
});
