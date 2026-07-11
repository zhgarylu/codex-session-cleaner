# Codex Session Cleaner

Local-only visual inspector, archiver, and safe compactor for Codex session files.

Codex sessions are stored as JSONL files under `$CODEX_HOME/sessions` (by default `~/.codex/sessions`). Long-running tasks can make individual session files grow to hundreds of MB or several GB. This project gives you a browser UI to understand where the space went, identify oversized sessions, archive old inactive sessions, and create compacted copies that remove large base64/tool-output blocks while preserving session metadata.

The tool is designed for safety first:

- Local only: the server binds to `127.0.0.1`.
- No telemetry.
- No automatic scan on page load.
- No automatic cleanup.
- Dangerous actions require explicit confirmation.
- Active Codex session files are protected with `lsof` checks.

## Contents

- [Screenshots](#screenshots)
- [Features](#features)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Safety Model](#safety-model)
- [Session Analysis](#session-analysis)
- [Session Compaction](#session-compaction)
- [Backup Records](#backup-records)
- [Archiving](#archiving)
- [CLI](#cli)
- [Configuration](#configuration)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [License](#license)

## Screenshots

Add screenshots before a public release:

- Welcome screen before manual scan
- Workspace summary after scan
- Session detail with `分析 / 瘦身 / 备份 / 占用` tabs

## Features

- Manual scan: opening the page does not read real session files until you click `开始扫描 sessions`.
- Visual summary: total size, file count, archive candidates, expired archives, manual-review count.
- Project view: group sessions by `cwd`, show project size, session count, and missing project paths.
- Month view: show disk usage by month.
- Session table: filter by project, month, status, and free-text search.
- Large session analysis: sample head/middle/tail windows without rendering full JSONL.
- Deep analysis: stream the full file only when manually triggered.
- Safe compaction: generate a compacted copy before replacing the original file.
- Backup records: list local backups, external disk paths, and imported backups.
- Lock detection: show Codex processes that still hold a session file open.
- Two-stage cleanup: archive first, delete compressed archives only after a longer retention period.

## Quick Start

Requirements:

- Node.js 20 or newer
- macOS or a system with `lsof`
- Codex session files under `$CODEX_HOME/sessions`

Run the local UI:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:7345
```

The page starts in a non-scanned state. Click `开始扫描 sessions` to scan `$CODEX_HOME/sessions`.

Run a CLI scan:

```bash
npm run scan
```

Print full session details:

```bash
node src/cli.js scan --full
```

Run tests:

```bash
npm test
```

## How It Works

The server is a small native Node.js HTTP service. The browser UI talks to local JSON APIs exposed by `src/server.js`.

Main data sources:

- `$CODEX_HOME/sessions/**/*.jsonl`: raw Codex session files.
- `$CODEX_HOME/session_index.jsonl`: titles and recent session metadata when available.
- `$CODEX_HOME/process_manager/chat_processes.json`: process metadata used as one protection signal.
- `lsof`: active file-handle detection.

The UI is intentionally read-first. Scanning builds an in-memory report. Cleanup actions run separate server-side validation before touching files.

## Safety Model

The tool follows these rules:

- Never scan until you explicitly click the scan button.
- Never process files outside `$CODEX_HOME/sessions` as original sessions.
- Never modify `auth.json`, `config.toml`, SQLite files, plugins, skills, cache, or state files.
- Never replace or restore over a session that is currently opened by Codex.
- Never delete original session files by default.
- Delete actions only apply to already archived compressed files that exceed the archive retention period.
- Restore actions move the current file aside before restoring.
- External backup files are never deleted or moved.

Default retention:

- Original sessions are protected for 90 days.
- Archived compressed files are eligible for deletion after 180 days.

## Session Analysis

Session details support two analysis modes.

### Quick Analysis

Quick analysis is the default. It reads only small windows from the beginning, middle, and end of the file. This is suitable for very large session files because it avoids loading the full JSONL into memory or the browser.

It reports:

- JSONL `type` counts
- payload type counts
- role counts
- likely `input_text` growth
- base64-like data
- image-like data
- tool/function call output signals
- token count events
- oversized lines
- timeline samples

### Deep Analysis

Deep analysis is manual. It streams the full file and updates a background job. Use it only when you need full-file statistics and can wait for a large file to be read.

Deep analysis is still read-only.

## Session Compaction

Compaction is intended for oversized sessions that contain huge fields such as base64, image-like payloads, command output, or repeated context blocks.

The flow is:

1. `瘦身预览`: read the file and estimate removable size.
2. `生成瘦身副本`: write a compacted JSONL copy under `$CODEX_HOME/session_compacted`.
3. `替换原文件`: only after confirmation and active-file checks, move the original to `$CODEX_HOME/session_backups`, then move the compacted copy into the original path.
4. `恢复备份`: restore from a backup record if needed.

Compaction preserves:

- `session_meta`
- session id
- timestamps
- `cwd`
- event type and role metadata
- normal short text
- function call metadata
- token summaries

Compaction replaces large risky fields with placeholders such as:

```text
[removed large field: 1.2 GB, sha256=..., reason=base64-like, removed_at=...]
```

Important: compacting does not preserve the full removed content in the compacted session file. Keep the backup if you may need the original content later.

## Backup Records

Backup records are stored in:

```text
$CODEX_HOME/session_backups/backup_records.jsonl
```

The UI can:

- Reconcile historical local backups.
- Register a backup file that you copied to a USB drive or external data disk.
- Import a backup from a specified path into `$CODEX_HOME/session_backups/imported`.
- Restore a session from a specific backup record.

Backup record fields include:

- original path
- backup path or external path
- session id
- title
- `cwd`
- size
- sha256
- creation time
- source
- availability status

External backup files are never deleted by the tool.

## Archiving

Archiving is separate from compaction.

Archive candidates are old inactive sessions that do not show protection signals. When archived, the original JSONL is moved and gzip-compressed under:

```text
$CODEX_HOME/archived_sessions
```

Each archive operation writes a manifest entry containing the original path, archive path, session id, title, `cwd`, size, sha256, archive time, and original mtime.

Expired archive deletion only applies to compressed archive files, not original live session files.

## CLI

Generate a summary:

```bash
npm run scan
```

Generate full scan output:

```bash
node src/cli.js scan --full
```

Restore archived sessions from the archive manifest:

```bash
node src/cli.js restore --session-id <session-id>
```

## Configuration

The default Codex home is:

```text
~/.codex
```

You can override it with:

```bash
CODEX_HOME=/path/to/.codex npm run dev
```

The server listens on:

```text
127.0.0.1:7345
```

Override the port:

```bash
PORT=7350 npm run dev
```

## Development

Project layout:

```text
public/
  index.html        Browser UI shell
  styles.css        UI design system and layout
  app.js            Frontend state and API calls
src/
  server.js         Local HTTP server and JSON APIs
  sessionScanner.js Scan and classification logic
  sessionAnalyzer.js Quick/deep session analysis
  sessionCompactor.js Safe compact-copy and replace flow
  sessionBackupRecords.js Backup record registry
  sessionLocks.js   lsof lock detection and release
  archiveManager.js Archive and restore logic
  cli.js            CLI entrypoint
test/
  *.test.js         Node test runner tests
```

Validation:

```bash
node --check public/app.js
node --check src/server.js
npm test
```

The project intentionally avoids build tooling and frontend dependencies. The UI is plain HTML, CSS, and browser JavaScript.

## Troubleshooting

### The page says a session is still active

Open the session detail and use the `占用` tab. It shows processes that still hold the session file open. The tool can send `TERM` or `KILL` only to a `codex` process that still has the exact target session file open.

### A backup record says the file is unavailable

For external backups, reconnect the USB drive or data disk and refresh backup records. For imported backups, confirm the file still exists under `$CODEX_HOME/session_backups/imported`.

### The compacted session is missing old large content

That is expected. Compaction replaces large fields with placeholders. Use the backup record to restore the original full JSONL if required.

### The scan is slow

Very large session trees can take time because the tool stats JSONL files, reads metadata, checks active handles, and groups results by project/month. The UI does not start this scan automatically.

## FAQ

### Does opening the page scan my sessions?

No. The page starts in a manual state. Scan only starts after you click the primary scan button.

### Does the tool upload anything?

No. It is a local HTTP server bound to `127.0.0.1`.

### Can this break an active Codex session?

Dangerous operations re-check active file handles with `lsof`. Active sessions are refused rather than force-edited.

### Does compacting preserve every original token?

No. Compacting preserves structure and metadata but replaces selected large fields with placeholders. Keep the backup if you need the exact original content.

### Is this an official OpenAI tool?

No. This is an independent local utility for inspecting and managing local Codex session files.

## License

MIT. See [LICENSE](./LICENSE).
