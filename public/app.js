const $ = selector => document.querySelector(selector);
const token = $('meta[name="commitflix-token"]').content;
const state = { commits: [], selected: null, a: null, b: null, sessions: [], logId: null, loading: false, queryVersion: 0, width: 'desktop', cards: new Map(), lastDiff: null };
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6000); }
async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, { ...options, headers: { 'X-CommitFlix-Token': token, 'Content-Type': 'application/json', ...options.headers } });
  if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Request failed'); }
  return options.raw ? response : response.json();
}
function node(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
function action(fn) { return async (...args) => { try { await fn(...args); } catch (error) { toast(error.message); } }; }
function shortDate(value) { return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }

async function loadHistory(append = false) {
  const version = ++state.queryVersion;
  $('#load-more').disabled = true;
  const query = new URLSearchParams({ search: $('#search').value, ref: $('#history-ref').value || 'HEAD', skip: append ? state.commits.length : 0, limit: 60 });
  try {
    const rows = await api(`history?${query}`);
    if (version !== state.queryVersion) return;
    state.commits = append ? [...state.commits, ...rows] : rows;
    renderHistory();
    $('#load-more').hidden = rows.length < 60;
    if (!append) {
      if (rows.length) select(rows[0]);
      else { state.selected = null; $('#selected-message').textContent = 'No matching commits'; $('#selected-meta').textContent = 'Try another message search or reference.'; $('#play').disabled = true; $('#selection-index').textContent = '0 / 0'; }
    }
  } finally { if (version === state.queryVersion) $('#load-more').disabled = false; }
}

function renderHistory() {
  const fragment = document.createDocumentFragment();
  for (const commit of state.commits) {
    const row = node('button', `commit-row${state.selected?.id === commit.id ? ' active' : ''}`);
    row.dataset.sha = commit.id; row.setAttribute('aria-pressed', String(state.selected?.id === commit.id));
    if (commit.refs) row.append(node('span', 'commit-refs', commit.refs.replace(/^\(|\)$/g, '')));
    row.append(node('span', 'commit-message', commit.message));
    const meta = node('span', 'commit-meta'); meta.append(node('span', 'commit-hash', commit.short), node('span', '', shortDate(commit.date))); row.append(meta);
    row.addEventListener('click', () => select(commit)); fragment.append(row);
  }
  $('#history').replaceChildren(fragment);
  if (!state.commits.length) $('#history').append(node('p', 'error-note', 'No commits found.'));
}

function select(commit) {
  state.selected = commit;
  $('#selected-message').textContent = commit.message;
  $('#selected-meta').textContent = `${commit.short}  /  ${commit.author}  /  ${shortDate(commit.date)}`;
  $('#selection-index').textContent = `${String(state.commits.indexOf(commit) + 1).padStart(2, '0')} / ${state.commits.length}`;
  $('#play').disabled = false;
  for (const row of document.querySelectorAll('.commit-row')) { const active = row.dataset.sha === commit.id; row.classList.toggle('active', active); row.setAttribute('aria-pressed', String(active)); }
}

function pick(slot) {
  if (!state.selected) return;
  state[slot] = state.selected;
  $(`#${slot}-label`).textContent = state.selected.short;
  $(`#pick-${slot}`).title = state.selected.message;
  const ready = Boolean(state.a && state.b);
  $('#compare').disabled = !ready; $('#show-diff').disabled = !ready;
  state.lastDiff = null; $('#export').disabled = true;
}

async function play(ref) {
  setTab('preview');
  const { id } = await api('sessions', { method: 'POST', body: JSON.stringify({ ref }) });
  state.logId = id; $('#logs').open = true;
  await poll();
}

function setTab(tab) {
  $('#preview-panel').hidden = tab !== 'preview'; $('#diff-panel').hidden = tab !== 'diff';
  for (const name of ['preview', 'diff']) { $(`#${name}-tab`).classList.toggle('active', tab === name); $(`#${name}-tab`).setAttribute('aria-selected', String(tab === name)); }
}

function createCard(session) {
  const card = node('article', 'preview-card');
  const head = node('div', 'preview-head');
  const label = node('span', '', (session.sha || session.ref).slice(0, 8));
  const status = node('span', 'status', session.status);
  const link = node('a', '', '↗'); link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = 'Open preview in a new tab'; link.hidden = true;
  const stop = node('button', 'stop-button', '×'); stop.title = 'Stop preview and remove its worktree'; stop.setAttribute('aria-label', `Stop ${session.ref}`);
  stop.addEventListener('click', action(async () => { stop.disabled = true; try { await api(`sessions/${session.id}`, { method: 'DELETE' }); } finally { stop.disabled = false; } await poll(); }));
  head.append(label, status, link, stop);
  const body = node('div', 'preview-body'); card.append(head, body); $('#previews').append(card);
  return { card, label, status, link, body, mode: null };
}

function renderSessions() {
  $('#session-count').textContent = state.sessions.length;
  $('#empty-state').hidden = state.sessions.length > 0;
  const ids = new Set(state.sessions.map(s => s.id));
  for (const [id, elements] of state.cards) if (!ids.has(id)) { elements.card.remove(); state.cards.delete(id); }
  for (const session of state.sessions) {
    if (!state.cards.has(session.id)) state.cards.set(session.id, createCard(session));
    const elements = state.cards.get(session.id);
    elements.label.textContent = (session.sha || session.ref).slice(0, 8); elements.status.textContent = session.status;
    elements.link.hidden = session.status !== 'ready';
    if (session.url) elements.link.href = session.url;
    // Preserve the iframe during polling so app state and interactions survive.
    if (elements.mode !== session.status) {
      elements.mode = session.status;
      if (session.status === 'ready') {
        const frame = node('iframe'); frame.title = `Preview ${session.sha?.slice(0, 8)}`;
        frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-downloads');
        frame.src = session.url; elements.body.replaceChildren(frame);
      } else {
        const wait = node('div', `preview-wait${session.status === 'error' ? ' error' : ''}`);
        const titles = { queued: 'In the queue…', preparing: 'Opening the archive…', installing: 'Setting the scene…', starting: 'Rolling the camera…', stopping: 'Closing this chapter…', error: 'This one needs attention.' };
        wait.append(node('strong', '', titles[session.status] || session.status), node('p', '', session.status === 'error' ? 'Check the preview console below. Stop this preview after inspecting the logs.' : 'Creating a disposable checkout and preparing your app.'));
        elements.body.replaceChildren(wait);
      }
    }
  }
  if (!ids.has(state.logId)) state.logId = state.sessions[0]?.id || null;
  const buttons = state.sessions.map(session => {
    const button = node('button', session.id === state.logId ? 'active' : '', `${(session.sha || session.ref).slice(0, 8)} · ${session.status}`);
    button.addEventListener('click', () => { state.logId = session.id; renderSessions(); }); return button;
  });
  $('#log-buttons').replaceChildren(...buttons);
  const output = state.sessions.find(s => s.id === state.logId)?.logs || 'Run a preview to see its logs here.';
  if ($('#log-output').textContent !== output) { const follow = $('#log-output').scrollHeight - $('#log-output').scrollTop < $('#log-output').clientHeight + 40; $('#log-output').textContent = output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''); if (follow) $('#log-output').scrollTop = $('#log-output').scrollHeight; }
}

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try { state.sessions = await api('sessions'); renderSessions(); } finally { polling = false; }
}

async function showDiff() {
  if (!state.a || !state.b) { toast('Assign a commit to A and B first.'); return; }
  setTab('diff'); $('#diff-summary').textContent = 'Loading committed snapshots…';
  const from = state.a.id, to = state.b.id;
  const data = await api(`diff?${new URLSearchParams({ from, to })}`);
  state.lastDiff = { from, to };
  $('#diff-summary').textContent = `${data.from.slice(0, 8)} → ${data.to.slice(0, 8)} / committed snapshots`;
  $('#diff-stat').textContent = data.stat || 'No changes between these snapshots.';
  const lines = data.patch.split('\n').map(line => node('span', `diff-line ${line.startsWith('+') ? 'add' : line.startsWith('-') ? 'remove' : line.startsWith('@@') ? 'hunk' : ''}`, line));
  $('#diff-code').replaceChildren(...lines); $('#export').disabled = false;
}

$('#play').addEventListener('click', action(() => state.selected && play(state.selected.id)));
$('#pick-a').addEventListener('click', () => pick('a')); $('#pick-b').addEventListener('click', () => pick('b'));
$('#compare').addEventListener('click', action(async () => { if (state.sessions.length > 2) throw new Error('Stop previews until two slots are available.'); await play(state.a.id); await play(state.b.id); }));
$('#show-diff').addEventListener('click', action(showDiff));
$('#diff-tab').addEventListener('click', action(() => state.a && state.b ? showDiff() : setTab('diff')));
$('#preview-tab').addEventListener('click', () => setTab('preview'));
$('#jump-button').addEventListener('click', action(() => { const ref = $('#jump-ref').value.trim(); if (!ref) throw new Error('Enter a commit, branch, or tag.'); return play(ref); }));
$('#jump-ref').addEventListener('keydown', event => { if (event.key === 'Enter') $('#jump-button').click(); });
$('#date-button').addEventListener('click', action(async () => { const date = $('#jump-date').value; if (!date) throw new Error('Choose a date first.'); const { sha } = await api(`date?${new URLSearchParams({ date: `${date}T23:59:59` })}`); $('#jump-ref').value = sha; toast(`Found ${sha.slice(0, 8)}. Press Preview to run it.`); }));
$('#load-more').addEventListener('click', action(() => loadHistory(true)));
$('#load-ref').addEventListener('click', action(() => loadHistory()));
$('#history-ref').addEventListener('keydown', event => { if (event.key === 'Enter') $('#load-ref').click(); });
let debounce;
$('#search').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(action(() => loadHistory()), 250); });
for (const button of document.querySelectorAll('[data-width]')) button.addEventListener('click', () => { state.width = button.dataset.width; $('#previews').classList.toggle('mobile', state.width === 'mobile'); for (const b of document.querySelectorAll('[data-width]')) b.classList.toggle('active', b === button); });
$('#export').addEventListener('click', action(async () => {
  if (!state.lastDiff) return;
  const response = await api(`report?${new URLSearchParams(state.lastDiff)}`, { raw: true });
  const url = URL.createObjectURL(await response.blob()); const a = node('a'); a.href = url; a.download = 'commitflix-comparison.html'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}));
$('#help-button').addEventListener('click', () => $('#shortcuts').showModal()); $('#close-help').addEventListener('click', () => $('#shortcuts').close());
document.addEventListener('keydown', event => {
  if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey || $('#shortcuts').open) return;
  const key = event.key.toLowerCase();
  if (key === '/') { event.preventDefault(); $('#search').focus(); }
  if (key === '?') $('#shortcuts').showModal();
  if (key === 'p') $('#play').click();
  if (key === 'a' || key === 'b') pick(key);
  if (key === 'd') $('#show-diff').click();
  if (key === 'arrowdown' || key === 'arrowup') {
    event.preventDefault(); const index = state.commits.findIndex(c => c.id === state.selected?.id); const next = state.commits[index + (key === 'arrowdown' ? 1 : -1)];
    if (next) { select(next); document.querySelector(`[data-sha="${next.id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
});

action(async () => {
  const info = await api('info');
  $('#repo-name').textContent = info.name; $('#repo-name').title = info.root;
  $('#branch').textContent = info.branch; $('#commit-count').textContent = `${info.commits} commits`;
  $('#working-status').textContent = info.dirty ? 'Uncommitted work stays in place.' : info.shallow ? 'Shallow clone · partial history' : 'Original checkout stays in place.';
  await loadHistory(); await poll();
  setInterval(() => poll().catch(() => { $('#working-status').textContent = 'Disconnected · restart the CLI to reconnect.'; }), 1500);
})();
