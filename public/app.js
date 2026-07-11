let scanData = null;
let visibleSessions = [];
let selectedSessionPath = null;
const $ = (id) => document.getElementById(id);
const demoMode = new URLSearchParams(location.search).get('demo') === '1';
const demoLargePath = '/Users/demo/.codex/sessions/2026/05/06/rollout-demo-movie-aigc-large.jsonl';

const demoScanData = {
  summary: {
    sessionsDir: '/Users/demo/.codex/sessions',
    generatedAt: '2026-07-11T09:30:00.000Z',
    totals: { bytesHuman: '6.3 GB', files: 128, archiveCandidateBytesHuman: '5.4 GB', manualReviewFiles: 3 },
    archives: { deleteCandidateBytesHuman: '840 MB', deleteCandidateFiles: 9 },
    byMonth: [
      { month: '2026-07', bytes: 420 * 1024 * 1024, bytesHuman: '420 MB' },
      { month: '2026-06', bytes: 380 * 1024 * 1024, bytesHuman: '380 MB' },
      { month: '2026-05', bytes: 5.5 * 1024 * 1024 * 1024, bytesHuman: '5.5 GB' }
    ],
    byProject: [
      { cwd: '/Users/demo/aiCode/movie.aigc', files: 19, bytes: 5.1 * 1024 * 1024 * 1024, bytesHuman: '5.1 GB', archiveCandidateBytesHuman: '4.9 GB', exists: true },
      { cwd: '/Users/demo/aiCode/site-builder', files: 42, bytes: 620 * 1024 * 1024, bytesHuman: '620 MB', archiveCandidateBytesHuman: '180 MB', exists: true },
      { cwd: '(unknown project)', files: 3, bytes: 160 * 1024 * 1024, bytesHuman: '160 MB', archiveCandidateBytesHuman: '0 B', exists: false }
    ]
  },
  sessions: [
    { recommendation: 'archive_candidate', title: 'movie.aigc 长期生成任务', sessionId: 'demo-large-session', relativePath: '2026/05/06/rollout-demo-movie-aigc-large.jsonl', path: demoLargePath, cwd: '/Users/demo/aiCode/movie.aigc', cwdExists: true, day: '2026-05-06', month: '2026-05', relevantTime: '2026-07-09T18:20:00.000Z', size: 5 * 1024 * 1024 * 1024, sizeHuman: '5.0 GB', reasons: ['超过 90 天且未发现活跃句柄', '包含疑似大块 input_text/base64 内容'] },
    { recommendation: 'protect', title: '当前 UI 优化任务', sessionId: 'demo-active-session', relativePath: '2026/07/11/rollout-demo-active.jsonl', path: '/Users/demo/.codex/sessions/2026/07/11/rollout-demo-active.jsonl', cwd: '/Users/demo/aiCode/codex-session-cleaner', cwdExists: true, day: '2026-07-11', month: '2026-07', relevantTime: '2026-07-11T09:28:00.000Z', size: 88 * 1024 * 1024, sizeHuman: '88 MB', reasons: ['今天创建', '最近更新', 'active 保护样例'] },
    { recommendation: 'manual_review', title: '(缺少元数据)', sessionId: '', relativePath: '2026/06/12/rollout-demo-unknown.jsonl', path: '/Users/demo/.codex/sessions/2026/06/12/rollout-demo-unknown.jsonl', cwd: '(unknown project)', cwdExists: false, day: '2026-06-12', month: '2026-06', relevantTime: '2026-06-12T11:00:00.000Z', size: 160 * 1024 * 1024, sizeHuman: '160 MB', reasons: ['缺少 session_meta.cwd', '需要人工确认'] }
  ]
};

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function statusText(status) {
  return { protect: '保护', archive_candidate: '可归档', manual_review: '需人工确认' }[status] || status;
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 3600);
}

function setScanUi(state, summary = null) {
  const scanning = state === 'scanning';
  const ready = state === 'ready';
  $('refreshBtn').disabled = scanning;
  $('refreshBtn').textContent = scanning ? '扫描中...' : ready ? '重新扫描' : '开始扫描';
  $('welcomeScanBtn').disabled = scanning;
  $('welcomeScanBtn').textContent = scanning ? '扫描中...' : ready ? '重新扫描 sessions' : '开始扫描 sessions';
  $('scanState').textContent = scanning ? (demoMode ? '正在加载演示数据...' : '正在只读扫描本机 session 文件...') : ready && summary ? `${demoMode ? '演示数据' : '已扫描'} ${summary.totals.files} 个 session · ${new Date(summary.generatedAt).toLocaleString()}` : (demoMode ? '演示模式：不会读取本机文件' : '等待手动扫描');
  $('workspace').hidden = !ready;
  $('welcomePanel').classList.toggle('compact', ready);
}

function fillSelect(select, values, label) {
  const current = select.value;
  select.innerHTML = `<option value="">${label}</option>`;
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
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
  $('monthBars').innerHTML = summary.byMonth.map((row) => `<div class="bar-row"><span>${row.month}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, Math.round((row.bytes / max) * 100))}%"></div></div><span class="muted">${row.bytesHuman}</span></div>`).join('');
  $('projectList').innerHTML = summary.byProject.slice(0, 12).map((row) => `<div class="project-item" data-cwd="${escapeHtml(row.cwd)}"><div><div class="project-path" title="${escapeHtml(row.cwd)}">${escapeHtml(row.cwd)}</div><div class="project-meta">${row.files} 个 session · 可归档 ${row.archiveCandidateBytesHuman}${row.exists ? '' : ' · 路径不存在'}</div></div><strong>${row.bytesHuman}</strong></div>`).join('');
  $('projectList').querySelectorAll('.project-item').forEach((item) => item.addEventListener('click', () => loadProjectDetail(item.dataset.cwd)));
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
    if (search && !`${session.title} ${session.sessionId} ${session.cwd} ${session.path}`.toLowerCase().includes(search)) return false;
    return true;
  });
  renderRows();
}

function renderRows() {
  $('rowCount').textContent = `${visibleSessions.length} 条`;
  if (!visibleSessions.length) {
    $('sessionRows').innerHTML = '<tr><td colspan="7" class="empty-table">当前筛选条件下没有 session。</td></tr>';
    return;
  }
  $('sessionRows').innerHTML = visibleSessions.slice(0, 600).map((session) => `<tr class="${session.size >= 100 * 1024 * 1024 ? 'large-row' : ''}"><td><span class="badge ${session.recommendation}">${statusText(session.recommendation)}</span></td><td><div>${escapeHtml(session.title || '(无标题)')}</div><div class="mono muted">${escapeHtml(session.sessionId || '(unknown id)')}</div><div class="mono muted">${escapeHtml(session.relativePath)}</div></td><td><button class="action-link project-open" data-cwd="${escapeHtml(session.cwd || '(unknown project)')}">${escapeHtml(session.cwd || '(unknown project)')}</button><div class="muted">${session.cwdExists ? '路径存在' : '路径不存在或未知'}</div></td><td>${session.day || '-'}<br><span class="muted">${session.relevantTime ? new Date(session.relevantTime).toLocaleString() : '-'}</span></td><td class="number-cell">${session.sizeHuman}</td><td>${escapeHtml((session.reasons || []).join('；') || '超过保留期且未发现活跃信号')}</td><td><button class="action-link detail-open" data-path="${escapeHtml(session.path)}">查看详情</button></td></tr>`).join('');
  $('sessionRows').querySelectorAll('.detail-open').forEach((button) => button.addEventListener('click', () => loadSessionDetail(button.dataset.path)));
  $('sessionRows').querySelectorAll('.project-open').forEach((button) => button.addEventListener('click', () => loadProjectDetail(button.dataset.cwd)));
}

async function loadScan() {
  setScanUi('scanning');
  try {
    if (demoMode) {
      await new Promise((resolve) => setTimeout(resolve, 250));
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
    setScanUi('idle');
  }
}

function renderProjectDetail(body) {
  const rows = body.sessions.slice(0, 40).map((session) => `<tr class="${session.size >= body.largeThresholdBytes ? 'large-row' : ''}"><td>${session.sizeHuman}</td><td><div>${escapeHtml(session.title || '(无标题)')}</div><div class="mono muted">${escapeHtml(session.relativePath)}</div></td><td><span class="badge ${session.recommendation}">${statusText(session.recommendation)}</span></td><td><button class="action-link project-session-detail" data-path="${escapeHtml(session.path)}">分析</button></td></tr>`).join('');
  $('projectDetail').innerHTML = `<div><strong>${escapeHtml(body.cwd)}</strong></div><div class="muted">${body.sessions.length} 个 session · 总大小 ${body.totalBytesHuman}</div><div class="analysis-section"><table class="mini-table"><thead><tr><th>大小</th><th>Session</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  $('projectDetail').querySelectorAll('.project-session-detail').forEach((button) => button.addEventListener('click', () => loadSessionDetail(button.dataset.path)));
}

async function loadProjectDetail(cwd) {
  $('projectDetail').textContent = '加载项目详情...';
  if (demoMode) {
    const sessions = demoScanData.sessions.filter((session) => (session.cwd || '(unknown project)') === cwd).sort((a, b) => b.size - a.size);
    const project = demoScanData.summary.byProject.find((row) => row.cwd === cwd);
    renderProjectDetail({ cwd, sessions, totalBytesHuman: project?.bytesHuman || '0 B', largeThresholdBytes: 100 * 1024 * 1024 });
    return;
  }
  const response = await fetch(`/api/projects/${encodeURIComponent(cwd)}/sessions`);
  const body = await response.json();
  if (!response.ok) { $('projectDetail').textContent = `加载失败：${body.error || response.statusText}`; return; }
  renderProjectDetail(body);
}

function renderCountPills(rows) {
  return rows?.length ? `<div class="pill-list">${rows.map((row) => `<span class="pill">${escapeHtml(row.name)}: ${row.count}</span>`).join('')}</div>` : '<span class="muted">无</span>';
}

function renderSessionAnalysis(detail) {
  const aggregate = detail.aggregate;
  $('sessionDetail').innerHTML = `<div class="session-heading"><strong>${escapeHtml(detail.file.path)}</strong><div class="muted">${detail.file.sizeHuman} · ${new Date(detail.file.mtime).toLocaleString()} · ${detail.mode === 'quick' ? '快速采样' : '深度分析'}</div></div><div class="tabs"><button class="tab-button active">分析</button><button class="tab-button">瘦身</button><button class="tab-button">备份</button><button class="tab-button">占用</button></div><div class="analysis-section"><h3>可疑膨胀原因</h3><ul class="cause-list">${(detail.inferredCauses || []).map((cause) => `<li>${escapeHtml(cause)}</li>`).join('')}</ul></div><div class="analysis-section"><h3>内容类型</h3>${renderCountPills(aggregate.typeCounts)}</div><div class="analysis-section"><h3>Payload 类型</h3>${renderCountPills(aggregate.payloadTypeCounts)}</div><div class="analysis-section"><h3>大块内容信号</h3><div class="pill-list"><span class="pill">input_text: ${aggregate.featureCounts.inputText}</span><span class="pill">base64-like: ${aggregate.featureCounts.base64LikeData}</span><span class="pill">image-like: ${aggregate.featureCounts.imageLikeData}</span><span class="pill">large lines: ${aggregate.featureCounts.largeLines}</span></div></div><div class="action-row"><button id="compactPreviewBtn" class="primary">瘦身预览</button><button id="checkLocksBtn">检测占用</button></div><div id="detailActionResult" class="analysis-section muted"></div>`;
  $('compactPreviewBtn').addEventListener('click', compactPreview);
  $('checkLocksBtn').addEventListener('click', checkLocks);
}

async function loadSessionDetail(sessionPath) {
  selectedSessionPath = sessionPath;
  $('sessionDetail').textContent = '快速分析中...';
  if (demoMode) {
    renderSessionAnalysis({ mode: 'quick', file: { path: sessionPath, sizeHuman: '5.0 GB', mtime: '2026-07-09T18:20:00.000Z' }, inferredCauses: ['单个长期 session 持续追加导致占用集中。', '采样发现大量 input_text、base64-like 和工具输出信号。'], aggregate: { typeCounts: [{ name: 'response_item', count: 42100 }, { name: 'event_msg', count: 18800 }], payloadTypeCounts: [{ name: 'message', count: 35000 }, { name: 'function_call_output', count: 6600 }], featureCounts: { inputText: 1140, base64LikeData: 92, imageLikeData: 130, largeLines: 17 } } });
    return;
  }
  const response = await fetch(`/api/session/detail?path=${encodeURIComponent(sessionPath)}`);
  const body = await response.json();
  if (!response.ok) { $('sessionDetail').textContent = `分析失败：${body.error || response.statusText}`; return; }
  renderSessionAnalysis(body);
}

async function compactPreview() {
  if (!selectedSessionPath) return;
  if (demoMode) { $('detailActionResult').textContent = '演示模式：预计可减少 4.9 GB，未写入文件。'; return; }
  $('detailActionResult').textContent = '瘦身预览中...';
  const response = await fetch('/api/session/compact-preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: selectedSessionPath }) });
  const body = await response.json();
  $('detailActionResult').textContent = response.ok ? `预览完成：处理 ${body.processedLines} 行，替换 ${body.replacements} 个字段，预计减少 ${body.originalBytesRemovedHuman}` : `预览失败：${body.error || response.statusText}`;
}

async function checkLocks() {
  if (!selectedSessionPath) return;
  if (demoMode) { $('detailActionResult').textContent = '演示模式：检测到 codex PID 34977 写句柄 30w。'; return; }
  $('detailActionResult').textContent = '检测占用中...';
  const response = await fetch(`/api/session/locks?path=${encodeURIComponent(selectedSessionPath)}`);
  const body = await response.json();
  if (!response.ok) { $('detailActionResult').textContent = `检测失败：${body.error || response.statusText}`; return; }
  $('detailActionResult').textContent = body.locks.length ? `检测到 ${body.locks.length} 个占用句柄：${body.locks.map((lock) => `${lock.command} ${lock.pid} ${lock.fd}`).join('，')}` : '当前没有占用。';
}

async function archiveVisible() { toast(demoMode ? '演示模式不会执行真实归档。' : '请在源码版本中使用完整归档确认流程。'); }
async function deleteArchives() { toast(demoMode ? '演示模式不会删除真实归档。' : '请在源码版本中使用完整删除确认流程。'); }

['projectFilter', 'monthFilter', 'statusFilter', 'searchInput'].forEach((id) => $(id).addEventListener('input', applyFilters));
$('refreshBtn').addEventListener('click', loadScan);
$('welcomeScanBtn').addEventListener('click', loadScan);
$('archiveVisibleBtn').addEventListener('click', archiveVisible);
$('deleteArchivesBtn').addEventListener('click', deleteArchives);
setScanUi('idle');
