import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, OutcomeUnknown, type ApiClient, type Account, type CommandResponse, type Page, type Recipient } from './api.js';
import { parseAmount } from './money.js';
import { formatMoney } from './format.js';
import { intentRecoveryPath } from './p08b-core.js';
import { useSession } from './session.js';
import { ConfirmDialog, EmptyState, Link, LoadingState, ProblemPanel, ProductShell, unresolved, usePageTitle, useStoredIntent, type ProductNavigate } from './product-ui.js';
import { normalizeLocal, normalizeZone, normalizeScheduleDefinition, scheduleActionAllowed, scheduleRoute, scheduleTime, type Recurrence, type ScheduleCommand, type ScheduleDefinition, type ScheduleOccurrence, type SchedulePreview, type ScheduleReceipt, type ScheduleRecord, type ScheduleStateAction, type ScheduleStatus } from './schedule-api.js';
import './p08d.css';

const PAGE_SIZE = 20;
const STATUS: Record<ScheduleStatus, string> = { ACTIVE: 'Active', PAUSED: 'Paused', CANCELLED: 'Cancelled', FINISHED: 'Finished' };
const RECURRENCE: Record<Recurrence, string> = { ONCE: 'One-time', DAILY: 'Daily', WEEKLY: 'Weekly' };
const ACTION: Record<ScheduleStateAction, string> = { PAUSE: 'pause', RESUME: 'resume', CANCEL: 'cancel' };

/** Ignore stale reads after route changes/unmount. A failed read is never an empty or successful result. */
function useResource<T>(load: (api: ApiClient) => Promise<T>): { data?: T; failure?: unknown; loading: boolean; reload: () => void } {
  const { execute } = useSession();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ data?: T; failure?: unknown; loading: boolean }>({ loading: true });
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let active = true;
    setState({ loading: true });
    void execute(load).then(data => { if (active) setState({ data, loading: false }); }, failure => { if (active) setState({ failure, loading: false }); });
    return () => { active = false; };
  }, [execute, load, revision]);
  return { ...state, reload };
}

async function customerWallets(api: ApiClient): Promise<Account[]> {
  const accounts: Account[] = [];
  for (let offset = 0; offset <= 10000; offset += 100) {
    const page = await api.accounts(100, offset);
    accounts.push(...page.items);
    if (!page.hasMore) return accounts;
  }
  throw new Error('The wallet selector reached its bounded account limit. No schedule was submitted.');
}

function useScheduleMutation() {
  const session = useSession();
  const saved = useStoredIntent();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const send = async (command?: ScheduleCommand): Promise<CommandResponse<ScheduleReceipt> | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true; setBusy(true); setFailure(undefined);
    try {
      const response = await session.execute(api => command ? saved.store.executeSchedule(api, command) : saved.store.retrySchedule(api));
      return response;
    } catch (problem) {
      if (!(problem instanceof OutcomeUnknown)) setFailure(problem);
      if (problem instanceof ApiError && problem.problem.code === 'CSRF_INVALID') {
        // A stale CSRF denial cannot decide an earlier write's outcome. Check session admission,
        // refresh only the security token, and require another explicit same-key retry.
        try { await session.execute(api => api.me()); await session.api.csrfToken(); } catch { /* SessionProvider handles authoritative 401. */ }
      }
      return undefined;
    } finally {
      saved.refresh(); inFlight.current = false; setBusy(false);
    }
  };
  return { ...saved, busy, failure, send };
}

function Policy(): JSX.Element {
  return <aside className="schedule-policy" aria-labelledby="schedule-policy-title">
    <p className="eyebrow">Before you schedule</p><h2 id="schedule-policy-title">Time and execution rules</h2>
    <p><strong>Funds are checked at execution.</strong> Creating a schedule does not reserve future money. An insufficient-funds occurrence is recorded as failed, not recreated under a new identity.</p>
    <p><strong>Your chosen wall time stays local.</strong> Daily and weekly recurrence use the selected IANA zone, not the browser zone or repeated 24-hour additions.</p>
    <p><strong>Daylight saving is explicit.</strong> A spring gap moves forward by the gap, preserving minutes. An autumn overlap chooses the earlier offset and executes once.</p>
    <p><strong>Catch-up is bounded.</strong> Unprocessed occurrences up to 24 hours late execute once, oldest first in bounded batches. Older ones are recorded as skipped late.</p>
    <p><strong>Controls affect future work.</strong> Pause or cancel prevents not-yet-claimed occurrences. Already claimed work may finish. Resume does not resurrect intentionally skipped obligations; edits retain history.</p>
  </aside>;
}

function ScheduleBadge({ status }: { status: ScheduleStatus }): JSX.Element {
  return <span className={`schedule-badge schedule-${status.toLowerCase()}`}>{STATUS[status]}</span>;
}

function MutationBlock({ navigate }: { navigate: ProductNavigate }): JSX.Element | null {
  const { current, failure } = useStoredIntent();
  if (failure !== undefined) return <p className="schedule-warning" role="alert">The saved instruction could not be read. Schedule changes are blocked. Do not clear storage while an outcome is unresolved.</p>;
  if (!unresolved(current)) return null;
  return <p className="schedule-warning">Resolve the preserved instruction before creating another one. <Link href={intentRecoveryPath(current)} navigate={navigate}>Open safe recovery</Link></p>;
}

function ReadFailure({ failure, retry, list = false }: { failure: unknown; retry: () => void; list?: boolean }): JSX.Element {
  return <div><ProblemPanel failure={failure} />
    {list && failure instanceof ApiError && failure.status === 404 && <p className="schedule-warning">Schedule capability is not available in this topology. Use the documented P07 schedule-enabled Compose overlay; this is not evidence of an empty schedule list.</p>}
    <button className="button button-secondary" type="button" onClick={retry}>Retry loading records</button>
  </div>;
}

function Pager({ offset, page, label, onPage, loading }: { offset: number; page?: Page<unknown>; label: string; onPage: (offset: number) => void; loading: boolean }): JSX.Element {
  return <nav className="schedule-pager" aria-label={`${label} pagination`}>
    <button className="button button-secondary" type="button" aria-label={`Previous ${label} page`} disabled={loading || offset === 0} onClick={() => onPage(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
    <span>{page?.items.length ? `Showing ${offset + 1}–${offset + page.items.length}` : 'No records on this page'}</span>
    <button className="button button-secondary" type="button" aria-label={`Next ${label} page`} disabled={loading || !page?.hasMore || offset + PAGE_SIZE > 10000} onClick={() => onPage(offset + PAGE_SIZE)}>Next</button>
  </nav>;
}

function ScheduleList({ navigate }: { navigate: ProductNavigate }): JSX.Element {
  usePageTitle('Schedules');
  const [offset, setOffset] = useState(0);
  const load = useCallback((api: ApiClient) => api.schedules(PAGE_SIZE, offset), [offset]);
  const resource = useResource(load);
  const { current, failure } = useStoredIntent();
  const blocked = unresolved(current) || failure !== undefined;
  return <>
    <header className="page-heading p08b-heading"><div><p className="eyebrow">Planned synthetic money movement</p><h1>Schedules</h1><p>Manage future instructions and inspect the immutable result of each occurrence.</p></div>
      {blocked ? <button className="button button-primary" disabled title="Resolve the preserved instruction first">New schedule</button> : <Link href="/schedules/new" navigate={navigate} className="button button-primary">New schedule</Link>}
    </header>
    <MutationBlock navigate={navigate} />
    {resource.loading && <LoadingState label="Loading your schedules" />}
    {resource.failure !== undefined && <ReadFailure failure={resource.failure} retry={resource.reload} list />}
    {resource.data && (resource.data.items.length ? <div className="schedule-cards">{resource.data.items.map(record => <article className="schedule-card" key={record.id}>
      <div className="schedule-card-top"><span className="eyebrow">{RECURRENCE[record.recurrence]}</span><ScheduleBadge status={record.status} /></div>
      <h2><Link href={`/schedules/${record.id}`} navigate={navigate}>{formatMoney(record.amountMinor, record.currency)}</Link></h2>
      <p className="schedule-local">{record.intendedLocal.replace('T', ' ')}<br /><strong>{record.zoneId}</strong></p>
      <p>{record.status === 'ACTIVE' ? <>Next execution: <time dateTime={record.nextInstant}>{scheduleTime(record.nextInstant, record.zoneId)}</time></> : 'No future execution while this status applies.'}</p>
      <dl className="schedule-identities"><div><dt>Recipient</dt><dd><code>{record.recipientRef}</code></dd></div><div><dt>Schedule reference</dt><dd><code>{record.id}</code></dd></div><div><dt>Definition version</dt><dd>{record.version}</dd></div></dl>
      <Link href={`/schedules/${record.id}`} navigate={navigate} className="button button-secondary">View schedule</Link>
    </article>)}</div> : <EmptyState title="No schedules on this page" message="Create an instruction to start planning one-time, daily or weekly transfers. The list contains only your own schedules." />)}
    {resource.data && <Pager label="schedule" offset={offset} page={resource.data} onPage={setOffset} loading={resource.loading} />}
  </>;
}

function exactInput(amount: string, currency: ScheduleDefinition['currency']): string {
  const places = currency === 'JPY' ? 0 : currency === 'KWD' ? 3 : 2;
  if (!places) return amount;
  const padded = amount.padStart(places + 1, '0');
  return `${padded.slice(0, -places)}.${padded.slice(-places)}`;
}

function DefinitionSummary({ definition }: { definition: ScheduleDefinition }): JSX.Element {
  return <dl className="review-grid schedule-summary">
    <div><dt>Amount per occurrence</dt><dd>{formatMoney(definition.amountMinor, definition.currency)}</dd></div>
    <div><dt>Recurrence</dt><dd>{RECURRENCE[definition.recurrence]}</dd></div>
    <div><dt>Source wallet reference</dt><dd><code>{definition.sourceId}</code></dd></div>
    <div><dt>Recipient reference</dt><dd><code>{definition.recipientRef}</code></dd></div>
    <div><dt>Intended local date and time</dt><dd>{definition.intendedLocal.replace('T', ' ')}</dd></div>
    <div><dt>IANA zone</dt><dd>{definition.zoneId}</dd></div>
  </dl>;
}

function TimePreview({ value }: { value: SchedulePreview }): JSX.Element {
  return <div className="schedule-preview" role="note">
    <h3>Server-resolved first occurrence</h3>
    <dl className="schedule-summary"><div><dt>Resolved local time</dt><dd>{value.resolvedLocal.replace('T', ' ')}</dd></div><div><dt>UTC offset</dt><dd>{value.offset}</dd></div><div><dt>Execution instant (UTC)</dt><dd><code>{value.instant}</code></dd></div></dl>
    <p>{value.policy === 'GAP_FORWARD' ? 'Spring gap: moved forward by the transition gap, preserving minutes.' : value.policy === 'OVERLAP_EARLIER' ? 'Autumn overlap: earlier valid offset selected; one execution for this local occurrence.' : 'This wall time maps to one instant without a daylight-saving adjustment.'}</p>
    <p>This preview does not create a schedule or reserve money. Overdue occurrences follow the 24-hour catch-up policy.</p>
  </div>;
}

function ScheduleForm({ initial, navigate }: { initial?: ScheduleRecord; navigate: ProductNavigate }): JSX.Element {
  const session = useSession();
  const accounts = useResource(customerWallets);
  const mutation = useScheduleMutation();
  const [sourceId, setSourceId] = useState(initial?.sourceId ?? '');
  const [recipientRef, setRecipientRef] = useState(initial?.recipientRef ?? '');
  const [amount, setAmount] = useState(initial ? exactInput(initial.amountMinor, initial.currency) : '');
  const [local, setLocal] = useState(initial ? normalizeLocal(initial.intendedLocal) : '');
  const [zone, setZone] = useState(initial?.zoneId ?? 'America/Halifax');
  const [recurrence, setRecurrence] = useState<Recurrence>(initial?.recurrence ?? 'ONCE');
  const [reviewing, setReviewing] = useState(false);
  const reviewLock = useRef(false);
  const [review, setReview] = useState<{ command: ScheduleCommand; definition: ScheduleDefinition; preview: SchedulePreview }>();
  const [failure, setFailure] = useState<unknown>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const summary = useRef<HTMLDivElement>(null);
  const source = accounts.data?.find(account => account.id === sourceId);
  const blocked = unresolved(mutation.current);
  const storageFailure = useStoredIntent().failure;
  useEffect(() => { if (!sourceId && accounts.data?.[0]) setSourceId(accounts.data[0].id); }, [accounts.data, sourceId]);
  useEffect(() => { if (Object.keys(errors).length) summary.current?.focus(); }, [errors]);
  const prepare = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (reviewLock.current || blocked || storageFailure !== undefined) return;
    setFailure(undefined);
    const nextErrors: Record<string, string> = {};
    if (!source) nextErrors.source = 'Select one of your source wallets.';
    let amountMinor = '';
    try { if (source) amountMinor = parseAmount(amount.trim(), source.currency); } catch { nextErrors.amount = 'Enter a positive amount with exact precision for this currency. No rounding is applied.'; }
    if (!/^LG-[0-9a-f]{32}$/i.test(recipientRef.trim())) nextErrors.recipient = 'Enter LG- followed by 32 hexadecimal characters.';
    if (source && source.publicRef.toLowerCase() === recipientRef.trim().toLowerCase()) nextErrors.recipient = 'The recipient must be a different wallet.';
    try { normalizeLocal(local); } catch (problem) { nextErrors.local = problem instanceof Error ? problem.message : 'Enter a valid local time.'; }
    try { normalizeZone(zone); } catch (problem) { nextErrors.zone = problem instanceof Error ? problem.message : 'Enter a valid IANA zone.'; }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length || !source) return;
    reviewLock.current = true; setReviewing(true);
    try {
      const definition = normalizeScheduleDefinition({ sourceId: source.id, recipientRef, amountMinor, currency: source.currency, intendedLocal: local, zoneId: zone, recurrence });
      const recipient = await session.execute(api => api.get<Recipient>(`/recipients/${encodeURIComponent(definition.recipientRef)}`));
      if (recipient.publicRef !== definition.recipientRef || recipient.currency !== definition.currency) {
        setErrors({ recipient: 'The recipient must exist and use the same currency as the source wallet.' }); return;
      }
      const preview = await session.execute(api => api.previewSchedule(definition));
      const command: ScheduleCommand = initial ? { action: 'EDIT', scheduleId: initial.id, expectedVersion: initial.version, definition } : { action: 'CREATE', definition };
      setReview({ command, definition, preview });
    } catch (problem) { setFailure(problem); }
    finally { reviewLock.current = false; setReviewing(false); }
  };
  const confirm = async () => {
    if (!review) return;
    const response = await mutation.send(review.command);
    setReview(undefined);
    if (response) navigate(`/schedules/${response.body.id}`);
  };
  const fieldError = (name: string) => errors[name] ? <span className="field-error" id={`schedule-${name}-error`}>{errors[name]}</span> : null;
  const described = (name: string) => errors[name] ? `schedule-${name}-error` : undefined;
  return <>
    <MutationBlock navigate={navigate} />
    {failure !== undefined && <ProblemPanel failure={failure} />}
    {mutation.failure !== undefined && <ProblemPanel failure={mutation.failure} />}
    {mutation.failure instanceof ApiError && mutation.failure.status === 409 && mutation.failure.problem.code !== 'IDEMPOTENCY_CONFLICT' && <p className="schedule-warning" role="alert">The schedule changed or no longer permits this action. No newer version was silently substituted. Use “Load current definition” to review it before preparing a new instruction.</p>}
    {accounts.loading && <LoadingState label="Loading your source wallets" />}
    {accounts.failure !== undefined && <ReadFailure failure={accounts.failure} retry={accounts.reload} />}
    {accounts.data?.length === 0 && <EmptyState title="No source wallet" message="Open a wallet from the dashboard. A zero-balance wallet may still create a future schedule." action={<Link href="/" navigate={navigate} className="button button-secondary">Go to dashboard</Link>} />}
    {accounts.data && accounts.data.length > 0 && <div className="schedule-layout">
      <section className="schedule-form-card" aria-labelledby="schedule-form-title">
        <p className="eyebrow">{initial ? `Definition version ${initial.version}` : 'New instruction'}</p><h2 id="schedule-form-title">Schedule details</h2>
        {initial && <p>Editing creates a new definition version and keeps all prior occurrence history.</p>}
        {Object.keys(errors).length > 0 && <div ref={summary} className="schedule-warning" tabIndex={-1} role="alert"><h3>Correct the schedule details</h3>{Object.entries(errors).map(([key, message]) => <p key={key}><a href={`#schedule-${key}`}>{message}</a></p>)}</div>}
        <form onSubmit={event => void prepare(event)} noValidate>
          <fieldset className="schedule-fields" disabled={reviewing || mutation.busy || blocked || storageFailure !== undefined}>
            <div className="field"><label htmlFor="schedule-source">Source wallet</label><select id="schedule-source" value={sourceId} onChange={event => setSourceId(event.target.value)} aria-invalid={Boolean(errors.source)} aria-describedby={described('source')}>
              {accounts.data.map(account => <option key={account.id} value={account.id}>{account.name} — {account.currency}</option>)}
            </select>{fieldError('source')}{source && <p className="field-hint">Currently available: {formatMoney(source.availableMinor, source.currency)}. This is not reserved or guaranteed for a future occurrence.</p>}</div>
            <div className="field"><label htmlFor="schedule-recipient">Recipient reference</label><input id="schedule-recipient" value={recipientRef} onChange={event => setRecipientRef(event.target.value)} autoComplete="off" spellCheck={false} aria-invalid={Boolean(errors.recipient)} aria-describedby={described('recipient')} />{fieldError('recipient')}</div>
            <div className="field"><label htmlFor="schedule-amount">Amount per occurrence{source ? ` (${source.currency})` : ''}</label><input id="schedule-amount" value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" autoComplete="off" aria-invalid={Boolean(errors.amount)} aria-describedby={described('amount')} />{fieldError('amount')}</div>
            <div className="field"><label htmlFor="schedule-recurrence">Recurrence</label><select id="schedule-recurrence" value={recurrence} onChange={event => setRecurrence(event.target.value as Recurrence)}><option value="ONCE">One-time</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option></select><p className="field-hint">Weekly schedules keep the weekday selected in the intended local date.</p></div>
            <div className="field"><label htmlFor="schedule-local">Intended local date and time</label><input id="schedule-local" type="datetime-local" step="1" value={local} onChange={event => setLocal(event.target.value)} aria-invalid={Boolean(errors.local)} aria-describedby={described('local')} />{fieldError('local')}</div>
            <div className="field"><label htmlFor="schedule-zone">IANA time zone</label><input id="schedule-zone" list="schedule-zones" value={zone} onChange={event => setZone(event.target.value)} spellCheck={false} autoComplete="off" aria-invalid={Boolean(errors.zone)} aria-describedby={described('zone')} /><datalist id="schedule-zones"><option value="America/Halifax" /><option value="UTC" /></datalist>{fieldError('zone')}</div>
            <button className="button button-primary" type="submit">{reviewing ? 'Checking schedule…' : 'Review schedule'}</button>
          </fieldset>
        </form>
      </section><Policy />
    </div>}
    <ConfirmDialog open={Boolean(review)} title={initial ? 'Confirm schedule edit' : 'Confirm schedule'} description="Review the exact instruction and the server-resolved time. Confirmation saves a schedule; it does not mean a transfer has executed." confirmLabel={initial ? 'Save schedule edit' : 'Create schedule'} busy={mutation.busy} onCancel={() => setReview(undefined)} onConfirm={() => void confirm()} initialFocus="cancel">
      {review && <><DefinitionSummary definition={review.definition} /><TimePreview value={review.preview} />{initial && <p>Expected definition version: {initial.version}. A stale version will be rejected, not overwritten.</p>}</>}
    </ConfirmDialog>
  </>;
}

function CreateSchedule({ navigate }: { navigate: ProductNavigate }): JSX.Element {
  usePageTitle('New schedule');
  return <><header className="page-heading"><p className="eyebrow">Schedule a transfer</p><h1>New schedule</h1><p>Set a future instruction using exact money and an explicit local time zone.</p></header><ScheduleForm navigate={navigate} /></>;
}

function EditSchedule({ id, navigate }: { id: string; navigate: ProductNavigate }): JSX.Element {
  usePageTitle('Edit schedule');
  const load = useCallback((api: ApiClient) => api.scheduleById(id), [id]);
  const resource = useResource(load);
  const { current, failure } = useStoredIntent();
  return <>
    <header className="page-heading p08b-heading"><div><p className="eyebrow">Version-aware changes</p><h1>Edit schedule</h1><p>Your reviewed definition version stays fixed until you explicitly reload it.</p></div><button className="button button-secondary" type="button" disabled={resource.loading || unresolved(current) || failure !== undefined} onClick={resource.reload}>Load current definition</button></header>
    {resource.loading && <LoadingState />}
    {resource.failure !== undefined && <ReadFailure failure={resource.failure} retry={resource.reload} />}
    {resource.data && (scheduleActionAllowed(resource.data.status, 'EDIT') ? <ScheduleForm key={`${resource.data.version}:${resource.data.eventVersion}`} initial={resource.data} navigate={navigate} /> : <EmptyState title="This schedule cannot be edited" message="Cancelled and finished schedules retain their history but do not accept new definitions." action={<Link href={`/schedules/${id}`} navigate={navigate} className="button button-secondary">View schedule</Link>} />)}
  </>;
}

function CommandReceipt({ response }: { response: CommandResponse<ScheduleReceipt> }): JSX.Element {
  return <section className="schedule-confirmed" role="status"><h2>Schedule instruction confirmed</h2><p>{response.replayed ? 'The original command receipt was replayed.' : 'The command was durably accepted.'} This confirms the instruction, not execution of a transfer.</p><dl className="schedule-summary"><div><dt>Schedule reference</dt><dd><code>{response.body.id}</code></dd></div><div><dt>Definition version</dt><dd>{response.body.version}</dd></div><div><dt>Lifecycle event version</dt><dd>{response.body.eventVersion}</dd></div><div><dt>State at command acceptance</dt><dd>{STATUS[response.body.status]}</dd></div></dl></section>;
}

function Occurrences({ id, navigate }: { id: string; navigate: ProductNavigate }): JSX.Element {
  const [offset, setOffset] = useState(0);
  const load = useCallback((api: ApiClient) => api.scheduleOccurrences(id, PAGE_SIZE, offset), [id, offset]);
  const resource = useResource(load);
  const outcome = (value: ScheduleOccurrence['outcome']) => value === 'SUCCEEDED' ? 'Succeeded' : value === 'REJECTED' ? 'Failed' : 'Skipped late';
  return <section className="schedule-history" aria-labelledby="occurrences-heading">
    <div className="schedule-section-heading"><div><p className="eyebrow">Immutable execution evidence</p><h2 id="occurrences-heading">Occurrence history</h2></div><button type="button" className="button button-secondary" disabled={resource.loading} onClick={resource.reload}>Refresh occurrences</button></div>
    <p>Recorded local times belong to their original definition version. UTC due instants are authoritative; a later zone edit does not reinterpret older history.</p>
    {resource.loading && <LoadingState label="Loading recorded occurrences" />}
    {resource.failure !== undefined && <ReadFailure failure={resource.failure} retry={resource.reload} />}
    {resource.data && (resource.data.items.length ? <div className="schedule-occurrences">{resource.data.items.map(item => <article className="schedule-occurrence" key={item.id}>
      <h3>{outcome(item.outcome)}</h3><dl className="schedule-summary"><div><dt>Recorded local occurrence</dt><dd>{item.intendedLocal.replace('T', ' ')}</dd></div><div><dt>Due instant (UTC)</dt><dd><code>{item.dueAt}</code></dd></div><div><dt>Definition version</dt><dd>{item.scheduleVersion}</dd></div><div><dt>Occurrence reference</dt><dd><code>{item.id}</code></dd></div>
      {item.errorCode && <div><dt>Recorded reason</dt><dd><code>{item.errorCode}</code></dd></div>}
      {item.journalId && <div><dt>Journal reference</dt><dd><code>{item.journalId}</code></dd></div>}</dl>
      {item.outcome === 'SUCCEEDED' && item.operationId && <Link href={`/transfers/${item.operationId}`} navigate={navigate} className="button button-secondary">View executed transfer</Link>}
      {item.outcome !== 'SUCCEEDED' && <p>No successful transfer is claimed for this occurrence.</p>}
    </article>)}</div> : <EmptyState title="No occurrences on this page" message="A schedule is an instruction, not proof of execution. Results appear here after the scheduler records them." />)}
    {resource.data && <Pager label="occurrence" offset={offset} page={resource.data} loading={resource.loading} onPage={setOffset} />}
  </section>;
}

function ScheduleDetail({ id, navigate }: { id: string; navigate: ProductNavigate }): JSX.Element {
  usePageTitle('Schedule detail');
  const load = useCallback((api: ApiClient) => api.scheduleById(id), [id]);
  const resource = useResource(load);
  const mutation = useScheduleMutation();
  const saved = useStoredIntent();
  const [review, setReview] = useState<ScheduleCommand>();
  const [receipt, setReceipt] = useState<CommandResponse<ScheduleReceipt>>();
  const [historyRevision, setHistoryRevision] = useState(0);
  const blocked = unresolved(saved.current) || saved.failure !== undefined || mutation.busy;
  const confirm = async () => {
    if (!review) return;
    const response = await mutation.send(review); setReview(undefined);
    if (response) { setReceipt(response); resource.reload(); setHistoryRevision(value => value + 1); }
  };
  const record = resource.data;
  return <>
    <header className="page-heading p08b-heading"><div><p className="eyebrow">Authoritative schedule record</p><h1>Schedule detail</h1><p><code>{id}</code></p></div><Link href="/schedules" navigate={navigate} className="button button-secondary">All schedules</Link></header>
    <MutationBlock navigate={navigate} />
    {receipt && <CommandReceipt response={receipt} />}
    {mutation.failure !== undefined && <ProblemPanel failure={mutation.failure} />}
    {resource.loading && <LoadingState />}
    {resource.failure !== undefined && <ReadFailure failure={resource.failure} retry={resource.reload} />}
    {record && <>
      <section className="schedule-detail-card"><div className="schedule-section-heading"><h2>{RECURRENCE[record.recurrence]} transfer</h2><ScheduleBadge status={record.status} /></div>
        <DefinitionSummary definition={record} />
        <dl className="schedule-summary"><div><dt>Definition version</dt><dd>{record.version}</dd></div><div><dt>Lifecycle event version</dt><dd>{record.eventVersion}</dd></div><div><dt>Last updated (UTC)</dt><dd><code>{record.updatedAt}</code></dd></div></dl>
        {record.status === 'ACTIVE' ? <div className="schedule-next"><h3>Next execution</h3><p><time dateTime={record.nextInstant}>{scheduleTime(record.nextInstant, record.zoneId)}</time></p><p>UTC: <code>{record.nextInstant}</code></p></div> : <p className="schedule-warning">No future execution is scheduled while the status is {STATUS[record.status].toLowerCase()}. An occurrence claimed before a control command may still complete.</p>}
        <div className="schedule-controls">
          {!blocked && scheduleActionAllowed(record.status, 'EDIT') ? <Link href={`/schedules/${id}/edit`} navigate={navigate} className="button button-secondary">Edit schedule</Link> : <button type="button" className="button button-secondary" disabled>Edit schedule</button>}
          {(['PAUSE', 'RESUME', 'CANCEL'] as const).map(action => <button key={action} type="button" className="button button-secondary" disabled={blocked || !scheduleActionAllowed(record.status, action)} onClick={() => setReview({ action, scheduleId: id, expectedVersion: record.version })}>{ACTION[action][0]?.toUpperCase()}{ACTION[action].slice(1)} schedule</button>)}
          <button className="button button-secondary" type="button" disabled={mutation.busy} onClick={() => { resource.reload(); setHistoryRevision(value => value + 1); }}>Refresh schedule</button>
        </div><p className="field-hint">Pause is available only while active; resume only while paused. Cancel and edit are unavailable after cancellation or completion. Resolve uncertain instructions before any new change.</p>
      </section>
      <Occurrences key={`${id}:${historyRevision}`} id={id} navigate={navigate} />
      <Policy />
    </>}
    <ConfirmDialog open={Boolean(review)} title={`Confirm ${review && 'scheduleId' in review && review.action !== 'EDIT' ? ACTION[review.action] : 'schedule action'}`} description="This control affects not-yet-claimed occurrences. Already claimed work may finish; financial history is never removed. Resume does not resurrect intentionally skipped obligations." confirmLabel="Confirm schedule action" busy={mutation.busy} onCancel={() => setReview(undefined)} onConfirm={() => void confirm()} initialFocus="cancel">
      {review && 'expectedVersion' in review && <p>Expected definition version: {review.expectedVersion}. The original command and key will be retained if the response is lost.</p>}
    </ConfirmDialog>
  </>;
}

function ScheduleRecovery({ navigate }: { navigate: ProductNavigate }): JSX.Element {
  usePageTitle('Resolve schedule instruction');
  const mutation = useScheduleMutation();
  const saved = useStoredIntent();
  const [receipt, setReceipt] = useState<CommandResponse<ScheduleReceipt>>();
  const command = saved.current?.kind === 'schedules' ? saved.current.intent as ScheduleCommand : undefined;
  const retry = async () => { const result = await mutation.send(); if (result) setReceipt(result); };
  return <>
    <header className="page-heading"><p className="eyebrow">Same-key recovery</p><h1>Resolve schedule instruction</h1><p>No automatic resubmission occurs here. Review the preserved command and explicitly retry its original key.</p></header>
    {mutation.failure !== undefined && <ProblemPanel failure={mutation.failure} />}
    {receipt ? <><CommandReceipt response={receipt} /><Link href={`/schedules/${receipt.body.id}`} navigate={navigate} className="button button-primary">View confirmed schedule</Link></> : command && unresolved(saved.current) && saved.failure === undefined ? <section className="schedule-detail-card">
      <h2>{saved.current.state === 'UNCERTAIN' ? 'Outcome not yet confirmed' : 'Original instruction ready to resume'}</h2>
      <p>Preserved action: <strong>{command.action}</strong>. A timeout, session failure or later read denial does not prove this instruction failed.</p>
      {'definition' in command && <DefinitionSummary definition={command.definition} />}
      {'scheduleId' in command && <p>Schedule: <code>{command.scheduleId}</code><br />Original expected definition version: {command.expectedVersion}</p>}
      <p>The original normalized body, owner and idempotency key are unchanged. A new key or newer definition version will not be substituted.</p>
      <button className="button button-primary" type="button" disabled={mutation.busy} onClick={() => void retry()}>{mutation.busy ? 'Resolving instruction…' : 'Retry same schedule instruction'}</button>
    </section> : <EmptyState title="No unresolved schedule instruction" message="Only the signed-in customer's preserved schedule commands can be recovered here." action={<Link href="/schedules" navigate={navigate} className="button button-secondary">View schedules</Link>} />}
  </>;
}

export function P08DRoutes({ path, navigate }: { path: string; navigate: ProductNavigate }): JSX.Element {
  const session = useSession();
  const route = scheduleRoute(path);
  let page: JSX.Element;
  if (session.user?.role !== 'CUSTOMER') page = <><h1>Customer schedules</h1><EmptyState title="Customer access required" message="Administrator access does not grant authority to create customer spending instructions." /></>;
  else if (route?.kind === 'list') page = <ScheduleList navigate={navigate} />;
  else if (route?.kind === 'create') page = <CreateSchedule navigate={navigate} />;
  else if (route?.kind === 'recovery') page = <ScheduleRecovery navigate={navigate} />;
  else if (route?.kind === 'edit' && route.id) page = <EditSchedule key={route.id} id={route.id} navigate={navigate} />;
  else if (route?.kind === 'detail' && route.id) page = <ScheduleDetail key={route.id} id={route.id} navigate={navigate} />;
  else page = <><h1>Schedule page not found</h1><Link href="/schedules" navigate={navigate}>Return to schedules</Link></>;
  return <ProductShell navigate={navigate}><div className="page page-detail schedule-page" key={`${session.user?.id}:${path}`}>{page}</div></ProductShell>;
}
