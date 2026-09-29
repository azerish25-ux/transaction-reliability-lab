import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type PropsWithChildren, type ReactNode, type RefObject } from 'react';
import { ApiError, OutcomeUnknown, type PaymentRecord, type Problem } from './api.js';
import { IntentStore, type StoredIntent } from './intent-store.js';
import { intentKindLabel, intentRecoveryPath, paymentStateLabel, paymentStateTone } from './p08b-core.js';
import { useSession } from './session.js';
import './styles.css';
import './p08b.css';

export interface ProductNavigateOptions {
  replace?: boolean;
  state?: Record<string, unknown> | null;
}
export type ProductNavigate = (path: string, options?: ProductNavigateOptions) => void;

type CommandKind = 'transfer' | 'payment' | 'cancellation' | 'refund' | 'reversal';
const INTENT_CHANGED = 'ledgerguard:intent-changed';

const CODE_MESSAGES: Record<string, string> = {
  AUTHENTICATION_REQUIRED: 'Your session ended. Sign in again before continuing.',
  CSRF_INVALID: 'The security token expired. Refresh the page and try again.',
  DEPENDENCY_UNAVAILABLE: 'A required service is temporarily unavailable. The financial outcome has not been inferred.',
  OUTCOME_UNKNOWN: 'The connection ended before the outcome could be confirmed. Retry the preserved request safely.',
  INSUFFICIENT_FUNDS: 'The selected wallet does not have enough available money.',
  TRANSFER_REJECTED: 'The transfer was rejected without changing money.',
  PAYMENT_REJECTED: 'The payment was rejected without changing money.',
  TRANSFER_CONFLICT: 'The transfer conflicts with the current authoritative state.',
  PAYMENT_CONFLICT: 'The payment conflicts with the current authoritative state.',
  IDEMPOTENCY_CONFLICT: 'This retry key belongs to a different economic instruction. The original instruction was preserved.',
  INVALID_RECIPIENT: 'Enter a valid LedgerGuard recipient reference.',
  INVALID_AMOUNT: 'Enter a valid positive amount for the selected currency.',
  INVALID_SOURCE_ACCOUNT: 'Select a valid source wallet.',
  FORBIDDEN: 'This customer is not permitted to perform that action.',
  NOT_FOUND: 'The requested record does not exist or is not visible to this customer.'
};

interface UiProblem {
  title: string;
  message: string;
  code?: string;
  correlationId?: string;
  validation?: Record<string, string>;
}

function toUiProblem(failure: unknown): UiProblem {
  if (failure instanceof OutcomeUnknown) {
    return { title: 'Outcome not yet confirmed', message: failure.message };
  }
  if (failure instanceof ApiError) {
    const problem: Problem = failure.problem;
    return {
      title: failure.status >= 500 ? 'Service temporarily unavailable' : 'Request could not be completed',
      message: CODE_MESSAGES[problem.code] ?? problem.message,
      code: problem.code,
      correlationId: problem.correlationId || undefined,
      validation: problem.validation
    };
  }
  if (failure instanceof TypeError) {
    return { title: 'Check the submitted details', message: failure.message || 'One or more values are invalid.' };
  }
  if (failure instanceof Error) {
    return { title: 'Request could not be completed', message: failure.message };
  }
  return { title: 'Unexpected problem', message: 'Refresh the authoritative record before inferring a financial outcome.' };
}

export function ProblemPanel({ failure }: { failure: unknown }): JSX.Element {
  const headingId = useId();
  const problem = toUiProblem(failure);
  return (
    <section className="problem-panel" role="alert" aria-labelledby={headingId}>
      <div className="problem-icon" aria-hidden="true">!</div>
      <div>
        <h2 id={headingId}>{problem.title}</h2>
        <p>{problem.message}</p>
        {problem.code && <p className="problem-meta">Code: <code>{problem.code}</code></p>}
        {problem.correlationId && <p className="problem-meta">Support reference: <code>{problem.correlationId}</code></p>}
      </div>
    </section>
  );
}

export function LoadingState({ label = 'Loading authoritative records' }: { label?: string }): JSX.Element {
  return <div className="loading-state" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" /><span>{label}…</span></div>;
}

export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }): JSX.Element {
  return <section className="empty-state"><div className="empty-mark" aria-hidden="true">LG</div><h2>{title}</h2><p>{message}</p>{action}</section>;
}

export function Link({ href, navigate, className, children, ariaLabel }: PropsWithChildren<{ href: string; navigate: ProductNavigate; className?: string; ariaLabel?: string }>): JSX.Element {
  return <a href={href} className={className} aria-label={ariaLabel} onClick={(event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  }}>{children}</a>;
}

export function usePageTitle(title: string): void {
  useEffect(() => { document.title = `${title} · LedgerGuard`; }, [title]);
}

function readIntent(store: IntentStore): { current?: StoredIntent; failure?: unknown } {
  try { return { current: store.current() }; }
  catch (failure) { return { failure }; }
}

export function useStoredIntent(): {
  store: IntentStore; current?: StoredIntent; failure?: unknown; refresh: () => void;
} {
  const session = useSession();
  const ownerId = session.user?.id ?? '00000000-0000-0000-0000-000000000000';
  const store = useMemo(() => new IntentStore({
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: key => window.localStorage.removeItem(key)
  }, ownerId), [ownerId]);
  const [snapshot, setSnapshot] = useState(() => readIntent(store));
  const refresh = useCallback(() => {
    setSnapshot(readIntent(store));
    window.dispatchEvent(new Event(INTENT_CHANGED));
  }, [store]);
  useEffect(() => {
    const update = () => setSnapshot(readIntent(store));
    window.addEventListener(INTENT_CHANGED, update);
    window.addEventListener('storage', update);
    update();
    return () => {
      window.removeEventListener(INTENT_CHANGED, update);
      window.removeEventListener('storage', update);
    };
  }, [store]);
  return { store, ...snapshot, refresh };
}

export function unresolved(record?: StoredIntent): record is StoredIntent {
  return Boolean(record && (record.state === 'PREPARED' || record.state === 'UNCERTAIN'));
}

function SyntheticNotice(): JSX.Element {
  return <div className="synthetic-notice" role="note"><span className="notice-dot" aria-hidden="true" /><strong>Synthetic money laboratory.</strong><span>No real bank accounts, payments or deposits are connected.</span></div>;
}

function Brand({ navigate }: { navigate: ProductNavigate }): JSX.Element {
  return <Link href="/" navigate={navigate} className="brand" ariaLabel="LedgerGuard dashboard"><span className="brand-mark" aria-hidden="true">LG</span><span><strong>LedgerGuard</strong><small>Reliability laboratory</small></span></Link>;
}

export function UnresolvedBanner({ record, navigate }: { record: StoredIntent; navigate: ProductNavigate }): JSX.Element {
  const label = intentKindLabel(record.kind);
  const uncertain = record.state === 'UNCERTAIN';
  return (
    <section className="intent-banner" role="status" aria-live="polite">
      <div><p className="eyebrow">Preserved economic instruction</p><h2>{uncertain ? 'Outcome not yet confirmed' : 'Request ready to resume'}</h2><p>The original {label} and idempotency key are retained for this customer. Do not create a replacement instruction.</p></div>
      <Link href={intentRecoveryPath(record)} navigate={navigate} className="button button-secondary">Resolve safely</Link>
    </section>
  );
}

export function ProductShell({ navigate, children }: PropsWithChildren<{ navigate: ProductNavigate }>): JSX.Element {
  const session = useSession();
  const { current, failure: intentFailure } = useStoredIntent();
  const [loggingOut, setLoggingOut] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const logout = async () => {
    setLoggingOut(true);
    setFailure(undefined);
    try {
      await session.logout();
      navigate('/login', { replace: true });
    } catch (problem) {
      setFailure(problem);
      setLoggingOut(false);
    }
  };
  const customer = session.user?.role === 'CUSTOMER';
  const showGlobalIntent = unresolved(current) && window.location.pathname !== intentRecoveryPath(current);
  return (
    <div className="app-shell p08b-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <SyntheticNotice />
      <header className="site-header">
        <Brand navigate={navigate} />
        <nav aria-label="Primary navigation">
          <Link href="/" navigate={navigate} className="nav-link">Dashboard</Link>
          {customer && <Link href="/transfers/new" navigate={navigate} className="nav-link">Transfer</Link>}
          {customer && <Link href="/payments" navigate={navigate} className="nav-link">Payments</Link>}
          {customer && <Link href="/schedules" navigate={navigate} className="nav-link">Schedules</Link>}
          {!customer && <Link href="/admin/adjustments" navigate={navigate} className="nav-link">Adjustments</Link>}
          <button className="button button-quiet" type="button" onClick={() => void logout()} disabled={loggingOut}>{loggingOut ? 'Signing out…' : 'Sign out'}</button>
        </nav>
      </header>
      {session.user?.role === 'ADMIN' && <nav className="admin-navigation" aria-label="Administrator investigation">
        {([['transactions','Transactions'],['audit','Audit history'],['reconciliation','Reconciliation'],['failed-work','Failed work']] as const).map(([route,label]) =>
          <Link key={route} href={`/admin/${route}`} navigate={navigate} className="nav-link">{label}</Link>)}
      </nav>}
      {failure !== undefined && <div className="shell-problem"><ProblemPanel failure={failure} /></div>}
      {intentFailure !== undefined && <div className="shell-problem"><ProblemPanel failure={new Error("Saved instruction cannot be read. Financial actions are blocked; do not clear browser storage while an outcome is unresolved.")} /></div>}
      {showGlobalIntent && current && <div className="intent-banner-wrap"><UnresolvedBanner record={current} navigate={navigate} /></div>}
      <main id="main-content" tabIndex={-1}>{children}</main>
      <footer className="site-footer"><span>{customer ? 'Customer financial workflows' : 'Administrator investigation'}</span><span>Receipts and states come from PostgreSQL through the protected API.</span></footer>
    </div>
  );
}

export function StatusBadge({ state }: { state: PaymentRecord['state'] }): JSX.Element {
  return <span className={`status-badge p08b-status ${paymentStateTone(state)}`}><span aria-hidden="true">{state === 'SETTLED' ? '✓' : state === 'FAILED' ? '!' : state === 'CANCELLED' ? '—' : '●'}</span><span>{paymentStateLabel(state)}</span></span>;
}

export function ConfirmDialog({ open, title, description, confirmLabel, busy, onCancel, onConfirm, children, initialFocus = 'confirm', returnFocus }: PropsWithChildren<{
  open: boolean; title: string; description: string; confirmLabel: string; busy: boolean;
  onCancel: () => void; onConfirm: () => void; initialFocus?: 'cancel' | 'confirm';
  returnFocus?: RefObject<HTMLElement>;
}>): JSX.Element {
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    (initialFocus === 'cancel' ? cancel : confirm).current?.focus();
    return () => {
      element.close();
      // Async review can disable and blur its trigger before the dialog opens.
      // Prefer the explicit trigger, retaining automatic restoration for other callers.
      const target = returnFocus?.current ?? previous;
      if (target?.isConnected) target.focus();
    };
  }, [open, initialFocus, returnFocus]);
  return <dialog ref={dialog} className="dialog p08b-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <p className="eyebrow">Explicit confirmation</p><h2 id={titleId}>{title}</h2>
    <p id={descriptionId}>{description}</p>{children}
    <div className="dialog-actions">
      <button ref={cancel} className="button button-secondary" type="button" onClick={onCancel} disabled={busy}>Go back</button>
      <button ref={confirm} className="button button-primary" type="button" onClick={onConfirm} disabled={busy}>{busy ? 'Submitting…' : confirmLabel}</button>
    </div>
  </dialog>;
}

export function OutcomeUnknownPanel({ kind, retrying, onRetry }: { kind: CommandKind; retrying: boolean; onRetry: () => void }): JSX.Element {
  return (
    <section className="uncertain-panel" role="alert" aria-labelledby={`uncertain-${kind}`}>
      <div className="uncertain-mark" aria-hidden="true">?</div>
      <div>
        <p className="eyebrow">Commit uncertainty</p>
        <h2 id={`uncertain-${kind}`}>Outcome not yet confirmed</h2>
        <p>LedgerGuard preserved the exact normalized {kind} and its idempotency key. Retrying this same request cannot create a second economic instruction.</p>
        <button className="button button-primary" type="button" onClick={onRetry} disabled={retrying}>{retrying ? 'Resolving…' : `Retry same ${kind}`}</button>
      </div>
    </section>
  );
}
