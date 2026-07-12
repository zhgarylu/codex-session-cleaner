# Codex Session Cleaner

一个本地优先的 Codex Session 可视化检查、归档与安全瘦身工具。

Codex 的历史会话通常保存在 `$CODEX_HOME/sessions` 下，默认是 `~/.codex/sessions`。长期任务、包含大量工具输出的任务、图片/base64 内容、重复上下文等都可能让单个 `.jsonl` session 文件增长到几百 MB 甚至数 GB。这个工具提供一个本地浏览器界面，帮助你看清楚空间被哪些项目和哪些 session 占用，并在安全边界内进行归档、瘦身、备份与恢复。

核心原则：

- **本地运行**：服务只监听 `127.0.0.1`。
- **无遥测**：不会上传 session 内容。
- **不自动扫描**：打开页面后不会立即读取真实 session 文件。
- **不自动清理**：所有归档、删除、替换、恢复都需要手动触发。
- **危险操作二次确认**：执行前会展示数量、大小、路径和影响。
- **保护活跃 session**：通过 `lsof` 检测仍被 Codex 打开的文件，拒绝覆盖或替换。

## 目录

- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [Demo 演示](#demo-演示)
- [界面工作流](#界面工作流)
- [安全模型](#安全模型)
- [Session 分析](#session-分析)
- [Session 瘦身](#session-瘦身)
- [备份记录](#备份记录)
- [归档与删除](#归档与删除)
- [CLI 命令](#cli-命令)
- [配置](#配置)
- [项目结构](#项目结构)
- [开发与测试](#开发与测试)
- [故障排查](#故障排查)
- [常见问题](#常见问题)
- [English Documentation](#english-documentation)
- [License](#license)

## 功能特性

- **手动扫描**：页面启动后只显示欢迎页和安全说明，点击 `开始扫描 sessions` 后才读取 `$CODEX_HOME/sessions`。
- **顶部总览**：展示 session 总大小、文件数量、可归档空间、可删除归档空间、需人工确认数量。
- **按项目分组**：根据 session 元数据中的 `cwd` 分组，显示每个项目的 session 数量、总大小和路径是否仍存在。
- **按月份分组**：展示不同月份的空间占用，便于定位异常增长。
- **Session 明细表**：支持按项目、月份、状态和关键词搜索。
- **大文件快速分析**：只读取文件头部、尾部和中间窗口，不把完整 JSONL 渲染到浏览器。
- **深度分析**：用户手动触发后流式读取完整文件，适合需要全量统计的场景。
- **安全瘦身**：先生成瘦身副本，再手动确认替换原文件。
- **备份记录中心**：记录本机备份、外部盘备份路径、导入备份，并支持按记录恢复。
- **占用检测**：显示仍持有 session 文件句柄的 Codex 进程、PID、FD 和读写模式。
- **两阶段清理**：先归档压缩旧 session，超过更长保留期后才允许删除归档文件。

## 快速开始

### 环境要求

- Node.js 20 或更高版本
- macOS，或其他可使用 `lsof` 的系统
- 本机存在 Codex session 目录：`$CODEX_HOME/sessions`

### 启动本地可视化界面

```bash
npm run dev
```

打开：

```text
http://127.0.0.1:7345
```

页面打开后不会自动扫描。点击 `开始扫描 sessions` 后才会读取 `$CODEX_HOME/sessions`。

### 命令行扫描

```bash
npm run scan
```

输出完整 session 明细：

```bash
node src/cli.js scan --full
```

### 运行测试

```bash
npm test
```

## Demo 演示

项目内置安全演示模式：

```text
http://127.0.0.1:7345/?demo=1
```

Demo 模式只使用前端 mock 数据，不会读取 `$CODEX_HOME`，也不会调用真实清理 API。它适合用于截图、录屏、GitHub Pages 或向其他人展示界面流程。

仓库里也提供了一个可直接预览的静态 demo 页面：

```text
https://github.com/zhgarylu/codex-session-cleaner/blob/main/demo/index.html
```

Demo 中可以体验：

- 手动扫描后的工作台总览。
- 按项目和月份查看占用。
- 查看一个模拟的 5GB `movie.aigc` 大 session。
- Session 详情中的 `分析 / 瘦身 / 备份 / 占用` tabs。
- 瘦身预览、生成副本、备份记录、占用检测的交互流程。

Demo 模式下，归档、删除、替换、恢复、释放进程等危险操作都只显示模拟结果，不会修改任何本机文件。

## 界面工作流

1. 打开本地页面。
2. 阅读欢迎页上的安全说明。
3. 点击 `开始扫描 sessions`。
4. 在总览中确认整体占用情况。
5. 从项目列表或 Session 明细中定位大文件。
6. 打开 Session 详情：
   - `分析`：查看内容构成、疑似膨胀原因、大块内容信号。
   - `瘦身`：预览可减少空间、生成瘦身副本、替换原文件。
   - `备份`：查看备份记录、补录历史备份、登记外部盘备份、导入备份、按记录恢复。
   - `占用`：检测是否仍有 Codex 进程打开该 session。
7. 对清理候选执行归档或对大文件执行瘦身。

## 安全模型

工具遵守以下安全边界：

- 不会在页面打开时自动扫描。
- 默认扫描只读，不移动、不删除、不改写文件。
- 原始 session 文件只处理 `$CODEX_HOME/sessions/**/*.jsonl`。
- 不处理 `auth.json`、`config.toml`、SQLite 数据库、plugins、skills、cache、state 等 Codex 配置或状态文件。
- 不覆盖当前仍被 Codex 打开的 session。
- 不默认删除原始 session。
- 删除只针对已经归档且超过保留期的压缩文件。
- 恢复备份时，会先把当前文件移动到 `.before-restore-*`，再恢复备份。
- 外部盘备份文件只登记或读取，不会被工具删除或移动。

默认保留策略：

- 原始 session 默认保留最近 90 天。
- 已归档压缩文件默认 180 天后才允许删除。

## Session 分析

### 快速分析

快速分析默认执行，只读取 session 文件的头部、尾部和若干中间窗口。即使遇到 5GB 级别的大文件，也不会把完整内容返回到浏览器。

快速分析会统计：

- JSONL 顶层 `type`
- payload 类型
- role 类型
- `input_text` 信号
- base64-like 数据
- image-like 数据
- tool/function call output 信号
- token count 事件
- 超长行
- 时间线采样
- 大块内容 Top N 短片段

### 深度分析

深度分析需要手动触发。它会流式读取完整 session 文件，并持续更新后台任务进度。

深度分析仍然是只读操作，不修改任何 session 文件。

## Session 瘦身

瘦身用于处理包含超大字段的 session，例如：

- 超大 `input_text`
- 疑似 base64 或图片类文本
- 超长 `encrypted_content`
- 大块 command output / tool output
- 无法安全解析的超长 JSONL 行

推荐流程：

1. 点击 `瘦身预览`：只读扫描，估算可减少大小。
2. 点击 `生成瘦身副本`：写入 `$CODEX_HOME/session_compacted`，不改原文件。
3. 确认 session 未被 Codex 打开。
4. 点击 `替换原文件`：原文件先移动到 `$CODEX_HOME/session_backups`，瘦身副本再移动回原路径。
5. 如有问题，可从 `备份` tab 按记录恢复原始文件。

瘦身会保留：

- `session_meta`
- session id
- timestamp
- `cwd`
- 顶层 type / role
- 普通短文本
- function call 元数据
- token count 摘要

被删除的大块内容会替换为占位摘要，例如：

```text
[removed large field: 1.2 GB, sha256=..., reason=base64-like, removed_at=...]
```

注意：瘦身后的 session 不再完整包含被移除的大块原文。如果之后可能需要原始内容，请保留备份。

## 备份记录

备份记录文件位于：

```text
$CODEX_HOME/session_backups/backup_records.jsonl
```

备份记录中心支持：

- 扫描并补录历史本机备份。
- 登记已经复制到 U 盘或外部数据盘的备份路径。
- 从指定路径导入备份到 `$CODEX_HOME/session_backups/imported`。
- 按某条备份记录恢复 session。

每条备份记录包含：

- 原始 session 路径
- 本机备份路径或外部备份路径
- session id
- 标题
- `cwd`
- 文件大小
- sha256
- 创建时间
- 来源
- 文件是否仍可用

外部备份文件不会被工具删除或移动。

## 归档与删除

归档和瘦身是两个独立功能。

归档用于旧的、不活跃的 session。归档时原始 JSONL 会移动并 gzip 压缩到：

```text
$CODEX_HOME/archived_sessions
```

每次归档都会写入 manifest，记录：

- 原路径
- 归档路径
- session id
- 标题
- `cwd`
- 大小
- sha256
- 归档时间
- 原始 mtime

删除操作只针对超过保留期的压缩归档文件，不会直接删除仍在 `$CODEX_HOME/sessions` 下的原始 session。

## CLI 命令

生成摘要：

```bash
npm run scan
```

生成完整扫描输出：

```bash
node src/cli.js scan --full
```

从归档 manifest 恢复 session：

```bash
node src/cli.js restore --session-id <session-id>
```

## 配置

默认 Codex Home：

```text
~/.codex
```

通过环境变量覆盖：

```bash
CODEX_HOME=/path/to/.codex npm run dev
```

默认服务地址：

```text
127.0.0.1:7345
```

修改端口：

```bash
PORT=7350 npm run dev
```

## 项目结构

```text
public/
  index.html        浏览器界面骨架
  styles.css        UI 设计系统与布局
  app.js            前端状态和 API 调用
src/
  server.js         本地 HTTP 服务与 JSON API
  sessionScanner.js 扫描与策略分类
  sessionAnalyzer.js 快速/深度分析
  sessionCompactor.js 瘦身副本、替换与恢复
  sessionBackupRecords.js 备份记录中心
  sessionLocks.js   lsof 占用检测与释放
  archiveManager.js 归档与恢复
  cli.js            CLI 入口
test/
  *.test.js         Node test runner 测试
```

## 开发与测试

本项目故意不引入 Vite、React 或其他前端构建依赖，降低安装和审计成本。前端是原生 HTML/CSS/JavaScript，后端是原生 Node.js HTTP 服务。

常用检查：

```bash
node --check public/app.js
node --check src/server.js
npm test
```

## 故障排查

### 页面提示 session 仍被占用

打开 Session 详情的 `占用` tab。工具会列出仍打开目标 session 文件的进程、PID、FD 和读写模式。只有当进程是 `codex` 且仍持有目标文件时，才允许发送 `TERM` 或 `KILL`。

### 备份记录显示文件不可用

如果是外部盘备份，请重新连接 U 盘或数据盘，然后刷新备份记录。如果是导入备份，请确认文件仍存在于 `$CODEX_HOME/session_backups/imported`。

### 瘦身后看不到原来的大块内容

这是预期行为。瘦身会把大块字段替换为占位摘要。需要完整原文时，请从备份记录恢复原始 JSONL。

### 扫描较慢

如果 session 目录很大，扫描需要 stat 文件、读取元数据、检测活跃句柄并做项目/月度分组。页面不会自动扫描，你可以在需要时手动触发。

### GitHub 发布时 CLI 推送失败

如果 `git push` 提示无法读取 GitHub 用户名，说明本机没有可用的 GitHub CLI 或凭据。可以使用 GitHub Desktop 推送，或在 Codex/ChatGPT 中授权 GitHub 插件并确保有 contents 写权限。

## 常见问题

### 打开页面会自动扫描我的 sessions 吗？

不会。页面启动后处于未扫描状态，只有点击主按钮后才会开始扫描。

### 工具会上传 session 内容吗？

不会。服务绑定在 `127.0.0.1`，没有遥测逻辑。

### 会破坏正在运行的 Codex 任务吗？

危险操作会重新检测 active 文件句柄。如果目标 session 仍被 Codex 打开，服务端会拒绝替换或恢复。

### 瘦身是否保留所有原始 token？

不会。瘦身会保留结构和元数据，但会把被判定为超大的字段替换为占位摘要。如果你需要完整原文，请保留备份。

### 这是 OpenAI 官方工具吗？

不是。这是一个独立的本地工具，用于检查和管理本机 Codex session 文件。

## English Documentation

Codex Session Cleaner is a local-first visual inspection, archive, and safe compaction tool for Codex session files.

Codex sessions are usually stored under `$CODEX_HOME/sessions`, which defaults to `~/.codex/sessions`. Long-running tasks, large tool outputs, image/base64 data, repeated context snapshots, and command logs can make individual `.jsonl` session files grow to hundreds of MB or several GB. This tool provides a local browser UI to help you understand which projects and sessions consume disk space, then archive, compact, back up, or restore them within conservative safety boundaries.

Core principles:

- **Local only**: the server listens on `127.0.0.1`.
- **No telemetry**: session contents are not uploaded.
- **No automatic scan**: opening the page does not immediately read real session files.
- **No automatic cleanup**: archive, delete, replace, and restore actions are always manually triggered.
- **Explicit confirmation for risky actions**: the UI shows counts, sizes, paths, and impact before execution.
- **Active session protection**: files still opened by Codex are detected with `lsof` and protected from replacement or restore.

### Table of Contents

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

### Features

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

### Quick Start

#### Requirements

- Node.js 20 or newer
- macOS, or another system with `lsof`
- A local Codex session directory at `$CODEX_HOME/sessions`

#### Start the local web UI

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:7345
```

The page does not scan automatically. Click `Start scanning sessions` to read `$CODEX_HOME/sessions`.

#### Command-line scan

```bash
npm run scan
```

Print full session details:

```bash
node src/cli.js scan --full
```

#### Run tests

```bash
npm test
```

### Demo

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

### UI Workflow

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

### Safety Model

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

### Session Analysis

#### Quick Analysis

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

#### Deep Analysis

Deep analysis must be started manually. It streams the entire session file and updates background job progress.

Deep analysis is still read-only and does not modify any session file.

### Session Compaction

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

### Backup Records

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

### Archive and Delete

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

### CLI Commands

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

### Configuration

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

### Project Structure

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

### Development and Testing

This project intentionally avoids Vite, React, or other frontend build dependencies to reduce setup and audit overhead. The frontend is plain HTML/CSS/JavaScript; the backend is a native Node.js HTTP server.

Common checks:

```bash
node --check public/app.js
node --check src/server.js
npm test
```

### Troubleshooting

#### The page says a session is still active

Open the `Locks` tab in the session detail view. The tool lists processes, PID, FD, and read/write mode for the target session. It only allows `TERM` or `KILL` when the process is `codex` and still holds the target file.

#### Backup records show that a file is unavailable

If it is an external-drive backup, reconnect the USB drive or data disk and refresh backup records. If it is an imported backup, confirm that the file still exists under `$CODEX_HOME/session_backups/imported`.

#### Large original content is missing after compaction

This is expected. Compaction replaces large fields with placeholder summaries. Restore the original JSONL from backup records if you need the full original content.

#### Scanning is slow

Large session directories require file stat calls, metadata reads, active handle checks, and project/month grouping. The page does not auto-scan; trigger scans manually when needed.

#### CLI push to GitHub fails

If `git push` cannot read a GitHub username, your local machine does not have usable GitHub CLI or Git credentials configured. You can push with GitHub Desktop, configure SSH/HTTPS credentials, or use the Codex/ChatGPT GitHub plugin when it has contents write access.

### FAQ

#### Does the app scan my sessions when I open the page?

No. The app starts in an unscanned state. It scans only after you click the main scan button.

#### Does the tool upload session contents?

No. The server binds to `127.0.0.1`, and there is no telemetry logic.

#### Can it break a running Codex task?

Risky operations re-check active file handles. If the target session is still opened by Codex, the server refuses replacement or restore.

#### Does compaction preserve all original tokens?

No. Compaction preserves structure and metadata, but replaces fields classified as too large with placeholder summaries. Keep backups if you need the full original text.

#### Is this an official OpenAI tool?

No. This is an independent local tool for inspecting and managing local Codex session files.

## License

MIT. See [LICENSE](./LICENSE).
