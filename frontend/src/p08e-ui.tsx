import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, type Page } from './api.js';
import type { WebhookEndpoint, WebhookDelivery, WebhookDeliveryDetail } from './webhook-api.js';
import { useSession } from './session.js';
import { ConfirmDialog, EmptyState, Link, LoadingState, ProductShell, type ProductNavigate } from './product-ui.js';
import { P08EApi, WebhookIntentStore, WEBHOOK_PAGE_SIZE, webhookId, webhookLabel, webhookTime, webhookResultPath,
  type WebhookCommand, type WebhookReceipt, type SavedWebhookCommand } from './p08e-core.js';
import './p08e.css';

const CHANGED = 'ledgerguard:webhook-command-changed';
const LABELS: Record<WebhookDelivery['state'], string> = { PENDING: 'Waiting to send', IN_FLIGHT: 'Attempt in progress', DELIVERED: 'Delivered', FAILED: 'Delivery failed' };
const OUTCOMES = { DELIVERED: 'Delivered', RETRY_SCHEDULED: 'Retry scheduled', PERMANENT_FAILURE: 'Permanent response failure', EXHAUSTED: 'Retry budget exhausted', LEASE_EXPIRED: 'Dispatcher lease expired' };

/** The existing page shells keep their own navigation; this link follows shell replacement. */
export function P08ENavigation({ navigate }: { navigate: ProductNavigate }): JSX.Element | null {
  const session = useSession();
  const [mount, setMount] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (session.status !== 'AUTHENTICATED' || session.user?.role !== 'CUSTOMER') { setMount(null); return; }
    let owned: HTMLElement | undefined;
    const attach = () => {
      if (owned?.isConnected) return;
      const nav = document.querySelector<HTMLElement>('.site-header nav');
      if (!nav) return;
      owned = document.createElement('span'); owned.className = 'p08e-navigation';
      nav.insertBefore(owned, nav.lastElementChild); setMount(owned);
    };
    attach(); const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); owned?.remove(); };
  }, [session.status, session.user?.id]);
  return mount && session.status === 'AUTHENTICATED' && session.user?.role === 'CUSTOMER'
    ? createPortal(<Link href="/webhooks" navigate={navigate} className="nav-link">Webhooks</Link>, mount) : null;
}

function Failure({ failure, retry }: { failure: unknown; retry?: () => void }): JSX.Element {
  const code = failure instanceof ApiError ? failure.problem.code : undefined;
  const message = code === 'WEBHOOK_CONFLICT' ? 'The endpoint version or delivery eligibility changed. Reload the current record and review a new command.'
    : code === 'IDEMPOTENCY_CONFLICT' ? 'This command ID belongs to a different request. The saved request remains blocked and has not been replaced.'
    : code === 'CSRF_INVALID' ? 'The security token expired. Refresh the page, sign in if required, and resolve the same preserved command.'
    : code === 'FORBIDDEN' ? 'This action is not permitted for this account.'
    : code === 'NOT_FOUND' ? 'The record does not exist, is not visible to this customer, or this capability is not enabled.'
    : failure instanceof Error && !(failure instanceof ApiError) ? failure.message
    : 'The service could not confirm this request. No payment or notification result has been inferred.';
  return <section className="webhook-warning" role="alert"><h2>Request not confirmed</h2><p>{message}</p>
    {code && <p>Code: <code>{code}</code></p>}{retry && <button type="button" className="button button-secondary" onClick={retry}>Refresh records</button>}</section>;
}
function Badge({ state }: { state: WebhookDelivery['state'] }): JSX.Element {
  return <span className={`webhook-badge webhook-${state.toLowerCase()}`}>{LABELS[state]}</span>;
}
function Pager({ value, offset, label, onPage }: { value: Page<unknown>; offset: number; label: string; onPage: (offset: number) => void }): JSX.Element {
  return <nav className="webhook-pager" aria-label={`${label} pagination`}>
    <button className="button button-secondary" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - WEBHOOK_PAGE_SIZE))} aria-label={`Previous ${label} page`}>Previous</button>
    <span>{value.items.length ? `Showing ${offset + 1}–${offset + value.items.length}` : 'No records on this page'}</span>
    <button className="button button-secondary" disabled={!value.hasMore || offset + WEBHOOK_PAGE_SIZE > 10000} onClick={() => onPage(offset + WEBHOOK_PAGE_SIZE)} aria-label={`Next ${label} page`}>Next</button>
  </nav>;
}
function useResource<T>(load: (api: P08EApi) => Promise<T>, revision: number, polling?: (data: T) => boolean) {
  const session = useSession(); const owner = session.user!.id;
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<{ data?: T; failure?: unknown; loading: boolean; paused?: boolean }>({ loading: true });
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 180000;
    setState({ loading: true });
    const tick = async () => {
      try {
        const data = await session.execute(api => load(new P08EApi(api, owner)));
        if (!active) return;
        const pending = Boolean(polling?.(data));
        const paused = pending && (document.hidden || Date.now() >= deadline);
        setState({ data, loading: false, paused });
        if (pending && !paused) timer = setTimeout(() => { if (!active) return; if (document.hidden) setState(previous => ({ ...previous, paused: true })); else void tick(); }, 2000);
      } catch (failure) { if (active) setState({ failure, loading: false }); }
    };
    void tick(); return () => { active = false; if (timer) clearTimeout(timer); };
  }, [session.execute, owner, load, revision, refresh, polling]);
  return { ...state, reload: () => setRefresh(value => value + 1) };
}
function snapshot(store: WebhookIntentStore): { saved?: SavedWebhookCommand; failure?: unknown } {
  try { return { saved: store.current() }; } catch (failure) { return { failure }; }
}
interface Actions { busy: boolean; blocked: boolean; review: (command: WebhookCommand) => void; revision: number; }

function SubscriptionList({ actions, navigate }: { actions: Actions; navigate: ProductNavigate }): JSX.Element {
  const [offset, setOffset] = useState(0);
  const load = useCallback((api: P08EApi) => api.endpoints(WEBHOOK_PAGE_SIZE, offset), [offset]);
  const resource = useResource(load, actions.revision);
  return <>
    <header className="page-heading"><div><p className="eyebrow">Signed event notifications</p><h1>Webhooks</h1><p>Manage your approved subscriptions and inspect what actually reached the receiver.</p></div>
      <button className="button button-primary" disabled={actions.blocked || resource.loading || !resource.data} onClick={() => actions.review({ kind: 'CREATE' })}>New subscription</button></header>
    {resource.loading && <LoadingState label="Loading webhook subscriptions" />}
    {resource.failure !== undefined && <><Failure failure={resource.failure} retry={resource.reload} />
      <p className="webhook-note">The documented P07 Compose overlay enables this capability and its signed sandbox receiver. An unavailable service is not an empty subscription list.</p></>}
    {resource.data && <>
      {resource.data.items.length ? <div className="webhook-grid">{resource.data.items.map(endpoint => <article className="webhook-card" key={endpoint.id}>
        <p className="eyebrow">Approved sandbox destination</p><h2>Sandbox receiver</h2><p className="webhook-destination"><code>{endpoint.destinationUrl}</code></p>
        <span className="webhook-badge">{endpoint.enabled ? 'Subscription enabled' : 'Subscription disabled'}</span>
        <dl className="webhook-facts"><div><dt>Endpoint reference</dt><dd><code>{endpoint.id}</code></dd></div><div><dt>Definition version</dt><dd>{endpoint.version}</dd></div></dl>
        <Link href={`/webhooks/${endpoint.id}`} navigate={navigate} className="button button-secondary">View subscription</Link>
      </article>)}</div> : <EmptyState title="No subscriptions on this page" message="Create an approved subscription to receive future transaction events. No signing secret is disclosed by ordinary reads." />}
      <Pager value={resource.data} offset={offset} label="subscription" onPage={setOffset} />
    </>}
    <aside className="webhook-policy"><h2>Notifications do not move money</h2><p>A failed notification does not fail or reverse a settled payment. The standard lab sends only to its approved internal receiver, never to an arbitrary Internet URL.</p><p>Delivery is retryable, not exactly-once transport. Stable event IDs let the receiver deduplicate accepted events.</p></aside>
  </>;
}
function deliveryListPending(value: Page<WebhookDelivery>): boolean { return value.items.some(item => item.state === 'PENDING' || item.state === 'IN_FLIGHT'); }
function Deliveries({ endpoint, revision, navigate }: { endpoint: WebhookEndpoint; revision: number; navigate: ProductNavigate }): JSX.Element {
  const [offset, setOffset] = useState(0);
  const load = useCallback((api: P08EApi) => api.deliveries(endpoint.id, WEBHOOK_PAGE_SIZE, offset), [endpoint.id, offset]);
  const resource = useResource(load, revision, deliveryListPending);
  return <section className="webhook-section" aria-labelledby="deliveries-heading"><div className="webhook-section-heading"><h2 id="deliveries-heading">Delivery history</h2><button className="button button-secondary" onClick={resource.reload}>Refresh deliveries</button></div>
    {resource.loading && <LoadingState label="Loading deliveries" />}{resource.failure !== undefined && <Failure failure={resource.failure} retry={resource.reload} />}
    {resource.paused && <p role="status">Automatic refresh paused. Refresh deliveries for the current state; no terminal result has been inferred.</p>}
    {resource.data && <>{resource.data.items.length ? <div className="webhook-deliveries">{resource.data.items.map(delivery => <article className="webhook-card" key={delivery.id}>
      <Badge state={delivery.state} /><h3>{delivery.eventType}</h3><dl className="webhook-facts"><div><dt>Event reference</dt><dd><code>{delivery.eventId}</code></dd></div><div><dt>Created</dt><dd>{webhookTime(delivery.createdAt)}</dd></div><div><dt>Recorded attempts</dt><dd>{delivery.totalAttempts}</dd></div></dl>
      <Link href={`/webhooks/deliveries/${delivery.id}`} navigate={navigate} className="button button-secondary">Inspect delivery</Link>
    </article>)}</div> : <EmptyState title="No deliveries on this page" message="New eligible transaction events create durable deliveries. Enabling a subscription is not proof of successful delivery." />}
      <Pager value={resource.data} offset={offset} label="delivery" onPage={setOffset} /></>}
  </section>;
}
function Subscription({ id, actions, navigate }: { id: string; actions: Actions; navigate: ProductNavigate }): JSX.Element {
  const load = useCallback((api: P08EApi) => api.endpoint(id), [id]);
  const resource = useResource(load, actions.revision);
  return <><Link href="/webhooks" navigate={navigate} className="webhook-back">All subscriptions</Link><header className="page-heading"><div><p className="eyebrow">Owner-scoped subscription</p><h1>Webhook subscription</h1></div></header>
    {resource.loading && <LoadingState label="Loading subscription" />}{resource.failure !== undefined && <Failure failure={resource.failure} retry={resource.reload} />}
    {resource.data && <><section className="webhook-card"><h2>Sandbox receiver</h2><p className="webhook-destination"><code>{resource.data.destinationUrl}</code></p>
      <dl className="webhook-facts"><div><dt>Endpoint reference</dt><dd><code>{resource.data.id}</code></dd></div><div><dt>Definition version</dt><dd data-testid="webhook-version">{resource.data.version}</dd></div><div><dt>Subscription state</dt><dd>{resource.data.enabled ? 'Enabled' : 'Disabled'}</dd></div><div><dt>Last rotation</dt><dd>{webhookTime(resource.data.rotatedAt)}</dd></div></dl>
      <div className="webhook-actions"><button className="button button-secondary" disabled={actions.blocked} onClick={() => actions.review({ kind: 'STATE', endpointId: id, enabled: !resource.data!.enabled, expectedVersion: resource.data!.version })}>{resource.data.enabled ? 'Disable subscription' : 'Enable subscription'}</button>
      <button className="button button-secondary" disabled={actions.blocked} onClick={() => actions.review({ kind: 'ROTATE', endpointId: id, expectedVersion: resource.data!.version })}>Rotate signing secret</button></div>
      <p className="webhook-note">A secret is shown only on the first successful creation or rotation response. Historical deliveries retain their original secret version. Disabling prevents new dispatch claims, not an already-running attempt.</p>
    </section><Deliveries key={id} endpoint={resource.data} revision={actions.revision} navigate={navigate} /></>}
  </>;
}
interface DeliveryView { detail: WebhookDeliveryDetail; endpoint: WebhookEndpoint; }
function detailPending(value: DeliveryView): boolean { return value.detail.delivery.state === 'PENDING' || value.detail.delivery.state === 'IN_FLIGHT'; }
function Delivery({ id, actions, navigate }: { id: string; actions: Actions; navigate: ProductNavigate }): JSX.Element {
  const [reason, setReason] = useState(''); const [validation, setValidation] = useState<string>();
  const [attemptPage, setAttemptPage] = useState(0);
  const load = useCallback(async (api: P08EApi): Promise<DeliveryView> => {
    const detail = await api.delivery(id); return { detail, endpoint: await api.endpoint(detail.delivery.endpointId) };
  }, [id]);
  const resource = useResource(load, actions.revision, detailPending), record = resource.data?.detail.delivery;
  const retryable = record?.state === 'FAILED' && resource.data?.endpoint.enabled;
  const submit = (event: FormEvent) => {
    event.preventDefault(); setValidation(undefined);
    if (!record || !retryable) return;
    if (!reason.trim() || reason.trim().length > 500 || /[\u0000-\u001f\u007f]/.test(reason.trim())) { setValidation('Enter a retry reason of 1–500 characters without line breaks.'); return; }
    actions.review({ kind: 'RETRY', deliveryId: id, expectedCycle: record.cycle, reason: reason.trim() });
  };
  return <><Link href={record ? `/webhooks/${record.endpointId}` : '/webhooks'} navigate={navigate} className="webhook-back">Back to subscription</Link>
    <header className="page-heading"><div><p className="eyebrow">Delivery is separate from settlement</p><h1>Webhook delivery</h1></div><button className="button button-secondary" onClick={resource.reload}>Refresh delivery</button></header>
    {resource.loading && <LoadingState label="Loading delivery and attempts" />}{resource.failure !== undefined && <Failure failure={resource.failure} retry={resource.reload} />}
    {resource.paused && <p className="webhook-note" role="status">Automatic refresh paused. Use Refresh delivery to read the authoritative state.</p>}
    {record && resource.data && <><section className="webhook-card"><Badge state={record.state} /><h2>{record.eventType}</h2>
      <dl className="webhook-facts"><div><dt>Delivery reference</dt><dd><code>{record.id}</code></dd></div><div><dt>Stable event reference</dt><dd><code>{record.eventId}</code></dd></div><div><dt>Retry cycle</dt><dd data-testid="webhook-cycle">{record.cycle}</dd></div><div><dt>Attempts started in this cycle</dt><dd>{record.attempts} / 8</dd></div><div><dt>Recorded attempts, all cycles</dt><dd>{record.totalAttempts}</dd></div><div><dt>Next scheduled attempt</dt><dd>{record.state === 'PENDING' ? webhookTime(record.nextAttemptAt) : 'None scheduled in this state'}</dd></div><div><dt>Delivered at</dt><dd>{webhookTime(record.deliveredAt)}</dd></div><div><dt>Last error</dt><dd>{record.lastError ?? 'None recorded'}</dd></div></dl>
      <p className="webhook-note">This is a notification result, not a payment result. Retry cycles never create another payment.</p></section>
      <section className="webhook-section"><h2>Immutable attempt history</h2>
        {resource.data.detail.attempts.length ? <><div className="webhook-attempts">{resource.data.detail.attempts.slice(attemptPage * 8, attemptPage * 8 + 8).map(attempt => <article className="webhook-attempt" key={`${attempt.cycle}:${attempt.attempt}`}>
          <h3>Cycle {attempt.cycle}, attempt {attempt.attempt}</h3><p><strong>{OUTCOMES[attempt.outcome]}</strong></p><dl className="webhook-facts"><div><dt>Attempted</dt><dd>{webhookTime(attempt.attemptedAt)}</dd></div><div><dt>HTTP status</dt><dd>{attempt.httpStatus ?? 'No response'}</dd></div><div><dt>Duration</dt><dd>{attempt.durationMs} ms</dd></div><div><dt>Secret version used</dt><dd>{attempt.secretKeyVersion ?? 'Not recorded'}</dd></div><div><dt>Error</dt><dd>{attempt.errorCode ?? 'None'}</dd></div><div><dt>Response summary</dt><dd>{attempt.responseSummary ?? 'No body retained'}</dd></div><div><dt>Scheduled next attempt</dt><dd>{webhookTime(attempt.nextAttemptAt)}</dd></div></dl>
        </article>)}</div><nav className="webhook-pager" aria-label="Attempt history pages"><button className="button button-secondary" disabled={attemptPage === 0} onClick={() => setAttemptPage(value => value - 1)}>Previous attempts</button><span>Attempt page {attemptPage + 1}</span><button className="button button-secondary" disabled={(attemptPage + 1) * 8 >= resource.data.detail.attempts.length} onClick={() => setAttemptPage(value => value + 1)}>Next attempts</button></nav></>
          : <p>No completed attempt has been recorded yet. A running attempt is not proof of delivery.</p>}
      </section>
      <section className="webhook-card"><h2>Manual delivery retry</h2><p>Only a failed delivery on an enabled subscription can start a new, bounded eight-attempt cycle. A reason is recorded in the audit history.</p>
        {!retryable && <p className="webhook-note">{!resource.data.endpoint.enabled ? 'Enable the subscription before requesting a retry.' : 'This delivery is not in the failed state.'}</p>}
        <form onSubmit={submit}><label htmlFor="webhook-reason">Retry reason</label><input id="webhook-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} disabled={!retryable || actions.blocked} required aria-describedby={validation ? 'webhook-retry-error' : undefined} />
          {validation && <p id="webhook-retry-error" role="alert">{validation}</p>}<button className="button button-primary" disabled={!retryable || actions.blocked}>Review delivery retry</button></form>
      </section></>}
  </>;
}

function Workspace({ path, navigate }: { path: string; navigate: ProductNavigate }): JSX.Element {
  const session = useSession(), owner = session.user!.id;
  const store = useMemo(() => new WebhookIntentStore({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key) }, owner), [owner]);
  const [savedState, setSavedState] = useState(() => snapshot(store));
  const [pending, setPending] = useState<WebhookCommand>(); const [busy, setBusy] = useState(false); const [failure, setFailure] = useState<unknown>();
  const [receipt, setReceipt] = useState<WebhookReceipt>(); const [secret, setSecret] = useState<string>(); const [copied, setCopied] = useState(false); const [lostSecret, setLostSecret] = useState(false);
  const [revision, setRevision] = useState(0); const inFlight = useRef(false), alive = useRef(true), currentPath = useRef(path);
  const trigger = useRef<HTMLElement>(null); const confirmationHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (receipt) confirmationHeading.current?.focus(); }, [receipt, Boolean(secret)]);
  currentPath.current = path;
  useEffect(() => {
    alive.current = true; const update = () => setSavedState(snapshot(store));
    window.addEventListener('storage', update); window.addEventListener(CHANGED, update);
    return () => { alive.current = false; window.removeEventListener('storage', update); window.removeEventListener(CHANGED, update); };
  }, [store]);
  useEffect(() => { setSecret(undefined); setReceipt(undefined); setLostSecret(false); setCopied(false); setPending(undefined); setFailure(undefined); document.title = 'Webhooks · Bad Penny'; }, [path]);
  useEffect(() => {
    const clear = () => setSecret(undefined), hidden = () => { if (document.hidden) clear(); };
    window.addEventListener('pagehide', clear); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('pagehide', clear); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  const refresh = () => { if (alive.current) setSavedState(snapshot(store)); window.dispatchEvent(new Event(CHANGED)); };
  const perform = async (mode: 'NEW' | 'REPLAY' | 'READ') => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setFailure(undefined); setSecret(undefined); setCopied(false);
    let saved: SavedWebhookCommand | undefined; const submittedPath = path;
    try {
      saved = mode === 'NEW' && pending ? store.prepare(pending, crypto.randomUUID()) : store.current();
      if (!saved) throw new Error('No preserved webhook command is available');
      refresh(); const instruction = saved;
      const result = await session.execute(api => mode === 'READ' ? new P08EApi(api, owner).resolve(instruction) : new P08EApi(api, owner).execute(instruction.command, instruction.key));
      store.complete(saved.key);
      if (alive.current && currentPath.current === submittedPath) {
        const visibleSecret = document.hidden ? undefined : result.signingSecret ?? undefined;
        setReceipt(result.command); setSecret(visibleSecret);
        setLostSecret((result.command.kind === 'CREATE' || result.command.kind === 'ROTATE') && !visibleSecret);
        setPending(undefined); setRevision(value => value + 1);
      }
    } catch (problem) {
      if (saved) {
        try {
          // Only a serialized database eligibility/version rejection proves this command did not apply.
          if (mode !== 'READ' && problem instanceof ApiError && problem.status === 409 && problem.problem.code === 'WEBHOOK_CONFLICT') store.complete(saved.key);
          else store.uncertain(saved.key);
        } catch { /* Reading storage below surfaces a fail-closed recovery warning. */ }
      }
      if (alive.current && currentPath.current === submittedPath) {
        setPending(undefined);
        setFailure(mode === 'READ' && problem instanceof ApiError && problem.status === 404
          ? new Error('No committed receipt is visible yet. This does not prove failure. Explicitly retry the preserved command with its original ID.') : problem);
        if (problem instanceof ApiError && problem.problem.code === 'WEBHOOK_CONFLICT') setRevision(value => value + 1);
      }
    } finally { inFlight.current = false; if (alive.current) setBusy(false); refresh(); }
  };
  const actions: Actions = { busy, blocked: busy || Boolean(savedState.saved) || savedState.failure !== undefined || Boolean(secret), revision,
    review: command => { if (!busy && !savedState.saved && savedState.failure === undefined && !secret) {
      (trigger as { current: HTMLElement | null }).current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPending(command); setFailure(undefined);
    } } };
  let content: ReactNode;
  const suffix = path.slice('/webhooks/'.length);
  try {
    content = path === '/webhooks' ? <SubscriptionList actions={actions} navigate={navigate} />
      : path.startsWith('/webhooks/deliveries/') ? <Delivery key={path} id={webhookId(path.slice('/webhooks/deliveries/'.length))} actions={actions} navigate={navigate} />
      : <Subscription key={path} id={webhookId(suffix)} actions={actions} navigate={navigate} />;
  } catch { content = <><h1>Webhook record not found</h1><p>The reference is invalid. No command was submitted.</p><Link href="/webhooks" navigate={navigate}>All subscriptions</Link></>; }
  return <ProductShell navigate={navigate}><div className="webhook-workspace">
    {savedState.failure !== undefined && <Failure failure={new Error('Saved webhook metadata cannot be read. Changes are blocked; do not clear browser storage while an outcome is unresolved.')} />}
    {savedState.saved && <section className="webhook-warning" role="status" aria-label="Preserved webhook command"><p className="eyebrow">Safe recovery</p><h2>Webhook outcome not yet confirmed</h2><p>{webhookLabel(savedState.saved.command)} is preserved for this customer with its original command ID. Nothing is automatically resubmitted.</p><p>Reference: <code>{savedState.saved.key}</code></p>
      <div className="webhook-actions"><button className="button button-secondary" disabled={busy} onClick={() => void perform('READ')}>Check command outcome</button><button className="button button-primary" disabled={busy} onClick={() => void perform('REPLAY')}>Retry preserved command</button></div></section>}
    {failure !== undefined && <Failure failure={failure} />}
    {receipt && <section className="webhook-confirmed" role="status"><h2 tabIndex={-1} ref={secret ? undefined : confirmationHeading}>{receipt.kind === 'RETRY' ? 'Retry request confirmed' : 'Webhook command confirmed'}</h2><p>{receipt.kind === 'RETRY' ? 'A retry cycle was requested. This is not proof of delivery.' : `The command applied at endpoint version ${receipt.appliedVersion}. Read the endpoint for its current state.`}</p>
      {lostSecret && <p><strong>The one-time secret response is unavailable.</strong> The command is confirmed and will not be repeated. Review the endpoint, then deliberately rotate once if you need a new signing secret.</p>}
      <Link href={webhookResultPath({ command: receipt })} navigate={navigate} className="button button-secondary">View confirmed record</Link></section>}
    {secret && <section className="webhook-secret" aria-label="One-time signing secret"><h2 tabIndex={-1} ref={confirmationHeading}>Save this signing secret now</h2><p>Shown once. Closing this display, leaving the page, hiding this tab, or ending the session clears it. Ordinary reads and command replays never reveal it.</p><code data-testid="webhook-signing-secret">{secret}</code><div className="webhook-actions">
      <button className="button button-secondary" onClick={() => { if (!navigator.clipboard) { setFailure(new Error('Clipboard access is unavailable. Select and copy the displayed secret manually.')); return; } void navigator.clipboard.writeText(secret).then(() => setCopied(true), () => setFailure(new Error('Clipboard access was denied. Select and copy the displayed secret manually.'))); }}>Copy signing secret</button>
      <button className="button button-primary" onClick={() => { setSecret(undefined); setCopied(false); }}>Dismiss signing secret</button></div>{copied && <p role="status">Copied to your clipboard. Manage that copy securely.</p>}</section>}
    {content}
    <ConfirmDialog open={Boolean(pending)} title={pending ? webhookLabel(pending) : 'Confirm webhook command'} confirmLabel={pending ? webhookLabel(pending) : 'Confirm'}
      description={pending?.kind === 'CREATE' ? 'Create an enabled subscription to the approved sandbox receiver. The first response contains a one-time signing secret.'
        : pending?.kind === 'ROTATE' ? 'Create a new signing secret at the reviewed version. Historical deliveries keep their original secret version. This cannot reveal a previously lost secret.'
        : pending?.kind === 'RETRY' ? 'Request a new bounded retry cycle for this failed notification, using its original event and delivery identities. This does not change money.'
        : 'Change future webhook dispatch eligibility at the reviewed version. An already-running attempt may finish.'}
      busy={busy} initialFocus="cancel" returnFocus={trigger} onCancel={() => { if (!busy) setPending(undefined); }} onConfirm={() => void perform('NEW')}>
      {pending && 'expectedVersion' in pending && <p>Reviewed endpoint version: <strong>{pending.expectedVersion}</strong></p>}
      {pending?.kind === 'RETRY' && <><p>Reviewed retry cycle: <strong>{pending.expectedCycle}</strong></p><p>Reason: {pending.reason}</p></>}
    </ConfirmDialog>
  </div></ProductShell>;
}
export function P08ERoutes({ path, navigate }: { path: string; navigate: ProductNavigate }): JSX.Element {
  const session = useSession();
  if (session.user?.role !== 'CUSTOMER') return <ProductShell navigate={navigate}><h1>Customer webhooks</h1><p>This interface manages customer-owned subscriptions. No administrator command was issued.</p></ProductShell>;
  return <Workspace key={session.user.id} path={path} navigate={navigate} />;
}
