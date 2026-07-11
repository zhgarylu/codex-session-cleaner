import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveSessions, deleteArchivedSessions, loadManifest, restoreSession } from './archiveManager.js';
import { importBackupFile, listBackupRecordsForSession, reconcileBackupRecords, registerExternalBackup, restoreBackupRecord } from './sessionBackupRecords.js';
import { compactCopy, compactPreview, getCompactState, replaceWithCompact, restoreBackup } from './sessionCompactor.js';
import { createJobId, deepAnalyzeSession, quickAnalyzeSession } from './sessionAnalyzer.js';
import { getSessionLocks, releaseSessionLock } from './sessionLocks.js';
import { scanSessions } from './sessionScanner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
const port = Number(process.env.PORT || 7345);
const deepJobs = new Map();

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function sendStatic(res, urlPath) {
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  const fullPath = path.normalize(path.join(publicDir, requested));
  if (!fullPath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const ext = path.extname(fullPath);
  const type = ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'text/html';
  try {
    const body = await fs.readFile(fullPath);
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/api/scan') {
      const scan = await scanSessions({
        codexHome: url.searchParams.get('codexHome') || undefined,
        retentionDays: Number(url.searchParams.get('retentionDays') || 90),
        archiveRetentionDays: Number(url.searchParams.get('archiveRetentionDays') || 180)
      });
      sendJson(res, 200, scan);
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/projects/') && url.pathname.endsWith('/sessions')) {
      const encoded = url.pathname.slice('/api/projects/'.length, -'/sessions'.length);
      const cwd = decodeURIComponent(encoded);
      const scan = await scanSessions({
        codexHome: url.searchParams.get('codexHome') || undefined,
        retentionDays: Number(url.searchParams.get('retentionDays') || 90),
        archiveRetentionDays: Number(url.searchParams.get('archiveRetentionDays') || 180)
      });
      const sessions = scan.sessions
        .filter((session) => (session.cwd || '(unknown project)') === cwd)
        .sort((a, b) => b.size - a.size);
      const totalBytes = sessions.reduce((sum, session) => sum + session.size, 0);
      sendJson(res, 200, {
        cwd,
        totalBytes,
        totalBytesHuman: scan.summary.byProject.find((row) => row.cwd === cwd)?.bytesHuman || '0 B',
        largeThresholdBytes: 100 * 1024 * 1024,
        sessions
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/session/detail') {
      const sessionPath = url.searchParams.get('path');
      sendJson(res, 200, await quickAnalyzeSession(sessionPath, {
        codexHome: url.searchParams.get('codexHome') || undefined
      }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/session/locks') {
      const sessionPath = url.searchParams.get('path');
      sendJson(res, 200, await getSessionLocks(sessionPath, {
        codexHome: url.searchParams.get('codexHome') || undefined
      }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/session/release-lock') {
      const body = await readJson(req);
      sendJson(res, 200, await releaseSessionLock({
        path: body.path,
        pid: body.pid,
        signal: body.signal || 'TERM',
        confirm: body.confirm,
        codexHome: body.codexHome
      }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/session/deep-analyze') {
      const body = await readJson(req);
      const jobId = createJobId();
      const controller = new AbortController();
      const job = {
        jobId,
        status: 'running',
        sessionPath: body.path,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        progress: { processed: 0, total: 0, percent: 0 },
        result: null,
        error: null,
        controller
      };
      deepJobs.set(jobId, job);
      deepAnalyzeSession(body.path, {
        codexHome: body.codexHome,
        signal: controller.signal,
        onProgress: (progress) => {
          job.progress = {
            processed: progress.processed,
            total: progress.total,
            percent: Number((progress.percent * 100).toFixed(2))
          };
          job.updatedAt = new Date().toISOString();
        }
      }).then((result) => {
        job.status = 'done';
        job.result = result;
        job.progress = { processed: result.file.size, total: result.file.size, percent: 100 };
        job.updatedAt = new Date().toISOString();
      }).catch((error) => {
        job.status = controller.signal.aborted ? 'cancelled' : 'error';
        job.error = error.message;
        job.updatedAt = new Date().toISOString();
      });
      sendJson(res, 202, { jobId, status: job.status });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/session/deep-analyze/')) {
      const jobId = url.pathname.slice('/api/session/deep-analyze/'.length).split('/')[0];
      const job = deepJobs.get(jobId);
      if (!job) {
        sendJson(res, 404, { error: 'job not found' });
        return;
      }
      const { controller, ...safeJob } = job;
      sendJson(res, 200, safeJob);
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/session/deep-analyze/') && url.pathname.endsWith('/cancel')) {
      const jobId = url.pathname.slice('/api/session/deep-analyze/'.length, -'/cancel'.length);
      const job = deepJobs.get(jobId);
      if (!job) {
        sendJson(res, 404, { error: 'job not found' });
        return;
      }
      if (job.status === 'running') job.controller.abort();
      sendJson(res, 200, { jobId, status: job.status === 'running' ? 'cancelling' : job.status });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/archives') {
      sendJson(res, 200, { entries: await loadManifest(url.searchParams.get('codexHome') || undefined) });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/archive') {
      const body = await readJson(req);
      if (body.confirm !== 'ARCHIVE') {
        sendJson(res, 400, { error: 'confirmation string must be ARCHIVE' });
        return;
      }
      sendJson(res, 200, await archiveSessions({
        codexHome: body.codexHome,
        retentionDays: Number(body.retentionDays || 90),
        apply: true,
        sessionIds: Array.isArray(body.sessionIds) ? body.sessionIds : []
      }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/restore') {
      const body = await readJson(req);
      sendJson(res, 200, await restoreSession({ codexHome: body.codexHome, sessionId: body.sessionId, archivePath: body.archivePath }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/delete-archives') {
      const body = await readJson(req);
      if (body.confirm !== 'DELETE ARCHIVES') {
        sendJson(res, 400, { error: 'confirmation string must be DELETE ARCHIVES' });
        return;
      }
      sendJson(res, 200, await deleteArchivedSessions({
        codexHome: body.codexHome,
        archiveRetentionDays: Number(body.archiveRetentionDays || 180),
        apply: true,
        archivePaths: Array.isArray(body.archivePaths) ? body.archivePaths : []
      }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/session/compact-preview') {
      const body = await readJson(req);
      sendJson(res, 200, await compactPreview({
        path: body.path,
        codexHome: body.codexHome,
        maxParseLineBytes: body.maxParseLineBytes,
        largeFieldBytes: body.largeFieldBytes
      }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/session/compact-state') {
      const sessionPath = url.searchParams.get('path');
      sendJson(res, 200, await getCompactState({
        path: sessionPath,
        codexHome: url.searchParams.get('codexHome') || undefined
      }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/session/backup-records') {
      const sessionPath = url.searchParams.get('path');
      sendJson(res, 200, await listBackupRecordsForSession({
        path: sessionPath,
        codexHome: url.searchParams.get('codexHome') || undefined
      }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/session/backup-records/reconcile') {
      const body = await readJson(req);
      sendJson(res, 200, await reconcileBackupRecords({ codexHome: body.codexHome }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/session/backup-records/register-external') {
      const body = await readJson(req);
      sendJson(res, 200, await registerExternalBackup({
        path: body.path,
        externalPath: body.externalPath,
        codexHome: body.codexHome
      }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/session/backup-records/import') {
      const body = await readJson(req);
      sendJson(res, 200, await importBackupFile({
        path: body.path,
        sourcePath: body.sourcePath,
        externalPath: body.externalPath,
        codexHome: body.codexHome
      }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/session/compact-copy') {
      const body = await readJson(req);
      sendJson(res, 200, await compactCopy({
        path: body.path,
        codexHome: body.codexHome,
        maxParseLineBytes: body.maxParseLineBytes,
        largeFieldBytes: body.largeFieldBytes
      }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/session/replace-with-compact') {
      const body = await readJson(req);
      sendJson(res, 200, await replaceWithCompact({
        path: body.path,
        compactedPath: body.compactedPath,
        codexHome: body.codexHome,
        confirm: body.confirm
      }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/session/restore-backup') {
      const body = await readJson(req);
      sendJson(res, 200, await restoreBackup({
        path: body.path,
        backupPath: body.backupPath,
        codexHome: body.codexHome,
        confirm: body.confirm
      }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/session/restore-backup-record') {
      const body = await readJson(req);
      sendJson(res, 200, await restoreBackupRecord({
        recordId: body.recordId,
        codexHome: body.codexHome,
        confirm: body.confirm,
        activeFiles: body.activeFiles
      }));
      return;
    }
    if (req.method === 'GET') {
      await sendStatic(res, url.pathname);
      return;
    }
    sendJson(res, 405, { error: 'method not allowed' });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Codex Session Cleaner running at http://127.0.0.1:${port}`);
});
