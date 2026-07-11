let scanData = null;
let visibleSessions = [];
let selectedSessionPath = null;
let activeDeepJob = null;
let hasScanned = false;

const $ = (id) => document.getElementById(id);
const demoMode = new URLSearchParams(window.location.search).get('demo') === '1';
const demoLargePath = '/Users/demo/.codex/sessions/2026/05/06/rollout-demo-movie-aigc-large.jsonl';

const demoScanData = {
  summary: {
    sessionsDir: '/Users/demo/.codex/sessions',
    generatedAt: '2026-07-11T09:30:00.000Z',
    totals: {
      bytesHuman: '6.3 GB',
      files: 128,
      archiveCandidateBytesHuman: '5.4 GB',
      manualReviewFiles: 3
    },
    archives: {
      deleteCandidateBytesHuman: '840 MB',
      deleteCandidateFiles: 9
    },
    byMonth: [
      { month: '2026-07', bytes: 420 * 1024 * 1024, bytesHuman: '420 MB' },
      { month: '2026-06', bytes: 380 * 1024 * 1024, bytesHuman: '380 MB' },
      { month: '2026-05', bytes: 5.5 * 1024 * 1024 * 1024, bytesHuman: '5.5 GB' }
    ],
    byProject: [
      { cwd: '/Users/demo/aiCode/movie.aigc', files: 19, bytes: 5.1 * 1024 * 1024 * 1024, bytesHuman: '5.1 GB', archiveCandidateBytesHuman: '4.9 GB', exists: true },
      { cwd: '/Users/demo/aiCode/site-builder', files: 42, bytes: 620 * 1024 * 1024, bytesHuman: '620 MB', archiveCandidateBytesHuman: '180 MB', exists: true },
      { cwd: '/Users/demo/aiCode/old-experiment', files: 11, bytes: 410 * 1024 * 1024, bytesHuman: '410 MB', archiveCandidateBytesHuman: '410 MB', exists: false },
      { cwd: '(unknown project)', files: 3, bytes: 160 * 1024 * 1024, bytesHuman: '160 MB', archiveCandidateBytesHuman: '0 B', exists: false }
    ]
  },
  sessions: [
    {
      recommendation: 'archive_candidate',
      title: 'movie.aigc 长期生成任务',
      sessionId: 'demo-large-session',
      relativePath: '2026/05/06/rollout-demo-movie-aigc-large.jsonl',
      path: demoLargePath,
      cwd: '/Users/demo/aiCode/movie.aigc',
      cwdExists: true,
      day: '2026-05-06',
      month: '2026-05',
      relevantTime: '2026-07-09T18:20:00.000Z',
      size: 5.0 * 1024 * 1024 * 1024,
      sizeHuman: '5.0 GB',
      reasons: ['超过 90 天且未发现活跃句柄', '包含疑似大块 input_text/base64 内容']
    },
    {
      recommendation: 'protect',
      title: '当前 UI 优化任务',
      sessionId: 'demo-active-session',
      relativePath: '2026/07/11/rollout-demo-active.jsonl',
      path: '/Users/demo/.codex/sessions/2026/07/11/rollout-demo-active.jsonl',
      cwd: '/Users/demo/aiCode/codex-session-cleaner',
      cwdExists: true,
      day: '2026-07-11',
      month: '2026-07',
      relevantTime: '2026-07-11T09:28:00.000Z',
      size: 88 * 1024 * 1024,
      sizeHuman: '88 MB',
      reasons: ['今天创建', '最近更新', '演示中的 active 保护样例']
    },
    {
      recommendation: 'manual_review',
      title: '(缺少元数据)',
      sessionId: '',
      relativePath: '2026/06/12/rollout-demo-unknown.jsonl',
      path: '/Users/demo/.codex/sessions/2026/06/12/rollout-demo-unknown.jsonl',
      cwd: '(unknown project)',
      cwdExists: false,
      day: '2026-06-12',
      month: '2026-06',
      relevantTime: '2026-06-12T11:00:00.000Z',
      size: 160 * 1024 * 1024,
      sizeHuman: '160 MB',
      reasons: ['缺少 session_meta.cwd', '需要人工确认']
    }
  ]
};

const demoDetail = {
  mode: 'quick',
  file: { path: demoLargePath, sizeHuman: '5.0 GB', mtime: '2026-07-09T18:20:00.000Z' },
  inferredCauses: ['单个长期 session 持续追加导致项目占用异常集中。', '采样发现大量 input_text、base64-like 和工具输出信号。', '建议先生成瘦身副本，保留备份后再替换。'],
  aggregate: {
    typeCounts: [{ name: 'response_item', count: 42100 }, { name: 'event_msg', count: 18800 }, { name: 'turn_context', count: 9200 }, { name: 'session_meta', count: 1 }],
    payloadTypeCounts: [{ name: 'message', count: 35000 }, { name: 'function_call_output', count: 6600 }, { name: 'token_count', count: 1800 }],
    featureCounts: { inputText: 1140, outputText: 820, functionCalls: 640, tokenCounts: 1800, imageLikeData: 130, base64LikeData: 92, largeLines: 17 },
    largeBlocks: [
      { bytesHuman: '1.2 GB', type: 'response_item', flags: ['input_text', 'base64-like'], snippet: '{"type":"input_text","text":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...' },
      { bytesHuman: '840 MB', type: 'response_item', flags: ['tool-output'], snippet: '{"type":"function_call_output","output":"render log frame=00001 ...' },
      { bytesHuman: '390 MB', type: 'turn_context', flags: ['context-snapshot'], snippet: '{"type":"turn_context","payload":{"cwd":"/Users/demo/aiCode/movie.aigc"...' }
    ]
  },
  windows: [
    { name: 'head', startHuman: '0 B', lines: 400 },
    { name: 'middle', startHuman: '2.5 GB', lines: 380 },
    { name: 'tail', startHuman: '5.0 GB', lines: 400 }
  ]
};

const demoCompactPreview = {
  processedLines: 73413,
  replacedLines: 1140,
  replacements: 1152,
  originalBytesRemovedHuman: '4.9 GB',
  fields: [
    { path: 'payload.content[0].text', reason: 'input_text,base64-like,large-field', originalBytesHuman: '1.2 GB' },
    { path: 'payload.output', reason: 'tool-output,large-field', originalBytesHuman: '840 MB' }
  ],
  largeLines: [
    { originalBytesHuman: '390 MB', sha256: 'af48bb97c47f9d41', snippet: '{"type":"turn_context","payload":{"cwd":"/Users/demo/aiCode/movie.aigc"...' }
  ]
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function statusText(status) {
  return {
    protect: '保护',
    archive_candidate: '可归档',
    manual_review: '需人工确认'
  }[status] || status;
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    el.hidden = true;
  }, 3600);
}

function setScanUi(state, summary = null) {
  const isScanning = state === 'scanning';
  hasScanned = state === 'ready';
  $('refreshBtn').disabled = isScanning;
  $('refreshBtn').textContent = isScanning ? '扫描中...' : hasScanned ? '重新扫描' : '开始扫描';
  const welcomeScanBtn = $('welcomeScanBtn');
  if (welcomeScanBtn) {
    welcomeScanBtn.disabled = isScanning;
    welcomeScanBtn.textContent = isScanning ? '扫描中...' : hasScanned ? '重新扫描 sessions' : '开始扫描 sessions';
  }
  const scanState = $('scanState');
  if (scanState) {
    scanState.textContent = isScanning
      ? demoMode ? '正在加载演示数据...' : '正在只读扫描本机 session 文件...'
      : hasScanned && summary
        ? `${demoMode ? '演示数据' : '已扫描'} ${summary.totals.files} 个 session · ${new Date(summary.generatedAt).toLocaleString()}`
        : demoMode ? '演示模式：不会读取本机文件' : '等待手动扫描';
  }
  $('workspace').hidden = !hasScanned;
  $('welcomePanel').classList.toggle('compact', hasScanned);
}

function fillSelect(select, values, label) {
  const current = select.value;
  select.innerHTML = `<option value="">${label}</option>`;
  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  select.value = values.includes(current) ? current : '';
}

function renderSummary(summary) {
  const metrics = $('summaryGrid').querySelectorAll('strong');
  metrics[0].textContent = summary.totals.bytesHuman;
  metrics[1].textContent = String(summary.totals.files);
  metrics[2].textContent = summary.totals.archiveCandidateBytesHuman;
  metrics[3].textContent = summary.archives.deleteCandidateBytesHuman;
  metrics[4].textContent = String(summary.totals.manualReviewFiles);
  $('subtitle').textContent = `${demoMode ? '演示数据' : '扫描目录'}：${summary.sessionsDir}，生成时间：${new Date(summary.generatedAt).toLocaleString()}`;
}

function renderBars(summary) {
  const max = Math.max(...summary.byMonth.map((row) => row.bytes), 1);
  $('monthBars').innerHTML = summary.byMonth.map((row) => {
    const width = Math.max(2, Math.round((row.bytes / max) * 100));
    return `
      <div class="bar-row">
        <span>${row.month}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
        <span class="muted">${row.bytesHuman}</span>
      </div>
    `;
  }).join('');

  $('projectList').innerHTML = summary.byProject.slice(0, 12).map((row) => `
    <div class="project-item" data-cwd="${escapeHtml(row.cwd)}">
      <div>
        <div class="project-path" title="${escapeHtml(row.cwd)}">${escapeHtml(row.cwd)}</div>
        <div class="project-meta">${row.files} 个 session · 可归档 ${row.archiveCandidateBytesHuman}${row.exists ? '' : ' · 路径不存在'}</div>
      </div>
      <strong>${row.bytesHuman}</strong>
    </div>
  `).join('');
  $('projectList').querySelectorAll('.project-item').forEach((item) => {
    item.addEventListener('click', () => loadProjectDetail(item.dataset.cwd));
  });
}

function applyFilters() {
  if (!scanData) return;
  const project = $('projectFilter').value;
  const month = $('monthFilter').value;
  const status = $('statusFilter').value;
  const search = $('searchInput').value.trim().toLowerCase();
  visibleSessions = scanData.sessions.filter((session) => {
    if (project && (session.cwd || '(unknown project)') !== project) return false;
    if (month && session.month !== month) return false;
    if (status && session.recommendation !== status) return false;
    if (search) {
      const haystack = `${session.title} ${session.sessionId} ${session.cwd} ${session.path}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
  renderRows();
}

function renderRows() {
  $('rowCount').textContent = `${visibleSessions.length} 条`;
  if (visibleSessions.length === 0) {
    $('sessionRows').innerHTML = '<tr><td colspan="7" class="empty-table">当前筛选条件下没有 session。</td></tr>';
    return;
  }
  $('sessionRows').innerHTML = visibleSessions.slice(0, 600).map((session) => `
    <tr class="${session.size >= 100 * 1024 * 1024 ? 'large-row' : ''}">
      <td><span class="badge ${session.recommendation}">${statusText(session.recommendation)}</span></td>
      <td>
        <div>${escapeHtml(session.title || '(无标题)')}</div>
        <div class="mono muted">${escapeHtml(session.sessionId || '(unknown id)')}</div>
        <div class="mono muted">${escapeHtml(session.relativePath)}</div>
      </td>
      <td>
        <button class="action-link project-open" data-cwd="${escapeHtml(session.cwd || '(unknown project)')}" title="${escapeHtml(session.cwd || '')}">${escapeHtml(session.cwd || '(unknown project)')}</button>
        <div class="muted">${session.cwdExists ? '路径存在' : '路径不存在或未知'}</div>
      </td>
      <td>${session.day || '-'}<br><span class="muted">${session.relevantTime ? new Date(session.relevantTime).toLocaleString() : '-'}</span></td>
      <td class="number-cell">${session.sizeHuman}</td>
      <td>${escapeHtml(session.reasons.length ? session.reasons.join('；') : '超过保留期且未发现活跃信号')}</td>
      <td><button class="action-link detail-open" data-path="${escapeHtml(session.path)}">查看详情</button></td>
    </tr>
  `).join('');
  $('sessionRows').querySelectorAll('.detail-open').forEach((button) => {
    button.addEventListener('click', () => loadSessionDetail(button.dataset.path));
  });
  $('sessionRows').querySelectorAll('.project-open').forEach((button) => {
    button.addEventListener('click', () => loadProjectDetail(button.dataset.cwd));
  });
}

async function loadScan() {
  setScanUi('scanning');
  try {
    if (demoMode) {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      scanData = structuredClone(demoScanData);
    } else {
      const response = await fetch('/api/scan');
      if (!response.ok) throw new Error(await response.text());
      scanData = await response.json();
    }
    renderSummary(scanData.summary);
    renderBars(scanData.summary);
    fillSelect($('projectFilter'), scanData.summary.byProject.map((row) => row.cwd), '全部项目');
    fillSelect($('monthFilter'), scanData.summary.byMonth.map((row) => row.month), '全部月份');
    applyFilters();
    $('projectDetail').innerHTML = '<div class="empty-state">选择一个项目查看该项目下最大的 session。</div>';
    $('sessionDetail').innerHTML = '<div class="empty-state">选择一个 session 后查看内容分析、瘦身、备份和占用状态。</div>';
    setScanUi('ready', scanData.summary);
  } catch (error) {
    toast(`扫描失败：${error.message}`);
    setScanUi(hasScanned ? 'ready' : 'idle', scanData?.summary);
  }
}

async function archiveVisible() {
  if (!scanData) {
    toast('请先扫描 sessions。');
    return;
  }
  const candidates = visibleSessions.filter((session) => session.recommendation === 'archive_candidate' && session.sessionId);
  if (candidates.length === 0) {
    toast('当前筛选结果没有可归档 session。');
    return;
  }
  const totalBytes = candidates.reduce((sum, session) => sum + session.size, 0);
  const totalHuman = candidates.length === 1 ? candidates[0].sizeHuman : `${(totalBytes / 1024 / 1024).toFixed(1)} MB`;
  const ok = window.confirm(`将归档 ${candidates.length} 个 session，约 ${totalHuman}。\n\n归档前服务端会重新扫描并跳过变为活跃的文件。继续？`);
  if (!ok) return;
  if (demoMode) {
    toast('演示模式不会执行真实归档。');
    return;
  }
  const response = await fetch('/api/archive', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: 'ARCHIVE', sessionIds: candidates.map((session) => session.sessionId) })
  });
  const body = await response.json();
  if (!response.ok) {
    toast(`归档失败：${body.error || response.statusText}`);
    return;
  }
  const archived = body.results.filter((row) => row.status === 'archived').length;
  toast(`已归档 ${archived} 个 session。`);
  await loadScan();
}

function renderProjectDetail(body) {
  const largest = body.sessions[0];
  const rows = body.sessions.slice(0, 40).map((session) => {
    const share = body.totalBytes ? ((session.size / body.totalBytes) * 100).toFixed(1) : '0.0';
    return `
      <tr class="${session.size >= body.largeThresholdBytes ? 'large-row' : ''}">
        <td>${session.sizeHuman}<br><span class="muted">${share}%</span></td>
        <td>
          <div>${escapeHtml(session.title || '(无标题)')}</div>
          <div class="mono muted">${escapeHtml(session.sessionId || '')}</div>
          <div class="mono muted">${escapeHtml(session.relativePath)}</div>
        </td>
        <td><span class="badge ${session.recommendation}">${statusText(session.recommendation)}</span></td>
        <td><button class="action-link project-session-detail" data-path="${escapeHtml(session.path)}">分析</button></td>
      </tr>
    `;
  }).join('');
  $('projectDetail').innerHTML = `
    <div><strong>${escapeHtml(body.cwd)}</strong></div>
    <div class="muted">${body.sessions.length} 个 session · 总大小 ${body.totalBytesHuman}</div>
    ${largest ? `<div class="analysis-section">最大文件：${largest.sizeHuman} · ${escapeHtml(largest.relativePath)}</div>` : ''}
    <div class="analysis-section">
      <table class="mini-table">
        <thead><tr><th>大小</th><th>Session</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
  $('projectDetail').querySelectorAll('.project-session-detail').forEach((button) => {
    button.addEventListener('click', () => loadSessionDetail(button.dataset.path));
  });
}

async function loadProjectDetail(cwd) {
  if (!cwd) return;
  $('projectDetail').textContent = '加载项目详情...';
  if (demoMode) {
    const sessions = demoScanData.sessions
      .filter((session) => (session.cwd || '(unknown project)') === cwd)
      .sort((a, b) => b.size - a.size);
    const totalBytes = sessions.reduce((sum, session) => sum + session.size, 0);
    const project = demoScanData.summary.byProject.find((row) => row.cwd === cwd);
    renderProjectDetail({
      cwd,
      totalBytes,
      totalBytesHuman: project?.bytesHuman || '0 B',
      largeThresholdBytes: 100 * 1024 * 1024,
      sessions
    });
    return;
  }
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(cwd)}/sessions`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || response.statusText);
    renderProjectDetail(body);
  } catch (error) {
    $('projectDetail').textContent = `加载失败：${error.message}`;
  }
}

function renderCountPills(rows) {
  if (!rows || rows.length === 0) return '<span class="muted">无</span>';
  return `<div class="pill-list">${rows.map((row) => `<span class="pill">${escapeHtml(row.name)}: ${row.count}</span>`).join('')}</div>`;
}

function setDetailTab(tabName) {
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tabName;
  });
}

function renderSessionAnalysis(detail, deepJob = null) {
  const aggregate = detail.aggregate;
  const windows = detail.windows || [];
  const blocks = aggregate.largeBlocks || [];
  $('sessionDetail').innerHTML = `
    <div class="session-heading">
      <div>
        <strong>${escapeHtml(detail.file.path)}</strong>
        <div class="muted">${detail.file.sizeHuman} · ${new Date(detail.file.mtime).toLocaleString()} · ${detail.mode === 'quick' ? '快速采样' : '深度分析'}</div>
      </div>
    </div>
    <div class="tabs" role="tablist">
      <button class="tab-button active" data-tab="analysis">分析</button>
      <button class="tab-button" data-tab="compact">瘦身</button>
      <button class="tab-button" data-tab="backups">备份</button>
      <button class="tab-button" data-tab="locks">占用</button>
    </div>
    <div class="muted detail-status" id="compactStatus">默认只预览或生成副本；替换原文件要求 session 未被 Codex 打开。</div>
    <div class="tab-panel" data-panel="analysis">
      <div class="analysis-section">
        <h3>可疑膨胀原因</h3>
        <ul class="cause-list">${detail.inferredCauses.map((cause) => `<li>${escapeHtml(cause)}</li>`).join('')}</ul>
      </div>
      <div class="analysis-section">
        <h3>内容类型占比</h3>
        ${renderCountPills(aggregate.typeCounts)}
      </div>
      <div class="analysis-section">
        <h3>Payload 类型</h3>
        ${renderCountPills(aggregate.payloadTypeCounts)}
      </div>
      <div class="analysis-section">
        <h3>大块内容信号</h3>
        <div class="pill-list">
          <span class="pill">input_text: ${aggregate.featureCounts.inputText}</span>
          <span class="pill">base64-like: ${aggregate.featureCounts.base64LikeData}</span>
          <span class="pill">image-like: ${aggregate.featureCounts.imageLikeData}</span>
          <span class="pill">large lines: ${aggregate.featureCounts.largeLines}</span>
          <span class="pill">token_count: ${aggregate.featureCounts.tokenCounts}</span>
        </div>
      </div>
      ${windows.length ? `<div class="analysis-section"><h3>采样窗口</h3>${renderCountPills(windows.map((row) => ({ name: `${row.name} @ ${row.startHuman}`, count: row.lines })))}</div>` : ''}
      ${blocks.length ? `
        <div class="analysis-section">
          <h3>大块内容 Top ${blocks.length}</h3>
          <div class="table-scroll compact-table">
            <table class="mini-table">
              <thead><tr><th>大小</th><th>类型</th><th>标记</th><th>片段</th></tr></thead>
              <tbody>${blocks.map((block) => `
                <tr>
                  <td class="number-cell">${block.bytesHuman}</td>
                  <td>${escapeHtml(block.type || '')}</td>
                  <td>${escapeHtml((block.flags || []).join(', '))}</td>
                  <td class="snippet" title="${escapeHtml(block.snippet)}">${escapeHtml(block.snippet)}</td>
                </tr>
              `).join('')}</tbody>
            </table>
          </div>
        </div>
      ` : ''}
      <div class="analysis-section action-row">
        <button id="deepAnalyzeBtn" class="primary">${deepJob ? '刷新深度分析状态' : '启动深度分析'}</button>
        <button id="cancelDeepAnalyzeBtn">取消深度分析</button>
        <span class="muted" id="deepStatus">${deepJob ? `${deepJob.status} ${deepJob.progress?.percent || 0}%` : '深度分析会流式读取整个文件，需手动触发。'}</span>
      </div>
    </div>
    <div class="tab-panel" data-panel="compact" hidden>
      <div class="analysis-section action-row">
        <button id="compactPreviewBtn">瘦身预览</button>
        <button id="compactCopyBtn">生成瘦身副本</button>
        <button id="replaceCompactBtn" class="danger">替换原文件</button>
      </div>
      <div id="compactState" class="analysis-section muted">正在读取瘦身/备份状态...</div>
      <div id="compactResult"></div>
    </div>
    <div class="tab-panel" data-panel="backups" hidden>
      <div class="analysis-section action-row">
        <button id="restoreBackupBtn">刷新备份记录</button>
      </div>
      <div id="backupRecords" class="analysis-section muted">正在读取备份记录...</div>
    </div>
    <div class="tab-panel" data-panel="locks" hidden>
      <div class="analysis-section action-row">
        <button id="checkLocksBtn">检测占用</button>
      </div>
      <div id="lockResult" class="analysis-section muted">尚未检测占用。</div>
    </div>
  `;
  $('sessionDetail').querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => setDetailTab(button.dataset.tab));
  });
  $('deepAnalyzeBtn').addEventListener('click', () => {
    if (activeDeepJob) pollDeepJob(activeDeepJob);
    else startDeepAnalysis();
  });
  $('cancelDeepAnalyzeBtn').addEventListener('click', cancelDeepAnalysis);
  $('checkLocksBtn').addEventListener('click', checkLocks);
  $('compactPreviewBtn').addEventListener('click', compactPreview);
  $('compactCopyBtn').addEventListener('click', compactCopy);
  $('replaceCompactBtn').addEventListener('click', replaceWithCompact);
  $('restoreBackupBtn').addEventListener('click', loadBackupRecords);
  loadCompactState();
  loadBackupRecords();
}

async function loadSessionDetail(sessionPath) {
  selectedSessionPath = sessionPath;
  activeDeepJob = null;
  $('sessionDetail').textContent = '快速分析中...';
  if (demoMode) {
    renderSessionAnalysis({ ...structuredClone(demoDetail), file: { ...demoDetail.file, path: sessionPath } });
    return;
  }
  try {
    const response = await fetch(`/api/session/detail?path=${encodeURIComponent(sessionPath)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || response.statusText);
    renderSessionAnalysis(body);
  } catch (error) {
    $('sessionDetail').textContent = `分析失败：${error.message}`;
  }
}

function renderCompactState(state) {
  $('compactState').innerHTML = `
    <table class="mini-table">
      <tbody>
        <tr><th>原文件</th><td class="mono">${escapeHtml(state.originalPath)}</td></tr>
        <tr>
          <th>瘦身副本</th>
          <td class="mono">${escapeHtml(state.compactedPath)}<br><span class="muted">${state.compactedExists ? `存在 · ${state.compactedBytesHuman} · ${new Date(state.compactedMtime).toLocaleString()}` : '不存在'}</span></td>
        </tr>
        <tr>
          <th>备份文件</th>
          <td class="mono">${escapeHtml(state.backupPath)}<br><span class="muted">${state.backupExists ? `存在 · ${state.backupBytesHuman} · ${new Date(state.backupMtime).toLocaleString()}` : '不存在'}</span></td>
        </tr>
      </tbody>
    </table>
  `;
}

async function loadCompactState() {
  if (!selectedSessionPath) return;
  if (demoMode) {
    renderCompactState({
      originalPath: selectedSessionPath,
      compactedPath: selectedSessionPath.replace('/sessions/', '/session_compacted/'),
      compactedExists: true,
      compactedBytesHuman: '118 MB',
      compactedMtime: '2026-07-11T09:35:00.000Z',
      backupPath: selectedSessionPath.replace('/sessions/', '/session_backups/'),
      backupExists: true,
      backupBytesHuman: '5.0 GB',
      backupMtime: '2026-07-11T09:32:00.000Z'
    });
    return;
  }
  const response = await fetch(`/api/session/compact-state?path=${encodeURIComponent(selectedSessionPath)}`);
  const body = await response.json();
  if (!response.ok) {
    $('compactState').textContent = `读取备份状态失败：${body.error || response.statusText}`;
    return;
  }
  renderCompactState(body);
}

function backupSourceText(source) {
  return {
    local_backup: '本机备份',
    reconciled_backup: '补录备份',
    external_backup: '外部备份',
    imported_backup: '导入备份'
  }[source] || source || '未知';
}

function renderBackupRecords(body) {
  const records = body.records || [];
  $('backupRecords').innerHTML = `
    <h3>备份记录</h3>
    <div class="backup-actions">
      <button id="reconcileBackupsBtn">扫描补录历史备份</button>
      <label>登记外部备份路径
        <input id="externalBackupPath" class="path-input" placeholder="/Volumes/Backup/session.jsonl">
      </label>
      <button id="registerExternalBackupBtn">登记</button>
      <label>从指定路径导入
        <input id="importBackupPath" class="path-input" placeholder="/Volumes/Backup/session.jsonl">
      </label>
      <button id="importBackupBtn">导入</button>
    </div>
    ${records.length ? `
      <table class="mini-table">
        <thead><tr><th>来源</th><th>路径</th><th>大小</th><th>sha256</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${records.map((record) => {
          const filePath = record.backupPath || record.externalPath || '';
          const exists = record.file?.exists;
          return `
            <tr class="${exists ? '' : 'missing-row'}">
              <td>${escapeHtml(backupSourceText(record.source))}<br><span class="muted">${record.createdAt ? new Date(record.createdAt).toLocaleString() : '-'}</span></td>
              <td class="mono snippet" title="${escapeHtml(filePath)}">${escapeHtml(filePath)}</td>
              <td>${record.sizeHuman || record.file?.sizeHuman || '-'}</td>
              <td class="mono">${escapeHtml((record.sha256 || '').slice(0, 16))}</td>
              <td>${exists ? '可用' : '文件不可用'}</td>
              <td>${exists ? `<button class="action-link restore-record" data-record-id="${escapeHtml(record.recordId)}" data-source="${escapeHtml(backupSourceText(record.source))}" data-size="${escapeHtml(record.sizeHuman || record.file?.sizeHuman || '-')}" data-sha="${escapeHtml(record.sha256 || '')}" data-path="${escapeHtml(filePath)}">恢复</button>` : '<span class="muted">不可恢复</span>'}</td>
            </tr>
          `;
        }).join('')}</tbody>
      </table>
    ` : '<div class="muted">还没有备份记录。可以先扫描补录历史备份，或登记/导入外部备份。</div>'}
  `;
  $('reconcileBackupsBtn').addEventListener('click', reconcileBackups);
  $('registerExternalBackupBtn').addEventListener('click', registerExternalBackup);
  $('importBackupBtn').addEventListener('click', importBackup);
  $('backupRecords').querySelectorAll('.restore-record').forEach((button) => {
    button.addEventListener('click', () => restoreBackupRecord(button.dataset));
  });
}

async function loadBackupRecords() {
  if (!selectedSessionPath) return;
  if (demoMode) {
    renderBackupRecords({
      originalPath: selectedSessionPath,
      records: [
        {
          recordId: 'demo-local-backup',
          source: 'local_backup',
          backupPath: selectedSessionPath.replace('/sessions/', '/session_backups/'),
          sizeHuman: '5.0 GB',
          sha256: '0b9f9ad0a97f5b0ccba5e9d1f1a109bd',
          createdAt: '2026-07-11T09:32:00.000Z',
          file: { exists: true, sizeHuman: '5.0 GB' }
        },
        {
          recordId: 'demo-external-backup',
          source: 'external_backup',
          externalPath: '/Volumes/DemoBackup/codex/movie-aigc-original.jsonl',
          sizeHuman: '5.0 GB',
          sha256: '0b9f9ad0a97f5b0ccba5e9d1f1a109bd',
          createdAt: '2026-07-11T10:00:00.000Z',
          file: { exists: false }
        }
      ]
    });
    return;
  }
  const response = await fetch(`/api/session/backup-records?path=${encodeURIComponent(selectedSessionPath)}`);
  const body = await response.json();
  if (!response.ok) {
    $('backupRecords').textContent = `读取备份记录失败：${body.error || response.statusText}`;
    return;
  }
  renderBackupRecords(body);
}

async function startDeepAnalysis() {
  if (!selectedSessionPath) return;
  if (demoMode) {
    renderSessionAnalysis({ ...structuredClone(demoDetail), mode: 'deep', file: { ...demoDetail.file, path: selectedSessionPath } }, { status: 'done', progress: { percent: 100 } });
    toast('演示模式已展示深度分析完成状态。');
    return;
  }
  const ok = window.confirm('深度分析会读取整个 session 文件。5GB 文件可能需要较长时间，但不会修改文件。继续？');
  if (!ok) return;
  const response = await fetch('/api/session/deep-analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: selectedSessionPath })
  });
  const body = await response.json();
  if (!response.ok) {
    toast(`启动失败：${body.error || response.statusText}`);
    return;
  }
  activeDeepJob = body.jobId;
  pollDeepJob(activeDeepJob);
}

async function pollDeepJob(jobId) {
  const response = await fetch(`/api/session/deep-analyze/${jobId}`);
  const body = await response.json();
  if (!response.ok) {
    toast(`深度分析状态获取失败：${body.error || response.statusText}`);
    return;
  }
  const statusEl = $('deepStatus');
  if (statusEl) statusEl.textContent = `${body.status} ${body.progress?.percent || 0}%`;
  if (body.status === 'done' && body.result) {
    renderSessionAnalysis(body.result, body);
    activeDeepJob = null;
    return;
  }
  if (body.status === 'error' || body.status === 'cancelled') {
    toast(`深度分析${body.status === 'cancelled' ? '已取消' : `失败：${body.error}`}`);
    activeDeepJob = null;
    return;
  }
  window.setTimeout(() => pollDeepJob(jobId), 1500);
}

async function cancelDeepAnalysis() {
  if (!activeDeepJob) {
    toast('当前没有运行中的深度分析。');
    return;
  }
  await fetch(`/api/session/deep-analyze/${activeDeepJob}/cancel`, { method: 'POST' });
  toast('已请求取消深度分析。');
}

function renderLocks(body) {
  const locks = body.locks || [];
  if (locks.length === 0) {
    $('lockResult').innerHTML = '<div class="analysis-section muted">当前没有进程占用这个 session。</div>';
    return;
  }
  $('lockResult').innerHTML = `
    <div class="analysis-section">
      <h3>占用进程</h3>
      <table class="mini-table">
        <thead><tr><th>PID</th><th>命令</th><th>FD</th><th>模式</th><th>操作</th></tr></thead>
        <tbody>${locks.map((lock) => `
          <tr class="${lock.writable ? 'lock-write-row' : ''}">
            <td class="mono">${lock.pid}</td>
            <td>${escapeHtml(lock.command)}</td>
            <td class="mono">${escapeHtml(lock.fd)}</td>
            <td>${lock.writable ? '写入/读写' : escapeHtml(lock.mode)}</td>
            <td>
              ${lock.command === 'codex' ? `
                <button class="action-link release-lock" data-pid="${lock.pid}" data-signal="TERM">TERM</button>
                <button class="action-link release-lock danger-link" data-pid="${lock.pid}" data-signal="KILL">KILL</button>
              ` : '<span class="muted">非 codex，不释放</span>'}
            </td>
          </tr>
        `).join('')}</tbody>
      </table>
    </div>
  `;
  $('lockResult').querySelectorAll('.release-lock').forEach((button) => {
    button.addEventListener('click', () => releaseLock(Number(button.dataset.pid), button.dataset.signal));
  });
}

async function checkLocks() {
  if (!selectedSessionPath) return;
  $('compactStatus').textContent = '检测占用中...';
  if (demoMode) {
    $('compactStatus').textContent = '演示模式：检测到 2 个占用句柄。';
    renderLocks({
      locks: [
        { pid: 34977, command: 'codex', fd: '30w', mode: 'write', writable: true, path: selectedSessionPath },
        { pid: 34977, command: 'codex', fd: '35r', mode: 'read', writable: false, path: selectedSessionPath }
      ]
    });
    return;
  }
  const response = await fetch(`/api/session/locks?path=${encodeURIComponent(selectedSessionPath)}`);
  const body = await response.json();
  if (!response.ok) {
    $('compactStatus').textContent = `检测失败：${body.error || response.statusText}`;
    return;
  }
  $('compactStatus').textContent = body.locks.length ? `检测到 ${body.locks.length} 个占用句柄。` : '当前没有占用。';
  renderLocks(body);
}

async function releaseLock(pid, signal) {
  if (!selectedSessionPath) return;
  const confirmText = signal === 'KILL' ? 'KILL CODEX PROCESS' : 'TERMINATE CODEX PROCESS';
  const promptText = signal === 'KILL'
    ? `KILL 会强制结束 codex 进程 ${pid}。只有 TERM 后仍占用时才建议使用。继续？`
    : `将向 codex 进程 ${pid} 发送 TERM。继续？`;
  if (!window.confirm(promptText)) return;
  if (demoMode) {
    $('compactStatus').textContent = `演示模式：已模拟发送 ${signal} 到 PID ${pid}。`;
    window.setTimeout(() => {
      $('lockResult').innerHTML = '<div class="analysis-section muted">演示模式：占用已模拟释放。</div>';
    }, 600);
    return;
  }
  const response = await fetch('/api/session/release-lock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: selectedSessionPath, pid, signal, confirm: confirmText })
  });
  const body = await response.json();
  if (!response.ok) {
    $('compactStatus').textContent = `释放失败：${body.error || response.statusText}`;
    return;
  }
  $('compactStatus').textContent = `已发送 ${signal} 到 PID ${pid}，稍后重新检测。`;
  window.setTimeout(checkLocks, 2200);
}

function renderCompactResult(result) {
  const fields = (result.fields || []).slice(0, 12);
  const largeLines = (result.largeLines || []).slice(0, 8);
  $('compactResult').innerHTML = `
    <div class="analysis-section">
      <div class="pill-list">
        <span class="pill">处理行: ${result.processedLines}</span>
        <span class="pill">替换行: ${result.replacedLines}</span>
        <span class="pill">替换字段: ${result.replacements}</span>
        <span class="pill">预计减少: ${result.originalBytesRemovedHuman}</span>
        ${result.outputPath ? `<span class="pill">副本: ${escapeHtml(result.outputBytesHuman)}</span>` : ''}
      </div>
    </div>
    ${fields.length ? `
      <div class="analysis-section">
        <h3>字段替换样本</h3>
        <table class="mini-table">
          <thead><tr><th>字段</th><th>原因</th><th>原大小</th></tr></thead>
          <tbody>${fields.map((field) => `
            <tr><td class="mono">${escapeHtml(field.path)}</td><td>${escapeHtml(field.reason)}</td><td>${field.originalBytesHuman}</td></tr>
          `).join('')}</tbody>
        </table>
      </div>
    ` : ''}
    ${largeLines.length ? `
      <div class="analysis-section">
        <h3>超长行替换样本</h3>
        <table class="mini-table">
          <thead><tr><th>原大小</th><th>sha256</th><th>片段</th></tr></thead>
          <tbody>${largeLines.map((line) => `
            <tr><td>${line.originalBytesHuman}</td><td class="mono">${escapeHtml(line.sha256.slice(0, 16))}</td><td class="snippet">${escapeHtml(line.snippet)}</td></tr>
          `).join('')}</tbody>
        </table>
      </div>
    ` : ''}
    ${result.outputPath ? `<div class="analysis-section muted">瘦身副本：${escapeHtml(result.outputPath)}</div>` : ''}
  `;
}

async function compactPreview() {
  if (!selectedSessionPath) return;
  $('compactStatus').textContent = '瘦身预览中...';
  if (demoMode) {
    $('compactStatus').textContent = '演示预览完成，未写入文件。';
    renderCompactResult(demoCompactPreview);
    return;
  }
  const response = await fetch('/api/session/compact-preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: selectedSessionPath })
  });
  const body = await response.json();
  if (!response.ok) {
    $('compactStatus').textContent = `预览失败：${body.error || response.statusText}`;
    return;
  }
  $('compactStatus').textContent = '预览完成，未写入文件。';
  renderCompactResult(body);
}

async function compactCopy() {
  if (!selectedSessionPath) return;
  const ok = window.confirm('将生成瘦身副本到 ~/.codex/session_compacted，不修改原文件。继续？');
  if (!ok) return;
  if (demoMode) {
    $('compactStatus').textContent = '演示模式：已模拟生成瘦身副本。';
    renderCompactResult({ ...demoCompactPreview, outputPath: selectedSessionPath.replace('/sessions/', '/session_compacted/'), outputBytesHuman: '118 MB' });
    await loadCompactState();
    return;
  }
  $('compactStatus').textContent = '正在生成瘦身副本...';
  const response = await fetch('/api/session/compact-copy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: selectedSessionPath })
  });
  const body = await response.json();
  if (!response.ok) {
    $('compactStatus').textContent = `生成失败：${body.error || response.statusText}`;
    return;
  }
  $('compactStatus').textContent = '瘦身副本已生成。';
  renderCompactResult(body);
  await loadCompactState();
}

async function replaceWithCompact() {
  if (!selectedSessionPath) return;
  const ok = window.confirm('将用瘦身副本替换原 session。原文件会先移动到 ~/.codex/session_backups。若 session 正被 Codex 打开，服务端会拒绝。继续？');
  if (!ok) return;
  if (demoMode) {
    $('compactStatus').textContent = '演示模式不会替换真实文件。';
    return;
  }
  const response = await fetch('/api/session/replace-with-compact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: selectedSessionPath, confirm: 'REPLACE WITH COMPACT' })
  });
  const body = await response.json();
  if (!response.ok) {
    $('compactStatus').textContent = `替换失败：${body.error || response.statusText}`;
    return;
  }
  $('compactStatus').textContent = `已替换，备份在 ${body.backupPath}`;
  await loadCompactState();
  await loadBackupRecords();
}

async function restoreBackup() {
  if (!selectedSessionPath) return;
  const ok = window.confirm('将从 ~/.codex/session_backups 恢复原始 session。当前文件会移到 .before-restore-*。若 session 正被 Codex 打开，服务端会拒绝。继续？');
  if (!ok) return;
  const response = await fetch('/api/session/restore-backup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: selectedSessionPath, confirm: 'RESTORE BACKUP' })
  });
  const body = await response.json();
  if (!response.ok) {
    $('compactStatus').textContent = `恢复失败：${body.error || response.statusText}`;
    return;
  }
  $('compactStatus').textContent = `已恢复：${body.restoredPath}`;
  await loadCompactState();
}

async function reconcileBackups() {
  if (!selectedSessionPath) return;
  const ok = window.confirm('将扫描 ~/.codex/session_backups 并补录尚未登记的 JSONL 备份。大文件可能需要计算校验值。继续？');
  if (!ok) return;
  if (demoMode) {
    $('compactStatus').textContent = '演示模式：已模拟补录 1 条历史备份。';
    await loadBackupRecords();
    return;
  }
  $('compactStatus').textContent = '正在扫描补录备份记录...';
  const response = await fetch('/api/session/backup-records/reconcile', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  const body = await response.json();
  if (!response.ok) {
    $('compactStatus').textContent = `补录失败：${body.error || response.statusText}`;
    return;
  }
  $('compactStatus').textContent = `补录完成：新增 ${body.appended} 条，已有 ${body.skippedExisting} 条。`;
  await loadBackupRecords();
}

async function registerExternalBackup() {
  if (!selectedSessionPath) return;
  const externalPath = $('externalBackupPath')?.value.trim();
  if (!externalPath) {
    toast('请输入外部备份文件路径。');
    return;
  }
  const ok = window.confirm(`登记外部备份路径，不会复制或删除该文件：\n${externalPath}`);
  if (!ok) return;
  if (demoMode) {
    $('compactStatus').textContent = '演示模式：已模拟登记外部备份路径。';
    await loadBackupRecords();
    return;
  }
  $('compactStatus').textContent = '正在登记外部备份...';
  const response = await fetch('/api/session/backup-records/register-external', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: selectedSessionPath, externalPath })
  });
  const body = await response.json();
  if (!response.ok) {
    $('compactStatus').textContent = `登记失败：${body.error || response.statusText}`;
    return;
  }
  $('compactStatus').textContent = body.appended ? '外部备份已登记。' : '这条外部备份记录已存在。';
  await loadBackupRecords();
}

async function importBackup() {
  if (!selectedSessionPath) return;
  const sourcePath = $('importBackupPath')?.value.trim();
  if (!sourcePath) {
    toast('请输入要导入的备份文件路径。');
    return;
  }
  const ok = window.confirm(`将复制这个备份到 ~/.codex/session_backups/imported，外部原文件不会被删除：\n${sourcePath}`);
  if (!ok) return;
  if (demoMode) {
    $('compactStatus').textContent = '演示模式：已模拟导入备份。';
    await loadBackupRecords();
    return;
  }
  $('compactStatus').textContent = '正在导入备份...';
  const response = await fetch('/api/session/backup-records/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: selectedSessionPath, sourcePath })
  });
  const body = await response.json();
  if (!response.ok) {
    $('compactStatus').textContent = `导入失败：${body.error || response.statusText}`;
    return;
  }
  $('compactStatus').textContent = body.appended ? '备份已导入。' : '这条导入备份记录已存在。';
  await loadBackupRecords();
}

async function restoreBackupRecord(dataset) {
  if (!selectedSessionPath) return;
  const ok = window.confirm([
    '将按这条备份记录恢复 session。服务端会先检测 Codex 是否仍占用该 session。',
    '',
    `来源：${dataset.source}`,
    `路径：${dataset.path}`,
    `大小：${dataset.size}`,
    `sha256：${dataset.sha || '(unknown)'}`,
    '',
    '当前 session 文件会先移动到 .before-restore-*，备份文件本身会保留。继续？'
  ].join('\n'));
  if (!ok) return;
  if (demoMode) {
    $('compactStatus').textContent = '演示模式不会恢复或覆盖真实文件。';
    return;
  }
  $('compactStatus').textContent = '正在按备份记录恢复...';
  const response = await fetch('/api/session/restore-backup-record', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ recordId: dataset.recordId, confirm: 'RESTORE BACKUP RECORD' })
  });
  const body = await response.json();
  if (!response.ok) {
    $('compactStatus').textContent = `恢复失败：${body.error || response.statusText}`;
    return;
  }
  $('compactStatus').textContent = `已恢复：${body.restoredPath}`;
  await loadCompactState();
  await loadBackupRecords();
}

async function deleteArchives() {
  if (!scanData) {
    toast('请先扫描 sessions。');
    return;
  }
  const archives = scanData?.summary?.archives;
  if (!archives || archives.deleteCandidateFiles === 0) {
    toast('当前没有超过保留期的归档文件。');
    return;
  }
  const ok = window.confirm(`将删除 ${archives.deleteCandidateFiles} 个超期归档，约 ${archives.deleteCandidateBytesHuman}。\n\n只会删除 archived_sessions 中已归档且超过 180 天的压缩文件。继续？`);
  if (!ok) return;
  if (demoMode) {
    toast('演示模式不会删除真实归档。');
    return;
  }
  const response = await fetch('/api/delete-archives', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: 'DELETE ARCHIVES' })
  });
  const body = await response.json();
  if (!response.ok) {
    toast(`删除归档失败：${body.error || response.statusText}`);
    return;
  }
  const deleted = body.results.filter((row) => row.status === 'deleted').length;
  toast(`已删除 ${deleted} 个超期归档。`);
  await loadScan();
}

['projectFilter', 'monthFilter', 'statusFilter', 'searchInput'].forEach((id) => {
  $(id).addEventListener('input', applyFilters);
});
$('refreshBtn').addEventListener('click', loadScan);
$('welcomeScanBtn').addEventListener('click', loadScan);
$('archiveVisibleBtn').addEventListener('click', archiveVisible);
$('deleteArchivesBtn').addEventListener('click', deleteArchives);

setScanUi('idle');
