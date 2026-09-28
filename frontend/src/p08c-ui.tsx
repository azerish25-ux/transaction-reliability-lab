import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { OutcomeUnknown, type Page, type PaymentAdjustment, type PaymentAdjustmentContext } from './api.js';
import { formatInstant, formatMoney } from './format.js';
import { intentRecoveryPath } from './p08b-core.js';
import { adjustmentDisabledReason, adjustmentLabel, adjustmentReason, adjustmentReceiptPath, adjustmentRoute, PAYMENT_ID, refundMinor, remainingInput, validateAdjustmentContext } from './p08c-core.js';
import { ConfirmDialog, EmptyState, Link, LoadingState, ProblemPanel, ProductShell, unresolved, usePageTitle, useStoredIntent, type ProductNavigate } from './product-ui.js';
import { useSession } from './session.js';
import './p08c.css';

interface Review { amountMinor: string; reason?: string; context: PaymentAdjustmentContext; }

function AdjustmentSummary({ context }: { context: PaymentAdjustmentContext }): JSX.Element {
  return <>
    <p className="adjustment-status" role="status">{adjustmentLabel(context.adjustmentState)}</p>
    <dl className="adjustment-totals">
      <div><dt>Original settled amount</dt><dd>{context.state === 'SETTLED' ? formatMoney(context.amountMinor, context.currency) : 'Not settled'}</dd></div>
      <div><dt>Successfully refunded</dt><dd>{formatMoney(context.refundedMinor, context.currency)}</dd></div>
      <div><dt>Remaining refundable</dt><dd>{formatMoney(context.remainingRefundableMinor, context.currency)}</dd></div>
    </dl>
    {context.recipientAvailableMinor !== null && <p className="field-hint">Recipient wallet available: <strong>{formatMoney(context.recipientAvailableMinor, context.currency)}</strong> · balance version {context.recipientBalanceVersion}. Availability is rechecked under lock when submitted.</p>}
  </>;
}

/** The real payment detail embeds this panel; the administrator uses the same history/replay boundary. */
export function PaymentAdjustmentsPanel({ paymentId, administrator = false, navigate, onChanged }: {
  paymentId: string; administrator?: boolean; navigate: ProductNavigate; onChanged?: () => Promise<unknown>;
}): JSX.Element {
  const session = useSession();
  const { store, current, failure: storageFailure, refresh } = useStoredIntent();
  const [context, setContext] = useState<PaymentAdjustmentContext>();
  const [history, setHistory] = useState<Page<PaymentAdjustment>>();
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState<Review>();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const formId = useId();
  const amountRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const kind = administrator ? 'payment-reversals' : 'payment-refunds';
  const label = administrator ? 'reversal' : 'refund';
  const isUnresolved = unresolved(current);
  const ownUnresolved = isUnresolved && current.kind === kind && 'paymentId' in current.intent && current.intent.paymentId === paymentId;
  const blocked = isUnresolved && !ownUnresolved;

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setFailure(undefined);
    try {
      const [next, adjustments] = await session.execute(api => Promise.all([
        api.paymentAdjustmentContext(paymentId, administrator), api.paymentAdjustments(paymentId, 10, offset)
      ]));
      const valid = validateAdjustmentContext(next);
      if (request === generation.current) { setContext(valid); setHistory(adjustments); }
    } catch (problem) { if (request === generation.current) setFailure(problem); }
    finally { if (request === generation.current) setLoading(false); }
  }, [paymentId, administrator, offset, session.execute]);
  useEffect(() => { void load(); return () => { generation.current += 1; }; }, [load]);

  const prepare = (event: FormEvent) => {
    event.preventDefault();
    if (!context || loading || failure !== undefined || storageFailure !== undefined || isUnresolved || busy) return;
    const nextErrors: Record<string, string> = {};
    let normalizedAmount = context.amountMinor;
    let normalizedReason: string | undefined;
    if (!administrator) {
      try { normalizedAmount = refundMinor(amount, context); }
      catch (problem) { nextErrors.amount = problem instanceof Error ? problem.message : 'Check the refund amount.'; }
    }
    try { normalizedReason = adjustmentReason(reason, administrator); }
    catch (problem) { nextErrors.reason = problem instanceof Error ? problem.message : 'Check the reason.'; }
    if (administrator && !context.canReverse) nextErrors.reason = adjustmentDisabledReason(context.reversalDisabledReason);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { (nextErrors.amount ? amountRef : reasonRef).current?.focus(); return; }
    setReview({ amountMinor: normalizedAmount, reason: normalizedReason, context });
  };

  const send = async (retry = false) => {
    if (inFlight.current || (!retry && !review)) return;
    inFlight.current = true; setBusy(true); setFailure(undefined);
    try {
      const response = await session.execute(api => administrator
        ? retry ? store.retryReversal(api) : store.executeReversal(api, { paymentId, reason: review!.reason! })
        : retry ? store.retryRefund(api) : store.executeRefund(api, { paymentId, amountMinor: review!.amountMinor, reason: review!.reason }));
      refresh(); setReview(undefined);
      navigate(adjustmentReceiptPath(paymentId, response.body.id, administrator), { state: { adjustmentReplayed: response.replayed } });
    } catch (problem) {
      refresh(); setReview(undefined);
      // A fresh read is useful after a controlled race rejection, but cannot decide an uncertain POST.
      if (!(problem instanceof OutcomeUnknown)) {
        await load();
        if (onChanged) await onChanged();
        setFailure(problem);
      }
    } finally { inFlight.current = false; setBusy(false); }
  };

  const enabled = context && (administrator ? context.canReverse : context.canRefund);
  const canUseRemaining = context && context.recipientAvailableMinor !== null
    && BigInt(context.remainingRefundableMinor) > 0n && BigInt(context.remainingRefundableMinor) <= BigInt(context.recipientAvailableMinor);
  return <section className="adjustment-section" aria-labelledby={`${formId}-title`}>
    <div className="adjustment-heading"><div><p className="eyebrow">Compensating postings</p><h2 id={`${formId}-title`}>{administrator ? 'Administrative full reversal' : 'Refunds and adjustments'}</h2><p>The original settlement is preserved. Every successful adjustment creates a separate balanced journal.</p></div>
      <button className="button button-secondary" onClick={() => void load()} disabled={loading || busy}>Refresh adjustments</button></div>
    {failure !== undefined && <ProblemPanel failure={failure} />}
    {storageFailure !== undefined && <ProblemPanel failure={new Error('Saved instruction cannot be read. Refund and reversal submission is blocked; preserve this browser’s storage until any uncertain outcome is resolved.')} />}
    {ownUnresolved && current && <section className="uncertain-panel" role="alert" aria-labelledby={`${formId}-recovery`}>
      <div><p className="eyebrow">Preserved instruction</p><h3 id={`${formId}-recovery`}>{current.state === 'UNCERTAIN' ? 'Outcome not yet confirmed' : 'Request ready to resume'}</h3>
        <p>The original {label}, payment reference, amount/reason and retry key are preserved. A failed status lookup does not prove that money failed to move.</p>
        {'amountMinor' in current.intent && <p>Preserved refund: <code>{current.intent.amountMinor}</code> minor units.</p>}
        <p>Reason: {('reason' in current.intent && current.intent.reason) || 'Recipient refund'}</p>
        <button className="button button-primary" onClick={() => void send(true)} disabled={busy || storageFailure !== undefined}>{busy ? 'Resolving…' : `Retry same ${label}`}</button>
      </div>
    </section>}
    {blocked && current && <p role="status">A different instruction is unresolved. <Link href={intentRecoveryPath(current)} navigate={navigate}>Resolve the preserved instruction first</Link>.</p>}
    {loading ? <LoadingState label="Loading adjustment totals and history" /> : context && <>
      <AdjustmentSummary context={context} />
      {!ownUnresolved && !blocked && !enabled && <p className="adjustment-restriction">{adjustmentDisabledReason(administrator ? context.reversalDisabledReason : context.refundDisabledReason)}</p>}
      {enabled && !ownUnresolved && !blocked && <form className="adjustment-form" onSubmit={prepare} noValidate>
        {Object.keys(errors).length > 0 && <div className="field-error" role="alert">Review the highlighted {label} details before continuing.</div>}
        {!administrator && <div className="field"><label htmlFor={`${formId}-amount`}>Refund amount ({context.currency})</label>
          <input ref={amountRef} id={`${formId}-amount`} value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" autoComplete="off" aria-invalid={Boolean(errors.amount)} aria-describedby={`${formId}-amount-help${errors.amount ? ` ${formId}-amount-error` : ''}`} />
          <span className="field-hint" id={`${formId}-amount-help`}>Enter a partial amount or use the remaining refundable amount. No rounding is performed.</span>
          {errors.amount && <span className="field-error" id={`${formId}-amount-error`}>{errors.amount}</span>}
          <button type="button" className="button button-secondary" disabled={!canUseRemaining || busy} onClick={() => { setAmount(remainingInput(context)); setErrors({}); amountRef.current?.focus(); }}>Refund remaining amount</button>
          {!canUseRemaining && <span className="field-hint">A full refund is unavailable because recipient availability is below the remaining refundable amount.</span>}
        </div>}
        <div className="field"><label htmlFor={`${formId}-reason`}>{administrator ? 'Reversal reason (required)' : 'Refund reason (optional)'}</label>
          <textarea ref={reasonRef} id={`${formId}-reason`} value={reason} onChange={event => setReason(event.target.value)} rows={3} maxLength={500} required={administrator} aria-invalid={Boolean(errors.reason)} aria-describedby={`${formId}-reason-help${errors.reason ? ` ${formId}-reason-error` : ''}`} />
          <span className="field-hint" id={`${formId}-reason-help`}>At most 500 characters. The reason becomes part of the immutable adjustment history. Do not enter secrets.</span>
          {errors.reason && <span className="field-error" id={`${formId}-reason-error`}>{errors.reason}</span>}
        </div>
        <button className={`button ${administrator ? 'button-danger' : 'button-primary'}`} type="submit" disabled={busy || failure !== undefined || storageFailure !== undefined}>{administrator ? 'Review full reversal' : 'Review refund'}</button>
      </form>}
      <section className="adjustment-history" aria-labelledby={`${formId}-history`}>
        <h3 id={`${formId}-history`}>Adjustment history</h3>
        {history?.items.length ? <ol className="adjustment-list">{history.items.map(item => <li key={item.id}>
          <div className="adjustment-list-heading"><strong>{item.kind === 'REFUND' ? 'Refund' : 'Full reversal'}</strong><strong>{formatMoney(item.amountMinor, item.currency)}</strong></div>
          <p className="adjustment-reason">{item.reason}</p><p><time dateTime={item.createdAt}>{formatInstant(item.createdAt)}</time></p>
          <p>Journal: <code>{item.journalId}</code></p>
          <Link href={adjustmentReceiptPath(paymentId, item.id, administrator)} navigate={navigate} className="button button-secondary" ariaLabel={`View ${item.kind.toLowerCase()} receipt ${item.id}`}>View adjustment receipt</Link>
        </li>)}</ol> : <p>No adjustments on this page. The original settlement has not been changed.</p>}
        {history && (offset > 0 || history.hasMore) && <nav className="pagination" aria-label="Adjustment history pages">
          <button className="button button-secondary" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 10))}>Previous adjustments</button>
          <span>Page {Math.floor(offset / 10) + 1}</span>
          <button className="button button-secondary" disabled={!history.hasMore || loading} onClick={() => setOffset(offset + 10)}>Next adjustments</button>
        </nav>}
      </section>
    </>}
    <ConfirmDialog open={Boolean(review)} title={administrator ? 'Confirm full reversal' : 'Confirm refund'} confirmLabel={administrator ? 'Confirm full reversal' : 'Confirm refund'}
      description="Review the exact instruction. The server rechecks ownership, settlement state, prior adjustments and available funds atomically. A timeout will preserve this same instruction for safe replay."
      busy={busy} initialFocus="cancel" onCancel={() => setReview(undefined)} onConfirm={() => void send()}>
      {review && <dl className="review-grid"><div><dt>Original payer</dt><dd><code>{review.context.payerRef}</code></dd></div>
        <div><dt>Original recipient wallet</dt><dd><code>{review.context.recipientRef}</code></dd></div>
        <div><dt>Payment ID</dt><dd><code>{paymentId}</code></dd></div><div><dt>{administrator ? 'Full reversal amount' : 'Refund amount'}</dt><dd>{formatMoney(review.amountMinor, review.context.currency)}</dd></div>
        <div><dt>Remaining refundable before submission</dt><dd>{formatMoney(review.context.remainingRefundableMinor, review.context.currency)}</dd></div>
        <div><dt>Expected adjustment state if accepted</dt><dd>{administrator ? 'Reversed' : review.amountMinor === review.context.remainingRefundableMinor ? 'Fully refunded' : 'Partially refunded'}</dd></div>
        <div><dt>Reason</dt><dd className="adjustment-reason">{review.reason || 'Recipient refund'}</dd></div></dl>}
    </ConfirmDialog>
  </section>;
}

function AdminLookup({ navigate }: { navigate: ProductNavigate }): JSX.Element {
  usePageTitle('Payment adjustments');
  const [paymentId, setPaymentId] = useState('');
  const [error, setError] = useState('');
  return <ProductShell navigate={navigate}><div className="page page-narrow">
    <header className="page-heading"><p className="eyebrow">Administrator · synthetic money only</p><h1>Payment adjustments</h1><p>Inspect a payment before making an authorized full reversal. There is no generic balance editor.</p></header>
    <form className="command-card adjustment-lookup" noValidate onSubmit={event => { event.preventDefault(); const id = paymentId.trim().toLowerCase(); if (!PAYMENT_ID.test(id)) { setError('Enter a valid payment ID.'); return; } navigate(`/admin/payments/${id}/reversal`); }}>
      <div className="field"><label htmlFor="admin-payment-id">Payment ID</label><input id="admin-payment-id" value={paymentId} onChange={event => setPaymentId(event.target.value)} autoComplete="off" spellCheck={false} aria-invalid={Boolean(error)} aria-describedby={error ? 'admin-payment-error' : undefined} />
        {error && <span className="field-error" id="admin-payment-error" role="alert">{error}</span>}</div>
      <button className="button button-primary">Inspect payment</button>
    </form>
    <p className="field-hint">This is the scoped adjustment interface. Transaction-wide search, audit browsing and the broader administrator console remain later work.</p>
  </div></ProductShell>;
}

function AdminReversal({ paymentId, navigate }: { paymentId: string; navigate: ProductNavigate }): JSX.Element {
  usePageTitle('Review payment reversal');
  return <ProductShell navigate={navigate}><div className="page page-detail">
    <Link href="/admin/adjustments" navigate={navigate} className="back-link">← Find another payment</Link>
    <header className="page-heading"><p className="eyebrow">Restricted administrative operation</p><h1>Review payment reversal</h1><p>Payment <code>{paymentId}</code></p><p>Only a settled payment with no previous refund or reversal is eligible. The original recipient must have sufficient available funds.</p></header>
    <PaymentAdjustmentsPanel key={paymentId} paymentId={paymentId} administrator navigate={navigate} />
  </div></ProductShell>;
}

function AdjustmentReceipt({ paymentId, adjustmentId, administrator, navigate }: { paymentId: string; adjustmentId: string; administrator: boolean; navigate: ProductNavigate }): JSX.Element {
  usePageTitle('Adjustment receipt');
  const session = useSession();
  const [receipt, setReceipt] = useState<PaymentAdjustment>();
  const [context, setContext] = useState<PaymentAdjustmentContext>();
  const [failure, setFailure] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const replayed = Boolean((window.history.state as { adjustmentReplayed?: unknown } | null)?.adjustmentReplayed);
  const load = useCallback(async () => {
    setLoading(true); setFailure(undefined);
    try {
      const [adjustment, current] = await session.execute(api => Promise.all([api.paymentAdjustment(paymentId, adjustmentId), api.paymentAdjustmentContext(paymentId, administrator)]));
      if (adjustment.paymentId !== paymentId || adjustment.id !== adjustmentId || !PAYMENT_ID.test(adjustment.journalId)) throw new TypeError('Invalid adjustment receipt.');
      setReceipt(adjustment); setContext(validateAdjustmentContext(current));
    } catch (problem) { setFailure(problem); }
    finally { setLoading(false); }
  }, [paymentId, adjustmentId, administrator, session.execute]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!loading && receipt) heading.current?.focus(); }, [loading, receipt]);
  const parent = administrator ? `/admin/payments/${paymentId}/reversal` : `/payments/${paymentId}`;
  return <ProductShell navigate={navigate}><div className="page page-detail">
    <Link href={parent} navigate={navigate} className="back-link">← Back to payment details</Link>
    {failure !== undefined && <><ProblemPanel failure={failure} /><button className="button button-secondary" onClick={() => void load()}>Retry receipt lookup</button></>}
    {loading ? <LoadingState label="Loading immutable adjustment receipt" /> : receipt && context && <>
      <header className="receipt-hero"><div><p className="eyebrow">Immutable compensating journal</p><h1 ref={heading} tabIndex={-1}>Adjustment receipt</h1><p>{receipt.kind === 'REFUND' ? 'Refund' : 'Full reversal'} recorded <time dateTime={receipt.createdAt}>{formatInstant(receipt.createdAt)}</time></p></div><div className="receipt-total"><span>{receipt.kind === 'REFUND' ? 'Refunded amount' : 'Reversed amount'}</span><strong>{formatMoney(receipt.amountMinor, receipt.currency)}</strong></div></header>
      {replayed && <p className="replay-note" role="status"><strong>Recovered by safe replay.</strong> The original adjustment and journal were returned; no second adjustment was created.</p>}
      <AdjustmentSummary context={context} />
      <dl className="receipt-grid"><div><dt>Adjustment ID</dt><dd><code>{receipt.id}</code></dd></div><div><dt>Payment ID</dt><dd><code>{receipt.paymentId}</code></dd></div>
        <div><dt>Adjustment journal</dt><dd><code>{receipt.journalId}</code></dd></div><div><dt>Original settlement journal</dt><dd><code>{context.journalId}</code></dd></div>
        <div><dt>Base payment state</dt><dd>{context.state}</dd></div><div><dt>Adjustment kind</dt><dd>{receipt.kind}</dd></div>
        <div><dt>Recorded reason</dt><dd className="adjustment-reason">{receipt.reason}</dd></div><div><dt>Payment version</dt><dd>{context.version}</dd></div></dl>
      <p className="field-hint">The receipt is immutable. The adjustment totals above reflect the current authoritative payment, which may include later authorized refunds.</p>
    </>}
  </div></ProductShell>;
}

export function P08CRoutes({ path, navigate }: { path: string; navigate: ProductNavigate }): JSX.Element {
  const session = useSession();
  const route = adjustmentRoute(path);
  const requiresAdmin = route?.kind === 'lookup' || route?.kind === 'reversal' || (route?.kind === 'receipt' && route.administrator);
  if (requiresAdmin && session.user?.role !== 'ADMIN') return <ProductShell navigate={navigate}><div className="page page-narrow"><EmptyState title="Administrator access required" message="This customer session cannot inspect or reverse payments through administrator routes. The protected API enforces the same restriction." action={<Link href="/payments" navigate={navigate} className="button button-secondary">Return to payments</Link>} /></div></ProductShell>;
  if (route?.kind === 'lookup') return <AdminLookup navigate={navigate} />;
  if (route?.kind === 'reversal') return <AdminReversal key={route.paymentId} paymentId={route.paymentId} navigate={navigate} />;
  if (route?.kind === 'receipt') return <AdjustmentReceipt key={`${route.paymentId}/${route.adjustmentId}`} {...route} navigate={navigate} />;
  return <ProductShell navigate={navigate}><div className="page"><EmptyState title="Adjustment page not found" message="Use a valid payment and adjustment reference." /></div></ProductShell>;
}
