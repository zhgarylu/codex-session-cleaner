import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { appendBackupRecord, importBackupFile, listBackupRecordsForSession, reconcileBackupRecords, registerExternalBackup, restoreBackupRecord } from '../src/sessionBackupRecords.js';

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-backup-records-'));
  const sessionDir = path.join(root, 'sessions', '2026', '01', '01');
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.mkdir(path.join(root, 'process_manager'), { recursive: true });
  const filePath = path.join(sessionDir, 'rollout-2026-01-01T00-00-00-01900000-0000-7000-8000-000000000030.jsonl');
  const original = [JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', type: 'session_meta', payload: { id: '01900000-0000-7000-8000-000000000030', cwd: '/tmp/project' } }), JSON.stringify({ timestamp: '2026-01-01T00:01:00.000Z', type: 'response_item', payload: { type: 'message', content: 'original' } })].join('\n') + '\n';
  await fs.writeFile(filePath, original, 'utf8');
  return { root, filePath, original };
}

test('append backup record dedupes by record id and lists for session', async () => {
  const fx = await makeFixture();
  const backupPath = path.join(fx.root, 'session_backups', '2026', '01', '01', path.basename(fx.filePath));
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.copyFile(fx.filePath, backupPath);
  const first = await appendBackupRecord({ codexHome: fx.root, originalPath: fx.filePath, backupPath });
  const second = await appendBackupRecord({ codexHome: fx.root, originalPath: fx.filePath, backupPath });
  assert.equal(first.appended, true);
  assert.equal(second.appended, false);
  const listed = await listBackupRecordsForSession({ codexHome: fx.root, path: fx.filePath });
  assert.equal(listed.records.length, 1);
  assert.equal(listed.records[0].file.exists, true);
  assert.equal(listed.records[0].source, 'local_backup');
});

test('reconcile scans backup tree and ignores non-jsonl files', async () => {
  const fx = await makeFixture();
  const backupPath = path.join(fx.root, 'session_backups', '2026', '01', '01', path.basename(fx.filePath));
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.copyFile(fx.filePath, backupPath);
  await fs.writeFile(path.join(fx.root, 'session_backups', '.DS_Store'), 'ignore', 'utf8');
  await fs.writeFile(path.join(fx.root, 'session_backups', 'note.txt'), 'ignore', 'utf8');
  const result = await reconcileBackupRecords({ codexHome: fx.root });
  assert.equal(result.scannedFiles, 1);
  assert.equal(result.appended, 1);
  assert.equal(result.records[0].originalPath, fx.filePath);
});

test('external register and import create restorable records', async () => {
  const fx = await makeFixture();
  const externalPath = path.join(fx.root, 'external-copy.jsonl');
  await fs.copyFile(fx.filePath, externalPath);
  await fs.writeFile(fx.filePath, 'compacted\n', 'utf8');
  const external = await registerExternalBackup({ codexHome: fx.root, path: fx.filePath, externalPath });
  assert.equal(external.appended, true);
  assert.equal(external.record.source, 'external_backup');
  const imported = await importBackupFile({ codexHome: fx.root, path: fx.filePath, sourcePath: externalPath });
  assert.equal(imported.appended, true);
  assert.equal(imported.record.source, 'imported_backup');
  assert.match(imported.record.backupPath, /session_backups/);
  await assert.rejects(restoreBackupRecord({ codexHome: fx.root, recordId: imported.record.recordId, confirm: 'RESTORE BACKUP RECORD', activeFiles: [fx.filePath] }), /active session/);
  const restored = await restoreBackupRecord({ codexHome: fx.root, recordId: imported.record.recordId, confirm: 'RESTORE BACKUP RECORD', activeFiles: [] });
  assert.equal(restored.restoredPath, fx.filePath);
  assert.equal(await fs.readFile(fx.filePath, 'utf8'), fx.original);
  assert.equal(await fs.readFile(imported.record.backupPath, 'utf8'), fx.original);
});

test('register external rejects missing path', async () => {
  const fx = await makeFixture();
  await assert.rejects(registerExternalBackup({ codexHome: fx.root, path: fx.filePath, externalPath: path.join(fx.root, 'missing.jsonl') }), /not found/);
});
