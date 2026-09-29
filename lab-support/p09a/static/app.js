'use strict';
const $ = id => document.getElementById(id);
const active = new Set(['QUEUED', 'RUNNING', 'CLEANING']);
let session = null, selected = null, busy = false, pending = null, timer = null;
const runNodes = new Map();
const message = (text, error = false) => { $('notice').textContent = text; $('notice').classList.toggle('error', error); };
async function api(path, method = 'GET', body, headers = {}) {
  const response = await fetch(path, {method, credentials: 'same-origin', cache: 'no-store',
    headers: {...(body === undefined ? {} : {'Content-Type': 'application/json'}), ...headers},
    ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) { const error = new Error(data?.code || `HTTP_${response.status}`); error.status = response.status; throw error; }
  return data;
}
function signedOut() {
  session = null; pending = null; clearTimeout(timer); timer = null;
  $('workspace').hidden = true; $('login-panel').hidden = false;
}
async function authenticate() {
  session = await api('/lab/api/session');
  selected = null; $('detail').hidden = true;
  $('instance').textContent = session.instanceId;
  $('source').textContent = session.sourceSha + (session.dirtySource ? ' · DIRTY / NOT RELEASE EVIDENCE' : ' · clean source');
  $('login-panel').hidden = true; $('workspace').hidden = false;
  await refresh();
}
function updateHealth(health) {
  $('health').textContent = `${health.guardianReady ? 'Ready' : 'Not ready'} / ${health.workerReady ? 'Ready' : 'Not ready'}`;
  $('fault').textContent = `${health.fault}${health.expiresAt ? ' · expires ' + new Date(health.expiresAt).toLocaleTimeString() : ''}`;
  document.querySelectorAll('.run').forEach(button => { button.disabled = busy || !health.guardianReady || !health.workerReady || health.fault !== 'NONE'; });
}
function showRun(run, focus = false) {
  selected = run.id;
  $('detail').hidden = false; $('detail-title').textContent = `${run.scenario} · Run detail`;
  $('verdict').textContent = `${run.status} · ${run.id}`;
  $('reset').hidden = !active.has(run.status);
  $('evidence').textContent = JSON.stringify(run.result || {runId: run.id, status: run.status, deadline: new Date(run.deadline * 1000).toISOString()}, null, 2);
  $('junit').hidden = !run.result;
  $('junit').href = `/lab/api/runs/${run.id}/junit`;
  if (focus) $('detail-title').focus();
}
async function refresh() {
  if (!session) return;
  clearTimeout(timer);
  try {
    const data = await api('/lab/api/runs');
    updateHealth(data.health);
    try {
      const storageKey = `p09a-pending:${session.instanceId}:${session.user.id}`;
      const outstanding = pending || JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      const resolved = outstanding && data.runs.find(run => run.request_id === outstanding.requestId && run.actor === session.user.id && run.scenario === outstanding.scenario);
      if (resolved) {
        pending = null; sessionStorage.removeItem(storageKey); selected = resolved.id;
        message('The original request was found in durable run history. No replacement experiment was created.');
      }
    } catch { /* Polling remains usable when browser storage is unavailable. */ }
    $('empty').hidden = data.runs.length !== 0;
    const currentIds = new Set(data.runs.map(run => run.id));
    for (const [id, node] of runNodes) { if (!currentIds.has(id)) { node.remove(); runNodes.delete(id); } }
    let previous = null;
    for (const run of data.runs) {
      let row = runNodes.get(run.id);
      if (!row) {
        row = document.createElement('div'); row.className = 'run-item';
        const label = document.createElement('div');
        label.append(document.createElement('strong'), document.createElement('small'));
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = 'Inspect ' + run.scenario;
        button.addEventListener('click', () => showRun(row.run, true));
        row.append(label, button); runNodes.set(run.id, row);
      }
      const next = previous ? previous.nextSibling : $('runs').firstChild;
      if (row !== next) $('runs').insertBefore(row, next);
      previous = row;
      row.run = run;
      row.querySelector('strong').textContent = `${run.scenario} — ${run.status}`;
      row.querySelector('small').textContent = `${new Date(run.created * 1000).toLocaleString()} · ${run.id}`;
      if (selected === run.id) showRun(run);
    }
    if (data.runs.some(run => active.has(run.status))) document.querySelectorAll('.run').forEach(button => { button.disabled = true; });
    timer = setTimeout(refresh, 2000);
  } catch (error) {
    if (error.status === 401 || error.status === 403) { signedOut(); message('Administrator session expired or access was denied.', true); }
    else { message(`Status unavailable: ${error.message}. Existing faults still have automatic expiry.`, true); timer = setTimeout(refresh, 4000); }
  }
}
async function confirmAction(text) {
  $('confirm-description').textContent = text;
  const dialog = $('confirmation'); dialog.returnValue = 'cancel'; dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {once: true}));
}
async function submit(scenario) {
  if (busy || !session) return;
  if (!await confirmAction(`Run ${scenario} against this disposable lab instance? This does not target your normal application.`)) return;
  busy = true;
  const storageKey = `p09a-pending:${session.instanceId}:${session.user.id}`;
  try {
    // Persist only non-secret intent, scoped to this administrator and lab instance.
    // Fail closed when storage is unavailable rather than lose an uncertain request identity.
    if (!pending) pending = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (pending && pending.scenario !== scenario) {
      throw new Error('RESOLVE_OUTSTANDING_SCENARIO_FIRST');
    }
    pending ||= {requestId: crypto.randomUUID(), scenario, seed: 74021};
    sessionStorage.setItem(storageKey, JSON.stringify(pending));
    const run = await api('/lab/api/runs', 'POST', pending, {'X-P09A-CSRF': session.csrf});
    pending = null; sessionStorage.removeItem(storageKey);
    showRun(run, true); message(`${scenario} accepted. Its verdict is not yet known.`);
  } catch (error) {
    if ([400, 403, 409, 422].includes(error.status)) {
      pending = null;
      try { sessionStorage.removeItem(storageKey); } catch { /* No financial command is retried automatically. */ }
    }
    message(`Request not confirmed: ${error.message}. Retry the same scenario to resolve the original request.`, true);
  } finally { busy = false; await refresh(); }

}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {
    const csrf = await api('/lab/auth/csrf');
    await api('/lab/auth/login', 'POST', {email: $('email').value, password: $('password').value}, {[csrf.headerName]: csrf.token});
    $('password').value = ''; await authenticate(); message('Administrator authenticated. No experiment starts automatically.');
  } catch (error) { $('password').value = ''; message(`Sign-in failed: ${error.message}`, true); }
  finally { button.disabled = false; }
});
$('logout').addEventListener('click', async () => {
  try { const csrf = await api('/lab/auth/csrf'); await api('/lab/auth/logout', 'POST', {}, {[csrf.headerName]: csrf.token}); signedOut(); message('Signed out. Existing faults remain bounded by their expiry.'); }
  catch (error) { message(`Sign-out was not confirmed: ${error.message}`, true); }
});
$('reset').addEventListener('click', async () => {
  if (!selected || !await confirmAction('Cancel this run and restore its fault? Cancellation never counts as a passing restoration test.')) return;
  try { const run = await api(`/lab/api/runs/${selected}/reset`, 'POST', {confirm: true}, {'X-P09A-CSRF': session.csrf}); showRun(run); message('Reset requested. Waiting for the guardian to verify restoration.'); await refresh(); }
  catch (error) { message(`Reset not confirmed: ${error.message}`, true); }
});
$('refresh').addEventListener('click', refresh);
document.querySelectorAll('.run').forEach(button => button.addEventListener('click', () => submit(button.dataset.scenario)));
authenticate().catch(error => { signedOut(); if (error.status !== 401) message(`Lab access unavailable: ${error.message}`, true); });
