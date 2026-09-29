import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PropsWithChildren, type ReactNode } from 'react';
import { ApiError, type Page } from './api.js';
import { AdminApi, ReconciliationIntent, adminQuery, type AdminDetail, type AdminQuery, type AdminTransaction, type AuditPage, type FailedWork, type ReconciliationReport, type Snapshot } from './admin-api.js';
import { formatMoney, humanKind } from './format.js';
import { ProductShell, Link, LoadingState, EmptyState, ProblemPanel, ConfirmDialog, usePageTitle } from './product-ui.js';
import { useSession } from './session.js';
import type { ProductNavigate } from './p08b-ui.js';
import './p08f.css';

function useRead<T>(load: (api: AdminApi)=>Promise<T>, identity: string): {data?: T; failure?: unknown; loading: boolean; refresh: ()=>void} {
  const session=useSession(); const [revision,setRevision]=useState(0);
  const [state,setState]=useState<{identity:string;data?:T;failure?:unknown;loading:boolean}>({identity,loading:true});
  const loader=useRef(load);loader.current=load;
  useEffect(()=>{
    let active=true;setState({identity,loading:true});
    void session.execute(api=>loader.current(new AdminApi(api))).then(data=>{if(active)setState({identity,data,loading:false});},failure=>{if(active)setState({identity,failure,loading:false});});
    return ()=>{active=false;};
  },[identity,revision,session.execute]);
  const refresh=useCallback(()=>setRevision(v=>v+1),[]);
  // Never flash another resource's records while navigation starts its next effect.
  return {...(state.identity===identity?state:{identity,loading:true}),refresh};
}
function ReadState({loading,failure,refresh,children}: PropsWithChildren<{loading:boolean;failure?:unknown;refresh:()=>void}>): JSX.Element {
  if(loading) return <LoadingState label="Reading protected administrator records"/>;
  if(failure!==undefined) return <><ProblemPanel failure={failure}/><button className="button button-secondary" onClick={refresh}>Retry loading records</button></>;
  return <>{children}</>;
}
function Reference({children}: {children: string|null|undefined}): JSX.Element {return <code className="admin-reference">{children??'Not applicable'}</code>;}
function UTC({value}: {value: string|null|undefined}): JSX.Element {return value?<time className="admin-time" dateTime={value}>{value}</time>:<span>Not recorded</span>;}
function Tone({value}: {value:string}): JSX.Element {
  const tone=['SETTLED','PASS','REPUBLISHED'].includes(value)?'positive':['FAILED','DISCREPANCIES'].includes(value)?'negative':'neutral';
  return <span className={`admin-status admin-status-${tone}`}>{humanKind(value)}</span>;
}
function SnapshotNote({value}: {value:Snapshot}): JSX.Element {return <aside className="admin-snapshot" aria-label="Database snapshot"><strong>Read-only database snapshot</strong><UTC value={value.capturedAt}/><span>Repeatable read · <Reference>{value.snapshotId}</Reference></span><small>Records describe this read, not a continuously live result.</small></aside>;}
function Heading({title,description,actions}: {title:string;description:string;actions?:ReactNode}): JSX.Element {
  usePageTitle(title); const ref=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{ref.current?.focus();},[title]);
  return <div className="admin-heading"><div><p className="eyebrow">Administrator · Synthetic money only</p><h1 ref={ref} tabIndex={-1}>{title}</h1><p>{description}</p></div>{actions}</div>;
}
function Section({title,children,id}:PropsWithChildren<{title:string;id?:string}>): JSX.Element {return <section className="admin-panel"><h2 id={id} tabIndex={id?-1:undefined}>{title}</h2>{children}</section>;}
function Pager({page,navigate,path,query=''}: {page:Page<unknown>;navigate:ProductNavigate;path:string;query?:string}): JSX.Element {
  const change=(offset:number)=>{const q=new URLSearchParams(query);q.set('limit',String(page.limit));q.set('offset',String(offset));navigate(`${path}?${q}`);};
  return <nav className="admin-pager" aria-label="Result pages"><span role="status">{page.items.length===0?'No records on this page':`Records ${page.offset+1}–${page.offset+page.items.length}`}</span><div><button className="button button-secondary" disabled={page.offset===0} onClick={()=>change(Math.max(0,page.offset-page.limit))}>Previous page</button><button className="button button-secondary" disabled={!page.hasMore || page.offset+page.limit>10000} onClick={()=>change(page.offset+page.limit)}>Next page</button></div>{page.hasMore && page.offset+page.limit>10000 && <p>Narrow the filters to continue beyond the pagination limit.</p>}</nav>;
}
function Table({label,children}:PropsWithChildren<{label:string}>): JSX.Element {return <div className="admin-table-scroll" role="region" aria-label={label} tabIndex={0}><table className="admin-table">{children}</table></div>;}
function Transactions({items,navigate}: {items:AdminTransaction[];navigate:ProductNavigate}): JSX.Element {
  if(!items.length) return <EmptyState title="No matching transactions" message="No operation matched these filters in this database snapshot."/>;
  return <Table label="Transaction search results"><thead><tr><th scope="col">Operation</th><th scope="col">Kind / state</th><th scope="col">Exact amount</th><th scope="col">From / to</th><th scope="col">Created (UTC)</th></tr></thead><tbody>{items.map(t=><tr key={`${t.kind}:${t.id}`}><td><Link href={`/admin/transactions/${t.id}`} navigate={navigate} ariaLabel={`Inspect ${t.kind.toLowerCase()} ${t.id}`}><Reference>{t.id}</Reference></Link></td><td>{humanKind(t.kind)}<br/><Tone value={t.state}/></td><td className="admin-money">{formatMoney(t.amountMinor,t.currency)}</td><td><Reference>{t.sourceRef}</Reference><span className="admin-direction">to</span><Reference>{t.destinationRef}</Reference></td><td><UTC value={t.createdAt}/></td></tr>)}</tbody></Table>;
}
type FilterField={key:string;label:string;options?:readonly string[];placeholder?:string};
const txFields:FilterField[]=[
  {key:'reference',label:'Transaction or journal UUID'},{key:'kind',label:'Transaction kind',options:['FUNDING','TRANSFER','PAYMENT','REFUND','REVERSAL']},
  {key:'status',label:'Lifecycle status',options:['PENDING','SETTLED','FAILED','CANCELLED']},{key:'account',label:'Account UUID or LG reference'},
  {key:'user',label:'User UUID or email'},{key:'currency',label:'Currency',options:['CAD','USD','JPY','KWD']},
  {key:'minAmountMinor',label:'Minimum amount (minor units)',placeholder:'0'},{key:'maxAmountMinor',label:'Maximum amount (minor units)'},
  {key:'from',label:'From UTC (inclusive)',placeholder:'2026-01-01T00:00:00Z'},{key:'to',label:'To UTC (exclusive)',placeholder:'2027-01-01T00:00:00Z'}];
const auditFields:FilterField[]=[{key:'aggregateId',label:'Aggregate UUID'},{key:'operationId',label:'Operation UUID'},{key:'actorId',label:'Actor UUID'},{key:'correlationId',label:'Correlation UUID'},
  {key:'action',label:'Exact audit action',placeholder:'PAYMENT_SETTLED'},{key:'from',label:'From UTC (inclusive)',placeholder:'2026-01-01T00:00:00Z'},
  {key:'to',label:'To UTC (exclusive)',placeholder:'2027-01-01T00:00:00Z'}];
function Filters({kind,query,navigate,path}: {kind:'transactions'|'audit';query:string;navigate:ProductNavigate;path:string}): JSX.Element {
  const [failure,setFailure]=useState<unknown>();const current=new URLSearchParams(query);const fields=kind==='transactions'?txFields:auditFields;
  const submit=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();try{const values=Object.fromEntries(new FormData(event.currentTarget).entries()) as AdminQuery;values.offset='0';navigate(`${path}?${adminQuery(values,kind)}`);setFailure(undefined);}catch(error){setFailure(error);}};
  return <form className="admin-panel admin-filter-form" onSubmit={submit} noValidate><h2>Search filters</h2><p id="admin-filter-help">Use complete references and UTC timestamps ending in Z. Amount ranges are exact integer minor units in the selected currency; no currency conversion is performed.</p>
    {failure!==undefined && <ProblemPanel failure={failure}/>}
    <div className="admin-filter-grid">{fields.map(field=><label key={field.key} htmlFor={`admin-${field.key}`}>{field.label}{field.options?<select id={`admin-${field.key}`} name={field.key} defaultValue={current.get(field.key)??''}><option value="">All</option>{field.options.map(option=><option key={option}>{option}</option>)}</select>:<input id={`admin-${field.key}`} name={field.key} type="text" maxLength={254} defaultValue={current.get(field.key)??''} placeholder={field.placeholder} inputMode={field.key.includes('Amount')?'numeric':undefined} aria-describedby="admin-filter-help"/>}</label>)}
    <label htmlFor="admin-limit">Results per page<select id="admin-limit" name="limit" defaultValue={current.get('limit')??'25'}>{['1','10','25','50','100'].map(n=><option key={n}>{n}</option>)}</select></label></div>
    {current.get('parentId') && <><input type="hidden" name="parentId" value={current.get('parentId')!}/><p>Adjustments for parent <Reference>{current.get('parentId')}</Reference></p></>}
    <div className="admin-actions"><button className="button button-primary" type="submit">Apply filters</button><Link href={path} navigate={navigate} className="button button-secondary">Clear filters</Link></div></form>;
}
function SearchScreen({query,navigate}: {query:string;navigate:ProductNavigate}): JSX.Element {
  const read=useRead(api=>api.search(new URLSearchParams(query)),`transactions?${query}`);
  useEffect(()=>{if(query && read.data) document.getElementById('admin-search-results')?.focus();},[query,read.data]);
  return <><Heading title="Transaction investigation" description="Find a financial operation, then inspect its authoritative lifecycle, double-entry posting and linked history."/>
    <Filters key={query} kind="transactions" query={query} path="/admin/transactions" navigate={navigate}/>
    <ReadState {...read}>{read.data && <><SnapshotNote value={read.data.snapshot}/><Section id="admin-search-results" title="Matching operations"><Transactions items={read.data.results.items} navigate={navigate}/><Pager page={read.data.results} path="/admin/transactions" query={query} navigate={navigate}/></Section></>}</ReadState></>;
}
function DetailContent({data,navigate}: {data:AdminDetail;navigate:ProductNavigate}): JSX.Element {
  const t=data.transaction;const aggregate=t.parentId??t.id;
  return <><SnapshotNote value={data.snapshot}/><div className="admin-detail-grid"><Section title="Authoritative operation"><dl className="admin-facts"><dt>Operation</dt><dd><Reference>{t.id}</Reference></dd><dt>Kind</dt><dd>{humanKind(t.kind)}</dd><dt>Lifecycle</dt><dd><Tone value={t.state}/></dd><dt>Amount</dt><dd className="admin-money">{formatMoney(t.amountMinor,t.currency)} <small>({t.amountMinor} minor units)</small></dd><dt>Version</dt><dd>{t.version}</dd><dt>Adjustment state</dt><dd>{humanKind(t.adjustmentState)}</dd><dt>Actor</dt><dd><Reference>{t.actorId}</Reference></dd><dt>Journal</dt><dd><Reference>{t.journalId}</Reference></dd><dt>Created</dt><dd><UTC value={t.createdAt}/></dd><dt>Updated</dt><dd><UTC value={t.updatedAt}/></dd>{t.parentId && <><dt>Parent payment</dt><dd><Link href={`/admin/transactions/${t.parentId}`} navigate={navigate}><Reference>{t.parentId}</Reference></Link></dd></>}</dl></Section>
    <Section title="Posting direction"><dl className="admin-facts"><dt>Source account</dt><dd><Reference>{t.sourceRef}</Reference></dd><dt>Source owner</dt><dd><Reference>{t.sourceUserId}</Reference></dd><dt>Destination account</dt><dd><Reference>{t.destinationRef}</Reference></dd><dt>Destination owner</dt><dd><Reference>{t.destinationUserId}</Reference></dd></dl><p>For refunds and reversals, source and destination show the compensating movement, not the original payment direction. This view cannot change balances.</p>{data.payment && <dl className="admin-facts"><dt>Hold state</dt><dd>{data.payment.holdState??'No hold'}</dd><dt>Refunded amount</dt><dd>{formatMoney(data.payment.refundedMinor,t.currency)}</dd><dt>Projection</dt><dd>{data.payment.projectionState??'Not observed'} · version {data.payment.projectionVersion??'not observed'}</dd><dt>Failure code</dt><dd>{data.payment.failureCode??'None recorded'}</dd></dl>}<p>Projection lag does not change the authoritative lifecycle above.</p></Section></div>
    <Section title="Immutable journal entries">{data.entries.length?<Table label="Journal entries"><thead><tr><th scope="col">Entry / account</th><th scope="col">Side</th><th scope="col">Exact amount</th><th scope="col">Account class</th></tr></thead><tbody>{data.entries.map(e=><tr key={e.id}><td><span>Entry {e.id}</span><br/><Reference>{e.accountRef}</Reference></td><td>{e.side}</td><td className="admin-money">{formatMoney(e.amountMinor,e.currency)}</td><td>{humanKind(e.accountKind)}</td></tr>)}</tbody></Table>:<p>No journal is attached to this operation. A pending, failed or cancelled payment must not be displayed as settled.</p>}</Section>
    <Section title="Related adjustments"><Transactions items={data.adjustments.items} navigate={navigate}/>{data.adjustments.hasMore && <Link href={`/admin/transactions?parentId=${t.id}`} navigate={navigate}>View all adjustments</Link>}{(t.kind==='PAYMENT' || t.parentId) && <p><Link href={`/admin/payments/${aggregate}/reversal`} navigate={navigate}>Open protected adjustment controls</Link></p>}</Section>
    {t.parentId && <p><Link href={`/admin/payments/${t.parentId}/adjustments/${t.id}`} navigate={navigate}>View immutable adjustment receipt and recorded reason</Link></p>}
    <Section title="Connected audit and durable work"><p>Audit integrity is <strong>not checked by this detail read</strong>. Reconciliation verifies the hash chains within its own recorded snapshot.</p><div className="admin-actions"><Link href={`/admin/audit?aggregateId=${aggregate}`} navigate={navigate} className="button button-secondary">View financial audit history</Link><Link href="/admin/reconciliation" navigate={navigate} className="button button-secondary">Reconciliation results</Link></div>
    <h3>Outbox events</h3>{data.events.items.length?<Table label="Related outbox events"><thead><tr><th scope="col">Event</th><th scope="col">Type / version</th><th scope="col">Correlation</th><th scope="col">Publication</th></tr></thead><tbody>{data.events.items.map(e=><tr key={e.id}><td><Reference>{e.id}</Reference></td><td>{e.eventType}<br/>Version {e.aggregateVersion}</td><td><Link href={`/admin/audit?correlationId=${e.correlationId}`} navigate={navigate}><Reference>{e.correlationId}</Reference></Link></td><td>{e.failedAt?'Failed':e.publishedAt?'Published':'Pending'}<br/><UTC value={e.publishedAt??e.failedAt}/></td></tr>)}</tbody></Table>:<p>No related outbox events.</p>}{data.events.hasMore && <p>Only the first 25 related events are shown. The result is bounded, not a complete event export.</p>}
    <h3>Failed work</h3>{data.failedWork.items.length?<ul className="admin-related">{data.failedWork.items.map(w=><li key={w.id}><Link href={`/admin/failed-work/${w.id}`} navigate={navigate}><Reference>{w.id}</Reference></Link> — {w.consumer} · {humanKind(w.state)}</li>)}</ul>:<p>No related failed-work records.</p>}{data.failedWork.hasMore && <Link href="/admin/failed-work" navigate={navigate}>Inspect the full paged failed-work history</Link>}</Section></>;
}
function DetailScreen({id,navigate}: {id:string;navigate:ProductNavigate}): JSX.Element {
  const read=useRead(api=>api.detail(id),`detail:${id}`);
  return <><Heading title="Transaction and ledger detail" description="Both posting sides are available only to authorized administrators." actions={<Link href="/admin/transactions" navigate={navigate} className="button button-secondary">Back to transaction search</Link>}/><ReadState {...read}>{read.data && <DetailContent data={read.data} navigate={navigate}/>}</ReadState></>;
}
function AuditScreen({query,navigate}: {query:string;navigate:ProductNavigate}): JSX.Element {
  const read=useRead<AuditPage>(api=>api.audit(new URLSearchParams(query)),`audit?${query}`);
  return <><Heading title="Financial audit history" description="Append-only financial events, separate from authentication failures and operational replay logs."/><Filters key={query} kind="audit" query={query} path="/admin/audit" navigate={navigate}/>
    <ReadState {...read}>{read.data && <><SnapshotNote value={read.data.snapshot}/><Section title="Recorded financial events"><p>Integrity is <strong>not checked in this list</strong>. Canonical payloads and free-form metadata are omitted. Protected adjustment receipts retain the recorded adjustment reasons.</p><Link href="/admin/reconciliation" navigate={navigate}>Inspect independent audit-chain verification</Link>
      {read.data.results.items.length?<Table label="Financial audit events"><thead><tr><th scope="col">Action / sequence</th><th scope="col">Operation</th><th scope="col">Actor</th><th scope="col">Version / correlation</th><th scope="col">Occurred (UTC)</th></tr></thead><tbody>{read.data.results.items.map(a=><tr key={`${a.aggregateId}:${a.sequence}`}><td>{humanKind(a.action)}<br/>Sequence {a.sequence}</td><td><Reference>{a.operationId}</Reference><small>Aggregate <Reference>{a.aggregateId}</Reference></small></td><td>{a.actorId?<Reference>{a.actorId}</Reference>:'System'}</td><td>Version {a.aggregateVersion}<br/><Reference>{a.correlationId}</Reference></td><td><UTC value={a.occurredAt}/></td></tr>)}</tbody></Table>:<EmptyState title="No matching audit records" message="No financial event matched these filters."/>}<Pager page={read.data.results} query={query} path="/admin/audit" navigate={navigate}/></Section></>}</ReadState></>;
}
function ReconciliationScreen({query,navigate}: {query:string;navigate:ProductNavigate}): JSX.Element {
  const session=useSession();const read=useRead(api=>api.history(new URLSearchParams(query)),`reconciliation?${query}`);
  const intent=useMemo(()=>new ReconciliationIntent(window.localStorage,session.user!.id),[session.user!.id]);
  const [pending,setPending]=useState<string>();const [failure,setFailure]=useState<unknown>();const [storageFailure,setStorageFailure]=useState<unknown>();const [running,setRunning]=useState(false);
  useEffect(()=>{try{setPending(intent.current());}catch(error){setStorageFailure(error);}},[intent]);
  const run=async()=>{
    setFailure(undefined);setRunning(true);
    try {const id=intent.prepare(pending??crypto.randomUUID());setPending(id);const report=await session.execute(api=>new AdminApi(api).run(id));intent.complete(id);setPending(undefined);navigate(`/admin/reconciliation/${report.id}`);}
    catch(error){setFailure(error);}finally{setRunning(false);}
  };
  return <><Heading title="Reconciliation results" description="Independent accounting checks, saved with their database snapshot and scope. A clean historical report is not a live health guarantee."/>
    <Section title="Run independent reconciliation"><p>The financial scan is enforced read-only by PostgreSQL. Only the finished report is inserted into reporting history. There is no repair, top-up or balancing-entry action.</p>
      {storageFailure!==undefined && <ProblemPanel failure={storageFailure}/>}{failure!==undefined && <ProblemPanel failure={failure}/>}
      {pending && <aside className="admin-notice" role="status"><strong>Saved report request</strong><Reference>{pending}</Reference><p>Its outcome may be unconfirmed. Resume this same request to recover the original saved report; do not create a replacement.</p></aside>}
      <button className="button button-primary" onClick={()=>void run()} disabled={running || storageFailure!==undefined}>{running?'Checking database snapshot…':pending?'Resume saved report request':'Run reconciliation'}</button><p className="admin-muted">Checks cover entries/balances, holds, postings, adjustments, command outcomes, durable work and audit hash chains. Failure to complete is an error, never a pass.</p></Section>
    <ReadState {...read}>{read.data && <Section title="Saved report history">{read.data.items.length?<Table label="Saved reconciliation reports"><thead><tr><th scope="col">Report</th><th scope="col">Snapshot result</th><th scope="col">Discrepancies</th><th scope="col">Snapshot (UTC)</th></tr></thead><tbody>{read.data.items.map(r=><tr key={r.id}><td><Link href={`/admin/reconciliation/${r.id}`} navigate={navigate}><Reference>{r.id}</Reference></Link></td><td><Tone value={r.status}/></td><td>{r.discrepancyCount}</td><td><UTC value={r.snapshotAt}/></td></tr>)}</tbody></Table>:<EmptyState title="No saved reports" message="No P08F reconciliation has been completed and saved. Run the checks to create a real result."/>}<Pager page={read.data} query={query} path="/admin/reconciliation" navigate={navigate}/></Section>}</ReadState></>;
}
function ReportContent({data,navigate}: {data:ReconciliationReport;navigate:ProductNavigate}): JSX.Element {return <>
  <SnapshotNote value={data.snapshot}/><Section title={data.status==='PASS'?'Passed at the recorded snapshot':'Discrepancies found'}><Tone value={data.status}/><p className="admin-result-total"><strong>{data.discrepancyCount}</strong> detected discrepancies across {data.checks.length} executed checks.</p><dl className="admin-facts"><dt>Report</dt><dd><Reference>{data.id}</Reference></dd><dt>Requested by</dt><dd><Reference>{data.actorId}</Reference></dd><dt>Scope</dt><dd>{data.scope}</dd><dt>Completed</dt><dd><UTC value={data.completedAt}/></dd></dl><p>This is a saved historical result. It is not a production-readiness or security certification.</p></Section>
  <Section title="Records included in the snapshot"><dl className="admin-count-grid">{Object.entries(data.totals).map(([key,value])=><div key={key}><dt>{humanKind(key)}</dt><dd>{value}</dd></div>)}</dl><p>Pending work is shown separately from discrepancies. Backlog by itself is not proof of accounting corruption.</p></Section>
  <Section title="Executed independent checks">{data.checks.map(check=><article className="admin-check" key={check.id}><div><h3>{check.title}</h3><Tone value={check.status}/></div><p>{check.discrepancyCount} discrepancies · <code>{check.id}</code></p>{check.samples.length>0 && <ul>{check.samples.map((sample,index)=><li key={index}><Reference>{sample.identity}</Reference><p>{sample.detail}</p></li>)}</ul>}{check.hasMore && <p>Only ten sample identities are shown. The discrepancy count includes all findings; narrow investigation using the recorded references.</p>}</article>)}</Section>
  <Section title="Scope and limitations"><ul>{data.limitations.map(note=><li key={note}>{note}</li>)}</ul><Link href="/admin/transactions" navigate={navigate}>Investigate a recorded operation</Link></Section></>;}
function ReportScreen({id,navigate}: {id:string;navigate:ProductNavigate}): JSX.Element {
  const read=useRead(api=>api.report(id),`report:${id}`);
  return <><Heading title="Reconciliation report" description="Immutable reporting history, independent findings and bounded discrepancy examples." actions={<Link href="/admin/reconciliation" navigate={navigate} className="button button-secondary">Back to reports</Link>}/><ReadState {...read}>{read.data && <ReportContent data={read.data} navigate={navigate}/>}</ReadState></>;
}
function FailedWorkScreen({query,navigate}: {query:string;navigate:ProductNavigate}): JSX.Element {
  const read=useRead(api=>api.failedWork(new URLSearchParams(query)),`failed-work?${query}`);
  return <><Heading title="Failed-work inspection" description="Inspect durable processing failures. Replay requests reuse the original event identity; they are not new financial instructions."/><ReadState {...read}>{read.data && <Section title="Durable work records">{read.data.items.length?<Table label="Failed work"><thead><tr><th scope="col">Work / event</th><th scope="col">Consumer</th><th scope="col">State / failure</th><th scope="col">Updated (UTC)</th></tr></thead><tbody>{read.data.items.map(w=><tr key={w.id}><td><Link href={`/admin/failed-work/${w.id}`} navigate={navigate}><Reference>{w.id}</Reference></Link><small>Event <Reference>{w.eventId}</Reference></small></td><td>{w.consumer}</td><td><Tone value={w.state}/><br/>{w.failureCode}</td><td><UTC value={w.updatedAt}/></td></tr>)}</tbody></Table>:<EmptyState title="No failed-work records" message="No durable processing failures are recorded in this environment."/>}<Pager page={read.data} query={query} path="/admin/failed-work" navigate={navigate}/></Section>}</ReadState></>;
}
function WorkContent({data,refresh}: {data:FailedWork;refresh:()=>void}): JSX.Element {
  const session=useSession();const [confirm,setConfirm]=useState(false);const [busy,setBusy]=useState(false);const [failure,setFailure]=useState<unknown>();const [uncertain,setUncertain]=useState(false);const [accepted,setAccepted]=useState(false);const trigger=useRef<HTMLButtonElement>(null);
  const replay=async()=>{setBusy(true);setFailure(undefined);try{await session.execute(api=>new AdminApi(api).requestReplay(data.id));setAccepted(true);setConfirm(false);refresh();}catch(error){setConfirm(false);setFailure(error);setUncertain(!(error instanceof ApiError && error.status<500));}finally{setBusy(false);}};
  return <><Section title="Processing record"><dl className="admin-facts"><dt>Work identity</dt><dd><Reference>{data.id}</Reference></dd><dt>Event identity</dt><dd><Reference>{data.eventId}</Reference></dd><dt>Consumer</dt><dd>{data.consumer}</dd><dt>State</dt><dd><Tone value={data.state}/></dd><dt>Failure code</dt><dd>{data.failureCode}</dd><dt>Attempts</dt><dd>{data.attempts}</dd><dt>Exchange / routing</dt><dd>{data.exchangeName} / {data.routingKey}</dd><dt>Replay requested by</dt><dd><Reference>{data.replayRequestedBy}</Reference></dd><dt>Replay requested</dt><dd><UTC value={data.replayRequestedAt}/></dd><dt>Republished</dt><dd><UTC value={data.republishedAt}/></dd><dt>Last updated</dt><dd><UTC value={data.updatedAt}/></dd></dl><p>Raw message envelopes are deliberately excluded from this interface.</p></Section>
    <Section title="Explicit replay request">{failure!==undefined && <ProblemPanel failure={failure}/>}<p>The existing protected backend reuses this durable event. Accepted replay does not mean republished, settled, or financially changed. Processing remains asynchronous.</p>
      {uncertain && <p role="alert">Replay outcome is unconfirmed. Check the current work state before considering another explicit request. This interface will not automatically repeat it.</p>}{accepted && <p role="status">Replay was accepted. Inspect the authoritative work state for progress.</p>}
      <div className="admin-actions"><button ref={trigger} className="button button-primary" disabled={busy || uncertain || data.state!=='FAILED'} onClick={()=>setConfirm(true)}>Review replay request</button><button className="button button-secondary" disabled={busy} onClick={refresh}>Check current work state</button></div>{data.state!=='FAILED' && <p>Replay is unavailable because the current record is not in FAILED state.</p>}
      <ConfirmDialog open={confirm} title="Replay this failed work?" description="Only this recorded event will be requested for replay. No new payment is created." confirmLabel="Request replay" busy={busy} initialFocus="cancel" returnFocus={trigger} onCancel={()=>setConfirm(false)} onConfirm={()=>void replay()}><p>Work <Reference>{data.id}</Reference></p><p>Event <Reference>{data.eventId}</Reference></p></ConfirmDialog></Section></>;
}
function WorkScreen({id,navigate}: {id:string;navigate:ProductNavigate}): JSX.Element {
  const read=useRead(api=>api.work(id),`work:${id}`);
  return <><Heading title="Failed-work detail" description="Review one durable failure and its recorded replay state." actions={<Link href="/admin/failed-work" navigate={navigate} className="button button-secondary">Back to failed work</Link>}/><ReadState {...read}>{read.data && <WorkContent data={read.data} refresh={read.refresh}/>}</ReadState></>;
}
export function P08FRoutes({path,location,navigate}: {path:string;location:string;navigate:ProductNavigate}): JSX.Element {
  const session=useSession(); const query=location.includes('?')?location.slice(location.indexOf('?')+1):'';let content:JSX.Element;
  if(session.user?.role!=='ADMIN') content=<><Heading title="Administrator access required" description="Your customer session does not grant permission to inspect other customers’ financial records."/><Link href="/" navigate={navigate}>Return to your dashboard</Link></>;
  else if(path==='/admin/transactions') content=<SearchScreen query={query} navigate={navigate}/>;
  else if(/^\/admin\/transactions\/[^/]+$/.test(path)) content=<DetailScreen key={path} id={path.split('/')[3]!} navigate={navigate}/>;
  else if(path==='/admin/audit') content=<AuditScreen query={query} navigate={navigate}/>;
  else if(path==='/admin/reconciliation') content=<ReconciliationScreen query={query} navigate={navigate}/>;
  else if(/^\/admin\/reconciliation\/[^/]+$/.test(path)) content=<ReportScreen key={path} id={path.split('/')[3]!} navigate={navigate}/>;
  else if(path==='/admin/failed-work') content=<FailedWorkScreen query={query} navigate={navigate}/>;
  else if(/^\/admin\/failed-work\/[^/]+$/.test(path)) content=<WorkScreen key={path} id={path.split('/')[3]!} navigate={navigate}/>;
  else content=<><Heading title="Administrator page not found" description="This path does not identify an investigation resource."/><Link href="/admin/transactions" navigate={navigate}>Open transaction search</Link></>;
  return <ProductShell navigate={navigate}><div className="admin-workspace">{content}</div></ProductShell>;
}
