import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { OutcomeUnknown, normalizePaymentIntent, normalizeTransferIntent, type Account, type Intent, type Page, type PaymentRecord, type TransferRecord } from './api.js';
import { formatInstant, formatMoney, shortReference } from './format.js';
import { type Currency } from './money.js';
import { amountToMinor, intentKindLabel, intentRecoveryPath, isTerminalPaymentState, paymentPollDelay, paymentStateLabel } from './p08b-core.js';
import { useSession } from './session.js';
import { ConfirmDialog, EmptyState, Link, LoadingState, OutcomeUnknownPanel, ProblemPanel, ProductShell, StatusBadge, unresolved, usePageTitle, useStoredIntent, type ProductNavigate } from './product-ui.js';
import { PaymentAdjustmentsPanel } from './p08c-ui.js';
export type { ProductNavigate, ProductNavigateOptions } from './product-ui.js';

function useAccounts(): { accounts: Account[]; loading: boolean; failure?: unknown; reload: () => Promise<void> } {
  const session = useSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>();
  const reload = useCallback(async () => {
    setLoading(true);
    setFailure(undefined);
    try {
      const page = await session.execute(api => api.accounts(100, 0));
      setAccounts(page.items);
    } catch (problem) {
      setFailure(problem);
    } finally {
      setLoading(false);
    }
  }, [session.execute]);
  useEffect(() => { void reload(); }, [reload]);
  return { accounts, loading, failure, reload };
}

function FieldError({ id, message }: { id: string; message?: string }): JSX.Element | null {
  return message ? <span className="field-error" id={id}>{message}</span> : null;
}

function ReviewGrid({ source, recipientRef, amountMinor }: { source: Account; recipientRef: string; amountMinor: string }): JSX.Element {
  return <dl className="review-grid"><div><dt>From</dt><dd>{source.name}</dd></div><div><dt>Recipient reference</dt><dd><code>{recipientRef}</code></dd></div><div><dt>Amount</dt><dd>{formatMoney(amountMinor, source.currency)}</dd></div><div><dt>Available before submission</dt><dd>{formatMoney(source.availableMinor, source.currency)}</dd></div></dl>;
}

function TransferCreatePage({ navigate }: { navigate: ProductNavigate }): JSX.Element {
  usePageTitle('New transfer');
  const session = useSession();
  const { accounts, loading, failure: accountFailure, reload } = useAccounts();
  const { store, current, refresh } = useStoredIntent();
  const [sourceId, setSourceId] = useState('');
  const [recipientRef, setRecipientRef] = useState('');
  const [amount, setAmount] = useState('');
  const [review, setReview] = useState<Intent>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!sourceId && accounts[0]) setSourceId(accounts[0].id);
  }, [accounts, sourceId]);
  const unresolvedTransfer = unresolved(current) && current.kind === 'transfers';
  const blockedByOther = unresolved(current) && current.kind !== 'transfers';
  const selected = accounts.find(account => account.id === sourceId);

  const prepareReview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(undefined);
    const errors: Record<string, string> = {};
    const source = accounts.find(account => account.id === sourceId);
    if (!source) errors.sourceId = 'Select a source wallet.';
    let intent: Intent | undefined;
    if (source) {
      try {
        const amountMinor = amountToMinor(amount, source.currency);
        if (BigInt(amountMinor) > BigInt(source.availableMinor)) errors.amount = 'The amount exceeds the displayed available balance.';
        intent = normalizeTransferIntent({ sourceId: source.id, recipientRef, amountMinor, currency: source.currency });
        if (intent.recipientRef === source.publicRef.toLowerCase()) errors.recipientRef = 'Choose a different recipient wallet.';
      } catch {
        if (!recipientRef.trim().match(/^LG-[0-9a-f]{32}$/i)) errors.recipientRef = 'Use a reference in the format LG- followed by 32 hexadecimal characters.';
        if (!amount.trim()) errors.amount = 'Enter a positive amount.';
        else if (!errors.recipientRef) errors.amount = 'Enter an amount with valid precision for this currency.';
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length || !intent) return;
    setReview(intent);
  };

  const retry = async () => {
    setBusy(true);
    setFailure(undefined);
    try {
      const response = await session.execute(api => store.retryTransfer(api));
      refresh();
      navigate(`/transfers/${response.body.id}`, { state: { replayed: response.replayed } });
    } catch (problem) {
      refresh();
      if (!(problem instanceof OutcomeUnknown)) setFailure(problem);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!review) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const response = await session.execute(api => store.executeTransfer(api, review));
      refresh();
      setReview(undefined);
      navigate(`/transfers/${response.body.id}`, { state: { replayed: response.replayed } });
    } catch (problem) {
      refresh();
      setReview(undefined);
      if (!(problem instanceof OutcomeUnknown)) setFailure(problem);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ProductShell navigate={navigate}>
      <div className="page page-detail">
        <header className="page-heading p08b-heading"><div><p className="eyebrow">Immediate money movement</p><h1>Make a transfer</h1><p>A transfer settles synchronously through the protected ledger. Review the exact economic instruction before submitting it.</p></div><Link href="/payments/new" navigate={navigate} className="button button-secondary">Create a payment instead</Link></header>
        {accountFailure !== undefined && <ProblemPanel failure={accountFailure} />}
        {failure !== undefined && <ProblemPanel failure={failure} />}
        {unresolvedTransfer && <OutcomeUnknownPanel kind="transfer" retrying={busy} onRetry={() => void retry()} />}
        {blockedByOther && current && <EmptyState title="Resolve the preserved instruction first" message={`A ${intentKindLabel(current.kind)} is still unresolved. Bad Penny will not silently replace its idempotency key.`} action={<Link href={intentRecoveryPath(current)} navigate={navigate} className="button button-primary">Resolve preserved instruction</Link>} />}
        {!unresolvedTransfer && !blockedByOther && (loading ? <LoadingState label="Loading source wallets" /> : accounts.length ? (
          <section className="command-card" aria-labelledby="transfer-form-title">
            <div className="command-intro"><p className="eyebrow">Transfer details</p><h2 id="transfer-form-title">Economic instruction</h2><p>Recipient references route synthetic money without exposing another customer’s account history or balance.</p></div>
            <form className="command-form" onSubmit={prepareReview} noValidate>
              <div className="field">
                <label htmlFor="transfer-source">Source wallet</label>
                <select id="transfer-source" value={sourceId} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSourceId(event.target.value)} aria-invalid={Boolean(fieldErrors.sourceId)} aria-describedby={fieldErrors.sourceId ? 'transfer-source-error' : undefined}>
                  {accounts.map(account => <option key={account.id} value={account.id}>{account.name} — {formatMoney(account.availableMinor, account.currency)} available</option>)}
                </select>
                <FieldError id="transfer-source-error" message={fieldErrors.sourceId} />
              </div>
              <div className="field">
                <label htmlFor="transfer-recipient">Recipient reference</label>
                <input id="transfer-recipient" value={recipientRef} onChange={(event: ChangeEvent<HTMLInputElement>) => setRecipientRef(event.target.value)} placeholder="LG-20000000000000000000000000000001" autoComplete="off" spellCheck={false} aria-invalid={Boolean(fieldErrors.recipientRef)} aria-describedby={fieldErrors.recipientRef ? 'transfer-recipient-hint transfer-recipient-error' : 'transfer-recipient-hint'} />
                <span id="transfer-recipient-hint" className="field-hint">A public Bad Penny wallet reference. No counterparty balance is revealed.</span>
                <FieldError id="transfer-recipient-error" message={fieldErrors.recipientRef} />
              </div>
              <div className="field">
                <label htmlFor="transfer-amount">Amount{selected ? ` (${selected.currency})` : ''}</label>
                <input id="transfer-amount" value={amount} onChange={(event: ChangeEvent<HTMLInputElement>) => setAmount(event.target.value)} inputMode="decimal" placeholder={selected?.currency === 'JPY' ? '1' : '0.01'} aria-invalid={Boolean(fieldErrors.amount)} aria-describedby={fieldErrors.amount ? 'transfer-amount-hint transfer-amount-error' : 'transfer-amount-hint'} />
                <span id="transfer-amount-hint" className="field-hint">Entered in major currency units; transmitted as an exact integer minor-unit string.</span>
                <FieldError id="transfer-amount-error" message={fieldErrors.amount} />
              </div>
              <div className="command-actions"><button className="button button-primary" type="submit">Review transfer</button><button className="button button-secondary" type="button" onClick={() => void reload()}>Refresh balances</button></div>
            </form>
          </section>
        ) : <EmptyState title="No source wallet" message="Open a wallet from the dashboard before creating a transfer." action={<Link href="/" navigate={navigate} className="button button-primary">Return to dashboard</Link>} />)}
        <ConfirmDialog open={Boolean(review && selected)} title="Confirm transfer" description="Confirming submits one replay-safe instruction. A lost response will not be treated as proof of failure." confirmLabel="Confirm and transfer" busy={busy} onCancel={() => setReview(undefined)} onConfirm={() => void confirm()}>
          {review && selected && <ReviewGrid source={selected} recipientRef={review.recipientRef} amountMinor={review.amountMinor} />}
        </ConfirmDialog>
      </div>
    </ProductShell>
  );
}

function TransferDetailPage({ transferId, navigate }: { transferId: string; navigate: ProductNavigate }): JSX.Element {
  usePageTitle('Transfer receipt');
  const session = useSession();
  const [record, setRecord] = useState<TransferRecord>();
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>();
  const replayed = Boolean((window.history.state as { replayed?: unknown } | null)?.replayed);
  useEffect(() => {
    let active = true;
    void session.execute(api => api.transferById(transferId)).then(result => { if (active) setRecord(result); }).catch(problem => { if (active) setFailure(problem); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session.execute, transferId]);
  return <ProductShell navigate={navigate}><div className="page page-detail">
    <Link href="/transfers/new" navigate={navigate} className="back-link">← New transfer</Link>
    {failure !== undefined && <ProblemPanel failure={failure} />}
    {loading ? <LoadingState label="Loading authoritative transfer receipt" /> : record ? <>
      <header className="receipt-hero"><div><p className="eyebrow">Authoritative receipt</p><h1>Transfer receipt</h1><p><time dateTime={record.createdAt}>{formatInstant(record.createdAt)}</time></p></div><div className="receipt-total"><span>Settled amount</span><strong>{formatMoney(record.amountMinor, record.currency)}</strong><span className="status-badge p08b-status success"><span aria-hidden="true">✓</span><span>Settled</span></span></div></header>
      {replayed && <section className="replay-note" role="status"><strong>Recovered by safe replay.</strong><span>The server returned the original transfer for the preserved idempotency key; no second transfer was created.</span></section>}
      <dl className="receipt-grid"><div><dt>Transfer ID</dt><dd><code>{record.id}</code></dd></div><div><dt>Journal ID</dt><dd><code>{record.journalId}</code></dd></div><div><dt>Source wallet</dt><dd><code>{record.sourceId}</code></dd></div><div><dt>Recipient reference</dt><dd><code>{record.recipientRef}</code></dd></div><div><dt>Currency</dt><dd>{record.currency}</dd></div><div><dt>State</dt><dd>{record.state}</dd></div></dl>
      <section className="privacy-note"><span aria-hidden="true">◎</span><div><h2>Scoped receipt</h2><p>This customer receipt contains the immutable transfer and journal references but not the recipient’s balance or private account history.</p></div></section>
      <div className="command-actions"><Link href={`/accounts/${record.sourceId}`} navigate={navigate} className="button button-secondary">View source activity</Link><Link href="/transfers/new" navigate={navigate} className="button button-primary">Make another transfer</Link></div>
    </> : null}
  </div></ProductShell>;
}

function PaymentCreatePage({ navigate }: { navigate: ProductNavigate }): JSX.Element {
  usePageTitle('New payment');
  const session = useSession();
  const { accounts, loading, failure: accountFailure, reload } = useAccounts();
  const { store, current, refresh } = useStoredIntent();
  const [sourceId, setSourceId] = useState('');
  const [recipientRef, setRecipientRef] = useState('');
  const [amount, setAmount] = useState('');
  const [review, setReview] = useState<Intent>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!sourceId && accounts[0]) setSourceId(accounts[0].id); }, [accounts, sourceId]);
  const unresolvedPayment = unresolved(current) && current.kind === 'payments';
  const blockedByOther = unresolved(current) && current.kind !== 'payments';
  const selected = accounts.find(account => account.id === sourceId);

  const prepareReview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(undefined);
    const errors: Record<string, string> = {};
    const source = accounts.find(account => account.id === sourceId);
    if (!source) errors.sourceId = 'Select a source wallet.';
    let intent: Intent | undefined;
    if (source) {
      try {
        const amountMinor = amountToMinor(amount, source.currency);
        if (BigInt(amountMinor) > BigInt(source.availableMinor)) errors.amount = 'The amount exceeds the displayed available balance.';
        intent = normalizePaymentIntent({ sourceId: source.id, recipientRef, amountMinor, currency: source.currency });
        if (intent.recipientRef === source.publicRef.toLowerCase()) errors.recipientRef = 'Choose a different recipient wallet.';
      } catch {
        if (!recipientRef.trim().match(/^LG-[0-9a-f]{32}$/i)) errors.recipientRef = 'Use a reference in the format LG- followed by 32 hexadecimal characters.';
        if (!amount.trim()) errors.amount = 'Enter a positive amount.';
        else if (!errors.recipientRef) errors.amount = 'Enter an amount with valid precision for this currency.';
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length || !intent) return;
    setReview(intent);
  };

  const retry = async () => {
    setBusy(true);
    setFailure(undefined);
    try {
      const response = await session.execute(api => store.retryPayment(api));
      refresh();
      navigate(`/payments/${response.body.id}`, { state: { replayed: response.replayed } });
    } catch (problem) {
      refresh();
      if (!(problem instanceof OutcomeUnknown)) setFailure(problem);
    } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!review) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const response = await session.execute(api => store.executePayment(api, review));
      refresh();
      setReview(undefined);
      navigate(`/payments/${response.body.id}`, { state: { replayed: response.replayed } });
    } catch (problem) {
      refresh();
      setReview(undefined);
      if (!(problem instanceof OutcomeUnknown)) setFailure(problem);
    } finally { setBusy(false); }
  };

  return <ProductShell navigate={navigate}><div className="page page-detail">
    <header className="page-heading p08b-heading"><div><p className="eyebrow">Asynchronous money movement</p><h1>Create a payment</h1><p>Acceptance creates a durable pending payment and active reservation. Settlement happens later through RabbitMQ workers.</p></div><Link href="/payments" navigate={navigate} className="button button-secondary">Payment history</Link></header>
    {accountFailure !== undefined && <ProblemPanel failure={accountFailure} />}
    {failure !== undefined && <ProblemPanel failure={failure} />}
    {unresolvedPayment && <OutcomeUnknownPanel kind="payment" retrying={busy} onRetry={() => void retry()} />}
    {blockedByOther && current && <EmptyState title="Resolve the preserved instruction first" message={`A ${intentKindLabel(current.kind)} is still unresolved. Bad Penny will not silently replace it.`} action={<Link href={intentRecoveryPath(current)} navigate={navigate} className="button button-primary">Resolve preserved instruction</Link>} />}
    {!unresolvedPayment && !blockedByOther && (loading ? <LoadingState label="Loading source wallets" /> : accounts.length ? <section className="command-card" aria-labelledby="payment-form-title">
      <div className="command-intro"><p className="eyebrow">Payment details</p><h2 id="payment-form-title">Durable payment instruction</h2><p>The interface never displays an accepted payment as settled until the authoritative payment resource reaches that state.</p></div>
      <form className="command-form" onSubmit={prepareReview} noValidate>
        <div className="field"><label htmlFor="payment-source">Source wallet</label><select id="payment-source" value={sourceId} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSourceId(event.target.value)} aria-invalid={Boolean(fieldErrors.sourceId)} aria-describedby={fieldErrors.sourceId ? 'payment-source-error' : undefined}>{accounts.map(account => <option key={account.id} value={account.id}>{account.name} — {formatMoney(account.availableMinor, account.currency)} available</option>)}</select><FieldError id="payment-source-error" message={fieldErrors.sourceId} /></div>
        <div className="field"><label htmlFor="payment-recipient">Recipient reference</label><input id="payment-recipient" value={recipientRef} onChange={(event: ChangeEvent<HTMLInputElement>) => setRecipientRef(event.target.value)} placeholder="LG-30000000000000000000000000000001" autoComplete="off" spellCheck={false} aria-invalid={Boolean(fieldErrors.recipientRef)} aria-describedby={fieldErrors.recipientRef ? 'payment-recipient-hint payment-recipient-error' : 'payment-recipient-hint'} /><span id="payment-recipient-hint" className="field-hint">Only the public routing reference is required.</span><FieldError id="payment-recipient-error" message={fieldErrors.recipientRef} /></div>
        <div className="field"><label htmlFor="payment-amount">Amount{selected ? ` (${selected.currency})` : ''}</label><input id="payment-amount" value={amount} onChange={(event: ChangeEvent<HTMLInputElement>) => setAmount(event.target.value)} inputMode="decimal" placeholder={selected?.currency === 'JPY' ? '1' : '0.01'} aria-invalid={Boolean(fieldErrors.amount)} aria-describedby={fieldErrors.amount ? 'payment-amount-hint payment-amount-error' : 'payment-amount-hint'} /><span id="payment-amount-hint" className="field-hint">The source balance is rechecked atomically when the payment is accepted.</span><FieldError id="payment-amount-error" message={fieldErrors.amount} /></div>
        <div className="command-actions"><button className="button button-primary" type="submit">Review payment</button><button className="button button-secondary" type="button" onClick={() => void reload()}>Refresh balances</button></div>
      </form>
    </section> : <EmptyState title="No source wallet" message="Open a wallet from the dashboard before creating a payment." action={<Link href="/" navigate={navigate} className="button button-primary">Return to dashboard</Link>} />)}
    <ConfirmDialog open={Boolean(review && selected)} title="Confirm payment" description="Confirming accepts one durable payment request. Pending is not the same as settled." confirmLabel="Confirm payment" busy={busy} onCancel={() => setReview(undefined)} onConfirm={() => void confirm()}>{review && selected && <ReviewGrid source={selected} recipientRef={review.recipientRef} amountMinor={review.amountMinor} />}</ConfirmDialog>
  </div></ProductShell>;
}

function PaymentsPage({ navigate }: { navigate: ProductNavigate }): JSX.Element {
  usePageTitle('Payments');
  const session = useSession();
  const limit = 25;
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page<PaymentRecord>>();
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>();
  const [status, setStatus] = useState<'ALL' | PaymentRecord['state']>('ALL');
  const load = useCallback(async () => {
    setLoading(true); setFailure(undefined);
    try { setPage(await session.execute(api => api.payments(limit, offset))); }
    catch (problem) { setFailure(problem); }
    finally { setLoading(false); }
  }, [offset, session.execute]);
  useEffect(() => { void load(); }, [load]);
  const visible = page?.items.filter(payment => status === 'ALL' || payment.state === status) ?? [];
  return <ProductShell navigate={navigate}><div className="page">
    <header className="page-heading p08b-heading"><div><p className="eyebrow">Authoritative asynchronous history</p><h1>Payments</h1><p>Pending, settled, failed and cancelled states are read from the payment resource. The interface does not infer success from submission.</p></div><Link href="/payments/new" navigate={navigate} className="button button-primary">New payment</Link></header>
    {failure !== undefined && <ProblemPanel failure={failure} />}
    <section className="list-toolbar" aria-label="Payment controls"><div className="field compact"><label htmlFor="payment-status-filter">Status</label><select id="payment-status-filter" value={status} onChange={(event: ChangeEvent<HTMLSelectElement>) => setStatus(event.target.value as typeof status)}><option value="ALL">All statuses</option><option value="PENDING">Pending</option><option value="SETTLED">Settled</option><option value="FAILED">Failed</option><option value="CANCELLED">Cancelled</option></select></div><button className="button button-secondary" type="button" onClick={() => void load()} disabled={loading}>Refresh payments</button></section>
    {loading ? <LoadingState label="Loading payment history" /> : visible.length ? <div className="payment-list" role="list">{visible.map(payment => <article className="payment-card" role="listitem" key={payment.id}>
      <div className="payment-card-main"><div><p className="eyebrow">{payment.direction === 'OUTGOING' ? 'Sent payment' : 'Received payment'}</p><h2>{formatMoney(payment.amountMinor, payment.currency)}</h2><p>Counterparty <code>{shortReference(payment.counterpartyRef)}</code></p></div><StatusBadge state={payment.state} /></div>
      <dl className="payment-meta"><div><dt>Created</dt><dd><time dateTime={payment.createdAt}>{formatInstant(payment.createdAt)}</time></dd></div><div><dt>Version</dt><dd>{payment.version}</dd></div><div><dt>Adjustment</dt><dd>{payment.adjustmentState.replaceAll('_', ' ')}</dd></div></dl>
      <Link href={`/payments/${payment.id}`} navigate={navigate} className="button button-secondary">View payment details</Link>
    </article>)}</div> : !failure ? <EmptyState title={page?.items.length ? 'No payments match this filter' : 'No payments yet'} message={page?.items.length ? 'Choose another status to inspect the current page.' : 'Create a real API-backed payment to begin the history.'} action={<Link href="/payments/new" navigate={navigate} className="button button-primary">Create payment</Link>} /> : null}
    {page && <nav className="pagination" aria-label="Payment history pages"><button className="button button-secondary" type="button" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</button><span>Showing {page.items.length ? offset + 1 : 0}–{offset + page.items.length}</span><button className="button button-secondary" type="button" disabled={!page.hasMore || loading} onClick={() => setOffset(offset + limit)}>Next</button></nav>}
  </div></ProductShell>;
}

function PaymentDetailPage({ paymentId, navigate }: { paymentId: string; navigate: ProductNavigate }): JSX.Element {
  usePageTitle('Payment details');
  const session = useSession();
  const { store, current, refresh: refreshIntent } = useStoredIntent();
  const [record, setRecord] = useState<PaymentRecord>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [announcement, setAnnouncement] = useState('');
  const [pollExhausted, setPollExhausted] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const replayed = Boolean((window.history.state as { replayed?: unknown } | null)?.replayed);
  const unresolvedCancellation = unresolved(current) && current.kind === 'payment-cancellations'
    && 'paymentId' in current.intent && current.intent.paymentId === paymentId;

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setFailure(undefined);
    try {
      const next = await session.execute(api => api.paymentById(paymentId));
      setRecord(previous => {
        if (!previous || previous.state !== next.state || previous.version !== next.version) setAnnouncement(`Payment state is ${paymentStateLabel(next.state)}. Version ${next.version}.`);
        return next;
      });
      return next;
    } catch (problem) {
      setFailure(problem);
      return undefined;
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [paymentId, session.execute]);

  useEffect(() => { void load(false); }, [load]);
  useEffect(() => {
    if (!record || isTerminalPaymentState(record.state)) return;
    let active = true;
    let timer = 0;
    let attempt = 0;
    const poll = () => {
      timer = window.setTimeout(() => {
        void load(true).then(next => {
          if (!active || !next || isTerminalPaymentState(next.state)) return;
          attempt += 1;
          if (attempt >= 40) { setPollExhausted(true); return; }
          poll();
        });
      }, paymentPollDelay(attempt));
    };
    poll();
    return () => { active = false; window.clearTimeout(timer); };
  }, [load, record?.state]);

  const retryCancellation = async () => {
    setCancelling(true); setFailure(undefined);
    try {
      await session.execute(api => store.retryCancellation(api));
      refreshIntent();
      await load(true);
    } catch (problem) {
      refreshIntent();
      if (!(problem instanceof OutcomeUnknown)) { await load(true); setFailure(problem); }
    } finally { setCancelling(false); }
  };

  const cancelPayment = async () => {
    setCancelling(true); setFailure(undefined);
    try {
      await session.execute(api => store.executeCancellation(api, { paymentId, reason: cancelReason.trim() || undefined }));
      refreshIntent();
      setCancelOpen(false);
      await load(true);
    } catch (problem) {
      refreshIntent();
      setCancelOpen(false);
      if (!(problem instanceof OutcomeUnknown)) { await load(true); setFailure(problem); }
    } finally { setCancelling(false); }
  };

  return <ProductShell navigate={navigate}><div className="page page-detail">
    <Link href="/payments" navigate={navigate} className="back-link">← Payment history</Link>
    {failure !== undefined && <ProblemPanel failure={failure} />}
    {unresolvedCancellation && <OutcomeUnknownPanel kind="cancellation" retrying={cancelling} onRetry={() => void retryCancellation()} />}
    {loading ? <LoadingState label="Loading authoritative payment state" /> : record ? <>
      <header className="receipt-hero"><div><p className="eyebrow">Live payment resource</p><h1>Payment details</h1><p>Created <time dateTime={record.createdAt}>{formatInstant(record.createdAt)}</time></p></div><div className="receipt-total"><span>{record.direction === 'OUTGOING' ? 'Sent amount' : 'Received amount'}</span><strong>{formatMoney(record.amountMinor, record.currency)}</strong><StatusBadge state={record.state} /></div></header>
      <div className="live-region" aria-live="polite">{announcement}</div>
      {replayed && <section className="replay-note" role="status"><strong>Accepted through safe replay.</strong><span>The original durable payment was returned for the preserved idempotency key.</span></section>}
      {record.state === 'PENDING' && <section className="pending-note" role="status"><span className="spinner" aria-hidden="true" /><div><strong>Settlement is still pending.</strong><p>Bad Penny is polling the authoritative payment resource. Pending funds remain reserved; this screen does not claim settlement.</p></div></section>}
      {pollExhausted && record.state === 'PENDING' && <section className="replay-note"><strong>Automatic polling paused.</strong><span>The payment remains pending. Use Refresh state to continue checking without creating another payment.</span></section>}
      <dl className="receipt-grid"><div><dt>Payment ID</dt><dd><code>{record.id}</code></dd></div><div><dt>Direction</dt><dd>{record.direction}</dd></div><div><dt>Wallet ID</dt><dd><code>{record.accountId}</code></dd></div><div><dt>Counterparty reference</dt><dd><code>{record.counterpartyRef}</code></dd></div><div><dt>Version</dt><dd>{record.version}</dd></div><div><dt>Last updated</dt><dd><time dateTime={record.updatedAt}>{formatInstant(record.updatedAt)}</time></dd></div><div><dt>Adjustment state</dt><dd>{record.adjustmentState.replaceAll('_', ' ')}</dd></div><div><dt>Projection</dt><dd>{record.projectionState ?? 'Not available'}{record.projectionVersion ? ` · v${record.projectionVersion}` : ''}</dd></div>{record.journalId && <div><dt>Settlement journal</dt><dd><code>{record.journalId}</code></dd></div>}{record.failureCode && <div><dt>Failure code</dt><dd><code>{record.failureCode}</code></dd></div>}</dl>
      <div className="command-actions"><button className="button button-secondary" type="button" onClick={() => void load(true)} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh state'}</button>{record.direction === 'OUTGOING' && record.state === 'PENDING' && !unresolvedCancellation && <button className="button button-danger" type="button" onClick={() => setCancelOpen(true)}>Cancel pending payment</button>}<Link href="/payments/new" navigate={navigate} className="button button-primary">New payment</Link></div>
      <PaymentAdjustmentsPanel paymentId={paymentId} navigate={navigate} onChanged={() => load(true)} />
      <ConfirmDialog open={cancelOpen} title="Cancel pending payment" description="Cancellation succeeds only if it wins the race with settlement. The refreshed payment resource is authoritative." confirmLabel="Confirm cancellation" busy={cancelling} onCancel={() => setCancelOpen(false)} onConfirm={() => void cancelPayment()}>
        <div className="field"><label htmlFor="cancel-reason">Reason (optional)</label><input id="cancel-reason" value={cancelReason} maxLength={500} onChange={(event: ChangeEvent<HTMLInputElement>) => setCancelReason(event.target.value)} placeholder="Customer requested cancellation" /></div>
      </ConfirmDialog>
    </> : null}
  </div></ProductShell>;
}

function AdminUnavailable({ navigate }: { navigate: ProductNavigate }): JSX.Element {
  usePageTitle('Customer interface unavailable');
  return <ProductShell navigate={navigate}><div className="page page-narrow"><EmptyState title="Customer money movement is not an administrator tool" message="P08B exposes owner-scoped transfer and payment journeys. The dedicated administrator transaction and ledger interface remains a later P08 slice." action={<Link href="/" navigate={navigate} className="button button-primary">Return to dashboard</Link>} /></div></ProductShell>;
}

function NotFound({ navigate }: { navigate: ProductNavigate }): JSX.Element {
  usePageTitle('Page not found');
  return <ProductShell navigate={navigate}><div className="page page-narrow"><EmptyState title="Page not found" message="This route is not part of the P08B customer money-movement slice." action={<Link href="/" navigate={navigate} className="button button-primary">Return to dashboard</Link>} /></div></ProductShell>;
}

export function P08BRoutes({ path, navigate }: { path: string; location: string; navigate: ProductNavigate }): JSX.Element {
  const session = useSession();
  if (session.user?.role !== 'CUSTOMER') return <AdminUnavailable navigate={navigate} />;
  const transfer = path.match(/^\/transfers\/([0-9a-f-]{36})$/i);
  const payment = path.match(/^\/payments\/([0-9a-f-]{36})$/i);
  if (path === '/transfers/new') return <TransferCreatePage navigate={navigate} />;
  if (transfer?.[1]) return <TransferDetailPage transferId={transfer[1]} navigate={navigate} />;
  if (path === '/payments') return <PaymentsPage navigate={navigate} />;
  if (path === '/payments/new') return <PaymentCreatePage navigate={navigate} />;
  if (payment?.[1]) return <PaymentDetailPage key={payment[1]} paymentId={payment[1]} navigate={navigate} />;
  return <NotFound navigate={navigate} />;
}
