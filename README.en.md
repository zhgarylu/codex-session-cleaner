# Codex Session Cleaner

[English](./README.en.md) | [中文](./README.zh-CN.md)

Codex Session Cleaner is a local-first visual inspection, archive, and safe compaction tool for Codex session files.

Codex sessions are usually stored under `$CODEX_HOME/sessions`, which defaults to `~/.codex/sessions`. Long-running tasks, large tool outputs, image/base64 data, repeated context snapshots, and command logs can make individual `.jsonl` session files grow to hundreds of MB or several GB. This tool provides a local browser UI to help you understand which projects and sessions consume disk space, then archive, compact, back up, or restore them within conservative safety boundaries.

Core principles:

- **Local only**: the server listens on `127.0.0.1`.
- **No telemetry**: session contents are not uploaded.
- **No automatic scan**: opening the page does not immediately read real session files.
- **No automatic cleanup**: archive, delete, replace, and restore actions are always manually triggered.
- **Explicit confirmation for risky actions**: the UI shows counts, sizes, paths, and impact before execution.
- **Active session protection**: files still opened by Codex are detected with `lsof` and protected from replacement or restore.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Demo](#demo)
- [UI Workflow](#ui-workflow)
- [Safety Model](#safety-model)
- [Session Analysis](#session-analysis)
- [Session Compaction](#session-compaction)
- [Backup Records](#backup-records)
- [Archive and Delete](#archive-and-delete)
- [CLI Commands](#cli-commands)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [Development and Testing](#development-and-testing)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [License](#license)

## Features

- **Manual scan**: the app starts on a welcome and safety screen. It reads `$CODEX_HOME/sessions` only after you click `Start scanning sessions`.
- **Overview metrics**: total session size, file count, archive candidate size, deletable archive size, and manual-review count.
- **Project grouping**: sessions are grouped by `cwd` from metadata, with session counts, total size, and whether the project path still exists.
- **Monthly grouping**: shows disk usage by month, making abnormal growth easier to spot.
- **Session table**: filter by project, month, status, and keyword.
- **Large-file quick analysis**: reads only head, tail, and middle sample windows instead of rendering full JSONL into the browser.
- **Deep analysis**: manually triggered streaming full-file scan for complete statistics.
- **Safe compaction**: generate a compacted copy first, then explicitly replace the original only when safe.
- **Backup record center**: track local backups, external-drive backup paths, imported backups, and restore by record.
- **Lock detection**: show Codex processes, PID, FD, and read/write mode for files still held open.
- **Two-stage cleanup**: archive and gzip old sessions first; delete archived files only after a longer retention window.

## Quick Start

### Requirements

- Node.js 20 or newer
- macOS, or another system with `lsof`
- A local Codex session directory at `$CODEX_HOME/sessions`

### Start the local web UI

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:7345
```

The page does not scan automatically. Click `Start scanning sessions` to read `$CODEX_HOME/sessions`.

### Command-line scan

```bash
npm run scan
```

Print full session details:

```bash
node src/cli.js scan --full
```

### Run tests

```bash
npm test
```

## Demo

The project includes a safe demo mode:

```text
http://127.0.0.1:7345/?demo=1
```

Demo mode uses frontend mock data only. It does not read `$CODEX_HOME` and does not call real cleanup APIs. It is useful for screenshots, screen recordings, GitHub Pages, or showing the workflow to others.

A static demo page is also included:

```text
https://github.com/zhgarylu/codex-session-cleaner/blob/main/demo/index.html
```

The demo shows:

- Dashboard overview after a manual scan.
- Project and month usage breakdown.
- A simulated 5GB `movie.aigc` large session.
- Session detail tabs: `Analysis / Compact / Backups / Locks`.
- Compaction preview, compacted-copy generation, backup records, and lock detection workflows.

In demo mode, archive, delete, replace, restore, and process-release actions are simulated only. They do not modify local files.

## UI Workflow

1. Open the local page.
2. Read the safety notes on the welcome screen.
3. Click `Start scanning sessions`.
4. Review overall disk usage in the overview.
5. Locate large files from the project list or session table.
6. Open a session detail view:
   - `Analysis`: content composition, suspected growth causes, and large-content signals.
   - `Compact`: estimate removable size, generate a compacted copy, and replace the original.
   - `Backups`: view records, reconcile historical backups, register external-drive backups, import backups, and restore by record.
   - `Locks`: check whether any Codex process still has the session file open.
7. Archive old cleanup candidates or compact specific large sessions.

## Safety Model

The tool follows these safety boundaries:

- It does not scan automatically when the page opens.
- Default scans are read-only: no move, delete, or rewrite.
- Original session files are limited to `$CODEX_HOME/sessions/**/*.jsonl`.
- It never processes `auth.json`, `config.toml`, SQLite databases, plugins, skills, cache, state, or unrelated Codex files.
- It refuses to overwrite sessions still opened by Codex.
- It never deletes original sessions by default.
- Delete operations apply only to archived compressed files past the retention window.
- During backup restore, the current file is first moved to `.before-restore-*`, then the backup is restored.
- External-drive backup files are registered or read only. They are not deleted or moved.

Default retention policy:

- Keep original sessions from the last 90 days.
- Allow deletion of compressed archived files only after 180 days.

## Session Analysis

### Quick Analysis

Quick analysis runs by default. It reads the head, tail, and selected middle windows of a session file. Even for 5GB-scale files, it does not return the full content to the browser.

Quick analysis reports:

- Top-level JSONL `type`
- Payload type
- Role type
- `input_text` signals
- Base64-like data
- Image-like data
- Tool/function call output signals
- Token count events
- Very long lines
- Timeline sampling
- Top N large-content snippets

### Deep Analysis

Deep analysis must be started manually. It streams the entire session file and updates background job progress.

Deep analysis is still read-only and does not modify any session file.

## Session Compaction

Compaction is for sessions with very large fields, such as:

- Huge `input_text`
- Suspected base64 or image-like text
- Very long `encrypted_content`
- Large command output / tool output
- Oversized JSONL lines that cannot be safely parsed

Recommended workflow:

1. Click `Compaction preview`: read-only scan and size reduction estimate.
2. Click `Generate compacted copy`: write a copy under `$CODEX_HOME/session_compacted` without changing the original.
3. Confirm the session is not opened by Codex.
4. Click `Replace original`: move the original to `$CODEX_HOME/session_backups`, then move the compacted copy back to the original path.
5. If needed, restore the original JSONL from the `Backups` tab by record.

Compaction preserves:

- `session_meta`
- session id
- timestamp
- `cwd`
- top-level type / role
- ordinary short text
- function call metadata
- token count summaries

Removed large content is replaced with a placeholder summary, for example:

```text
[removed large field: 1.2 GB, sha256=..., reason=base64-like, removed_at=...]
```

Note: compacted sessions no longer contain the removed large original text. Keep backups if you may need the original content later.

## Backup Records

Backup records are stored at:

```text
$CODEX_HOME/session_backups/backup_records.jsonl
```

The backup record center supports:

- Scanning and reconciling historical local backups.
- Registering backup paths that you copied to USB drives or external disks.
- Importing a backup from a specified path into `$CODEX_HOME/session_backups/imported`.
- Restoring a session by a selected backup record.

Each backup record includes:

- Original session path
- Local backup path or external backup path
- session id
- title
- `cwd`
- file size
- sha256
- creation time
- source
- whether the file is still available

External backup files are never deleted or moved by the tool.

## Archive and Delete

Archive and compaction are separate features.

Archive is intended for old, inactive sessions. The original JSONL is moved and gzip-compressed into:

```text
$CODEX_HOME/archived_sessions
```

Each archive operation writes a manifest containing:

- original path
- archive path
- session id
- title
- `cwd`
- size
- sha256
- archive time
- original mtime

Delete operations apply only to compressed archived files past the retention window. The tool does not directly delete original sessions under `$CODEX_HOME/sessions`.

## CLI Commands

Generate a scan summary:

```bash
npm run scan
```

Generate full scan output:

```bash
node src/cli.js scan --full
```

Restore a session from an archive manifest:

```bash
node src/cli.js restore --session-id <session-id>
```

## Configuration

Default Codex Home:

```text
~/.codex
```

Override with an environment variable:

```bash
CODEX_HOME=/path/to/.codex npm run dev
```

Default server address:

```text
127.0.0.1:7345
```

Change the port:

```bash
PORT=7350 npm run dev
```

## Project Structure

```text
public/
  index.html        Browser UI shell
  styles.css        UI design system and layout
  app.js            Frontend state and API calls
src/
  server.js         Local HTTP server and JSON API
  sessionScanner.js Scan and policy classification
  sessionAnalyzer.js Quick/deep analysis
  sessionCompactor.js Compacted copies, replacement, restore
  sessionBackupRecords.js Backup record center
  sessionLocks.js   lsof lock detection and release
  archiveManager.js Archive and restore
  cli.js            CLI entrypoint
test/
  *.test.js         Node test runner tests
```

## Development and Testing

This project intentionally avoids Vite, React, or other frontend build dependencies to reduce setup and audit overhead. The frontend is plain HTML/CSS/JavaScript; the backend is a native Node.js HTTP server.

Common checks:

```bash
node --check public/app.js
node --check src/server.js
npm test
```

## Troubleshooting

### The page says a session is still active

Open the `Locks` tab in the session detail view. The tool lists processes, PID, FD, and read/write mode for the target session. It only allows `TERM` or `KILL` when the process is `codex` and still holds the target file.

### Backup records show that a file is unavailable

If it is an external-drive backup, reconnect the USB drive or data disk and refresh backup records. If it is an imported backup, confirm that the file still exists under `$CODEX_HOME/session_backups/imported`.

### Large original content is missing after compaction

This is expected. Compaction replaces large fields with placeholder summaries. Restore the original JSONL from backup records if you need the full original content.

### Scanning is slow

Large session directories require file stat calls, metadata reads, active handle checks, and project/month grouping. The page does not auto-scan; trigger scans manually when needed.

### CLI push to GitHub fails

If `git push` cannot read a GitHub username, your local machine does not have usable GitHub CLI or Git credentials configured. You can push with GitHub Desktop, configure SSH/HTTPS credentials, or use the Codex/ChatGPT GitHub plugin when it has contents write access.

## FAQ

### Does the app scan my sessions when I open the page?

No. The app starts in an unscanned state. It scans only after you click the main scan button.

### Does the tool upload session contents?

No. The server binds to `127.0.0.1`, and there is no telemetry logic.

### Can it break a running Codex task?

Risky operations re-check active file handles. If the target session is still opened by Codex, the server refuses replacement or restore.

### Does compaction preserve all original tokens?

No. Compaction preserves structure and metadata, but replaces fields classified as too large with placeholder summaries. Keep backups if you need the full original text.

### Is this an official OpenAI tool?

No. This is an independent local tool for inspecting and managing local Codex session files.

## License

MIT. See [LICENSE](./LICENSE).
