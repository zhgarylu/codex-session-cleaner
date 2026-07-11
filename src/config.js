import os from 'node:os';
import path from 'node:path';

export const DEFAULT_RETENTION_DAYS = 90;
export const DEFAULT_ARCHIVE_RETENTION_DAYS = 180;

export function resolveCodexHome(input) {
  return path.resolve(input || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
}

export function buildPaths(codexHomeInput) {
  const codexHome = resolveCodexHome(codexHomeInput);
  return {
    codexHome,
    sessionsDir: path.join(codexHome, 'sessions'),
    archivedSessionsDir: path.join(codexHome, 'archived_sessions'),
    sessionCompactedDir: path.join(codexHome, 'session_compacted'),
    sessionBackupsDir: path.join(codexHome, 'session_backups'),
    sessionIndexPath: path.join(codexHome, 'session_index.jsonl'),
    processManagerPath: path.join(codexHome, 'process_manager', 'chat_processes.json')
  };
}
