# Codex Session Cleaner

Local-first visual inspection, archive, and safe compaction tool for Codex session files.

本地优先的 Codex Session 可视化检查、归档与安全瘦身工具。

## Choose Your Language

- [English Documentation](./README.en.md)
- [中文说明](./README.zh-CN.md)

## Quick Start

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:7345
```

The app starts in an unscanned state and reads `$CODEX_HOME/sessions` only after you click the scan button.

页面启动后不会自动扫描，只有点击扫描按钮后才会读取 `$CODEX_HOME/sessions`。

## Safety At A Glance

- Local only: listens on `127.0.0.1`
- No telemetry
- No automatic cleanup
- Manual scan only
- Active sessions are protected with `lsof`
- Risky actions require explicit confirmation

## Demo

Run the local app and open:

```text
http://127.0.0.1:7345/?demo=1
```

Static demo:

```text
https://github.com/zhgarylu/codex-session-cleaner/blob/main/demo/index.html
```

## License

MIT. See [LICENSE](./LICENSE).
