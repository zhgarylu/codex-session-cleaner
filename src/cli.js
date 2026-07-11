import { archiveSessions, deleteArchivedSessions, restoreSession } from './archiveManager.js';
import { scanSessions } from './sessionScanner.js';
import { parseDurationDays } from './utils.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'scan';
  const baseOptions = {
    codexHome: args['codex-home'],
    retentionDays: parseDurationDays(args['older-than'], 90),
    archiveRetentionDays: parseDurationDays(args['archive-older-than'], 180)
  };
  if (command === 'scan') {
    const result = await scanSessions(baseOptions);
    console.log(JSON.stringify(args.full ? result : result.summary, null, 2));
    return;
  }
  if (command === 'archive') {
    const result = await archiveSessions({
      ...baseOptions,
      apply: args.apply === true,
      sessionIds: args['session-id'] ? [args['session-id']] : []
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'restore') {
    const result = await restoreSession({
      codexHome: args['codex-home'],
      sessionId: args['session-id'],
      archivePath: args['archive-path']
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'delete-archives') {
    const result = await deleteArchivedSessions({
      codexHome: args['codex-home'],
      archiveRetentionDays: parseDurationDays(args['older-than'], 180),
      apply: args.apply === true
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
