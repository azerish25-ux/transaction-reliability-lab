import { UnresolvedBanner, unresolved, useStoredIntent } from './product-ui.js';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type PropsWithChildren,
  type ReactNode,
  type RefObject
} from 'react';
import {
  ApiError,
  type Account,
  type Page,
  type Problem,
  type Transaction,
  type TransactionDetail
} from './api.js';
import { formatInstant, formatMoney, humanKind, shortReference } from './format.js';
import { type Currency } from './money.js';
import { useSession } from './session.js';
import './styles.css';

type Navigate = (path: string, replace?: boolean) => void;

function normalizePath(path: string): string {
  if (!path.startsWith('/')) return '/';
  const stripped = path.replace(/\/{2,}/g, '/').replace(/\/$/, '');
  return stripped || '/';
}

function useRouter(): { path: string; navigate: Navigate } {
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));
  useEffect(() => {
    const update = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  const navigate = useCallback<Navigate>((next, replace = false) => {
    const normalized = normalizePath(next);
    if (replace) window.history.replaceState(null, '', normalized);
    else window.history.pushState(null, '', normalized);
    setPath(normalized);
    // Notify the outer product router when a preserved instruction leaves the dashboard.
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);
  return { path, navigate };
}

function Link({ to, navigate, className, children, ariaLabel }: PropsWithChildren<{ to: string; navigate: Navigate; className?: string; ariaLabel?: string }>): JSX.Element {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={onClick} className={className} aria-label={ariaLabel}>{children}</a>;
}

function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · LedgerGuard`;
  }, [title]);
}

interface UiProblem {
  title: string;
  message: string;
  code?: string;
  correlationId?: string;
  validation?: Record<string, string>;
}

const CODE_MESSAGES: Record<string, string> = {
  AUTHENTICATION_REQUIRED: 'Your session is no longer active. Sign in again to continue.',
  INVALID_CREDENTIALS: 'The email address or password was not accepted.',
  RATE_LIMITED: 'Too many attempts were made. Wait before trying again.',
  CSRF_INVALID: 'The security token expired. Refresh the page and try again.',
  DEPENDENCY_UNAVAILABLE: 'A required service is temporarily unavailable. No financial result should be inferred from this screen.',
  NOT_FOUND: 'The requested resource does not exist or is not available to this account.',
  FORBIDDEN: 'Your account is not permitted to perform this action.',
  INVALID_EMAIL: 'Enter a valid email address.',
  INVALID_PASSWORD: 'Use at least 12 characters and no control characters.',
  EMAIL_ALREADY_REGISTERED: 'An account with that email address already exists.',
  INVALID_LABEL: 'Enter an account name between 1 and 80 characters.'
};

function toUiProblem(failure: unknown): UiProblem {
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
    return { title: 'Connection problem', message: 'LedgerGuard could not reach the application service. Check that the laboratory is running, then retry.' };
  }
  return { title: 'Unexpected problem', message: 'The request could not be completed. No financial result should be inferred until the authoritative record is refreshed.' };
}

function ProblemPanel({ failure, headingRef }: { failure: unknown; headingRef?: RefObject<HTMLHeadingElement> }): JSX.Element {
  const problem = toUiProblem(failure);
  return (
    <section className="problem-panel" role="alert" aria-labelledby="problem-heading">
      <div className="problem-icon" aria-hidden="true">!</div>
      <div>
        <h2 id="problem-heading" ref={headingRef} tabIndex={headingRef ? -1 : undefined}>{problem.title}</h2>
        <p>{problem.message}</p>
        {problem.code && <p className="problem-meta">Code: <code>{problem.code}</code></p>}
        {problem.correlationId && <p className="problem-meta">Support reference: <code>{problem.correlationId}</code></p>}
      </div>
    </section>
  );
}

function LoadingState({ label = 'Loading authoritative records' }: { label?: string }): JSX.Element {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }): JSX.Element {
  return (
    <section className="empty-state">
      <div className="empty-mark" aria-hidden="true">LG</div>
      <h2>{title}</h2>
      <p>{message}</p>
      {action}
    </section>
  );
}

function SyntheticNotice(): JSX.Element {
  return (
    <div className="synthetic-notice" role="note">
      <span className="notice-dot" aria-hidden="true" />
      <strong>Synthetic money laboratory.</strong>
      <span>No real bank accounts, payments or deposits are connected.</span>
    </div>
  );
}

function Brand({ navigate }: { navigate: Navigate }): JSX.Element {
  return (
    <Link to="/" navigate={navigate} className="brand" ariaLabel="LedgerGuard dashboard">
      <span className="brand-mark" aria-hidden="true">LG</span>
      <span><strong>LedgerGuard</strong><small>Reliability laboratory</small></span>
    </Link>
  );
}

function ProductFrame({ navigate, children }: PropsWithChildren<{ navigate: Navigate }>): JSX.Element {
  const session = useSession();
  const { current: preservedIntent } = useStoredIntent();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<unknown>();
  const logout = async () => {
    setLoggingOut(true);
    setLogoutError(undefined);
    try {
      await session.logout();
      navigate('/login', true);
    } catch (failure) {
      setLogoutError(failure);
      setLoggingOut(false);
    }
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <SyntheticNotice />
      <header className="site-header">
        <Brand navigate={navigate} />
        <nav aria-label="Primary navigation">
          <Link to="/" navigate={navigate} className="nav-link">Dashboard</Link>
          <button className="button button-quiet" type="button" onClick={() => void logout()} disabled={loggingOut}>
            {loggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </nav>
      </header>
      {logoutError !== undefined && <div className="shell-problem"><ProblemPanel failure={logoutError} /></div>}
      {unresolved(preservedIntent) && <div className="intent-banner-wrap"><UnresolvedBanner record={preservedIntent} navigate={(path, options) => navigate(path, options?.replace)} /></div>}
      <main id="main-content" tabIndex={-1}>{children}</main>
      <footer className="site-footer">
        <span>P08A product interface</span>
        <span>Authoritative records come from PostgreSQL through the protected API.</span>
      </footer>
    </div>
  );
}

function AnonymousFrame({ navigate, children }: PropsWithChildren<{ navigate: Navigate }>): JSX.Element {
  return (
    <div className="auth-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <SyntheticNotice />
      <header className="auth-header"><Brand navigate={navigate} /></header>
      <main id="main-content" tabIndex={-1} className="auth-main">
        <section className="auth-story" aria-labelledby="auth-story-title">
          <p className="eyebrow">Financial correctness, made inspectable</p>
          <h1 id="auth-story-title">Every balance should have an explanation.</h1>
          <p>LedgerGuard exposes the records behind each synthetic transaction: posted money, active reservations, immutable operation references and independently reconciled journals.</p>
          <dl className="trust-list">
            <div><dt>Exact</dt><dd>Integer minor units, never floating point.</dd></div>
            <div><dt>Durable</dt><dd>Replay-safe commands and crash recovery.</dd></div>
            <div><dt>Scoped</dt><dd>Customer data stays customer-owned.</dd></div>
          </dl>
        </section>
        <section className="auth-card">{children}</section>
      </main>
    </div>
  );
}

function SessionExpiredDialog({ navigate }: { navigate: Navigate }): JSX.Element | null {
  const session = useSession();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (session.expired) button.current?.focus();
  }, [session.expired]);
  if (!session.expired) return null;
  const continueToLogin = () => {
    session.dismissExpired();
    navigate('/login', true);
  };
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="expired-title" aria-describedby="expired-description" onKeyDown={event => { if (event.key === 'Tab') { event.preventDefault(); button.current?.focus(); } }}>
        <p className="eyebrow">Session protection</p>
        <h2 id="expired-title">Your session ended</h2>
        <p id="expired-description">LedgerGuard stopped using the expired session. Sign in again before viewing protected financial records.</p>
        <button ref={button} className="button button-primary" type="button" onClick={continueToLogin}>Continue to sign in</button>
      </section>
    </div>
  );
}

function BootstrapScreen({ failure, retry }: { failure?: unknown; retry?: () => Promise<void> }): JSX.Element {
  usePageTitle(failure ? 'Service unavailable' : 'Starting');
  return (
    <div className="bootstrap-screen">
      <span className="brand-mark large" aria-hidden="true">LG</span>
      {failure ? (
        <>
          <ProblemPanel failure={failure} />
          <button className="button button-primary" type="button" onClick={() => void retry?.()}>Retry connection</button>
        </>
      ) : <LoadingState label="Establishing a secure session" />}
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }): JSX.Element | null {
  return message ? <span className="field-error" id={id}>{message}</span> : null;
}

function LoginPage({ navigate }: { navigate: Navigate }): JSX.Element {
  usePageTitle('Sign in');
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const errorHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (failure) errorHeading.current?.focus(); }, [failure]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(undefined);
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '').trim();
    const password = String(data.get('password') ?? '');
    if (!email || !password) {
      setFailure(new ApiError(400, { code: 'VALIDATION_FAILED', message: 'Enter both email address and password.', correlationId: '' }));
      return;
    }
    setBusy(true);
    try {
      await session.login(email, password);
      navigate('/', true);
    } catch (problem) {
      setFailure(problem);
      setBusy(false);
    }
  };
  return (
    <AnonymousFrame navigate={navigate}>
      <p className="eyebrow">Protected customer access</p>
      <h1>Sign in</h1>
      <p className="auth-intro">Use a synthetic LedgerGuard identity. Credentials are sent only to the same-origin laboratory API.</p>
      {failure !== undefined && <ProblemPanel failure={failure} headingRef={errorHeading} />}
      <form onSubmit={event => void submit(event)} noValidate>
        <div className="field">
          <label htmlFor="email">Email address</label>
          <input id="email" name="email" type="email" autoComplete="username" required inputMode="email" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <button className="button button-primary button-full" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in securely'}</button>
      </form>
      <p className="auth-switch">New to the laboratory? <Link to="/register" navigate={navigate}>Create a synthetic customer</Link></p>
    </AnonymousFrame>
  );
}

function RegisterPage({ navigate }: { navigate: Navigate }): JSX.Element {
  usePageTitle('Create customer');
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const errorHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (failure) errorHeading.current?.focus(); }, [failure]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(undefined);
    const data = new FormData(event.currentTarget);
    const displayName = String(data.get('displayName') ?? '').trim();
    const email = String(data.get('email') ?? '').trim();
    const password = String(data.get('password') ?? '');
    const confirmation = String(data.get('confirmation') ?? '');
    const errors: Record<string, string> = {};
    if (!displayName || displayName.length > 80) errors.displayName = 'Enter a name between 1 and 80 characters.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.';
    if (password.length < 12) errors.password = 'Use at least 12 characters.';
    if (password !== confirmation) errors.confirmation = 'The passwords do not match.';
    setFields(errors);
    if (Object.keys(errors).length) {
      setFailure(new ApiError(400, { code: 'VALIDATION_FAILED', message: 'Correct the highlighted fields and submit again.', correlationId: '', validation: errors }));
      return;
    }
    setBusy(true);
    try {
      await session.register({ displayName, email, password });
      navigate('/', true);
    } catch (problem) {
      const ui = toUiProblem(problem);
      setFields(ui.validation ?? {});
      setFailure(problem);
      setBusy(false);
    }
  };
  return (
    <AnonymousFrame navigate={navigate}>
      <p className="eyebrow">Synthetic customer registration</p>
      <h1>Create your account</h1>
      <p className="auth-intro">New customers begin at zero. Any fixture balance is created later through a balanced funding journal, never a direct balance edit.</p>
      {failure !== undefined && <ProblemPanel failure={failure} headingRef={errorHeading} />}
      <form onSubmit={event => void submit(event)} noValidate>
        <div className="field">
          <label htmlFor="displayName">Display name</label>
          <input id="displayName" name="displayName" autoComplete="name" maxLength={80} required aria-invalid={Boolean(fields.displayName)} aria-describedby={fields.displayName ? 'displayName-error' : undefined} />
          <FieldError id="displayName-error" message={fields.displayName} />
        </div>
        <div className="field">
          <label htmlFor="register-email">Email address</label>
          <input id="register-email" name="email" type="email" autoComplete="username" required inputMode="email" aria-invalid={Boolean(fields.email)} aria-describedby={fields.email ? 'register-email-error' : undefined} />
          <FieldError id="register-email-error" message={fields.email} />
        </div>
        <div className="field">
          <label htmlFor="register-password">Password</label>
          <input id="register-password" name="password" type="password" autoComplete="new-password" required minLength={12} aria-invalid={Boolean(fields.password)} aria-describedby={fields.password ? 'password-hint register-password-error' : 'password-hint'} />
          <span className="field-hint" id="password-hint">12–72 UTF-8 bytes; control characters are rejected.</span>
          <FieldError id="register-password-error" message={fields.password} />
        </div>
        <div className="field">
          <label htmlFor="confirmation">Confirm password</label>
          <input id="confirmation" name="confirmation" type="password" autoComplete="new-password" required aria-invalid={Boolean(fields.confirmation)} aria-describedby={fields.confirmation ? 'confirmation-error' : undefined} />
          <FieldError id="confirmation-error" message={fields.confirmation} />
        </div>
        <button className="button button-primary button-full" type="submit" disabled={busy}>{busy ? 'Creating customer…' : 'Create customer'}</button>
      </form>
      <p className="auth-switch">Already registered? <Link to="/login" navigate={navigate}>Sign in</Link></p>
    </AnonymousFrame>
  );
}

function Balance({ label, amount, currency, emphasized = false }: { label: string; amount: string; currency: Currency; emphasized?: boolean }): JSX.Element {
  return (
    <div className={emphasized ? 'balance emphasized' : 'balance'}>
      <dt>{label}</dt>
      <dd>{formatMoney(amount, currency)}</dd>
    </div>
  );
}

function AccountCard({ account, navigate }: { account: Account; navigate: Navigate }): JSX.Element {
  const titleId = useId();
  return (
    <article className="account-card" aria-labelledby={titleId}>
      <header>
        <div>
          <p className="account-currency">{account.currency} wallet</p>
          <h2 id={titleId}>{account.name}</h2>
        </div>
        <span className="status-badge"><span aria-hidden="true">●</span> Open</span>
      </header>
      <dl className="balance-grid">
        <Balance label="Available" amount={account.availableMinor} currency={account.currency} emphasized />
        <Balance label="Posted" amount={account.postedMinor} currency={account.currency} />
        <Balance label="Reserved" amount={account.reservedMinor} currency={account.currency} />
      </dl>
      <div className="account-meta">
        <div><span>Recipient reference</span><code title={account.publicRef}>{shortReference(account.publicRef)}</code></div>
        <div><span>Balance version</span><strong>{account.version}</strong></div>
        <div><span>Last changed</span><time dateTime={account.updatedAt}>{formatInstant(account.updatedAt)}</time></div>
      </div>
      <Link to={`/accounts/${account.id}`} navigate={navigate} className="button button-secondary">View account activity</Link>
    </article>
  );
}

function CreateAccountForm({ onCreated }: { onCreated: (account: Account) => void }): JSX.Element {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(undefined);
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    const currency = String(data.get('currency') ?? 'CAD') as Currency;
    if (!name || name.length > 80) {
      setFailure(new ApiError(400, { code: 'INVALID_LABEL', message: CODE_MESSAGES.INVALID_LABEL ?? 'Enter a valid account name.', correlationId: '' }));
      return;
    }
    setBusy(true);
    try {
      const account = await session.execute(api => api.createAccount(name, currency));
      form.reset();
      onCreated(account);
      setBusy(false);
    } catch (problem) {
      setFailure(problem);
      setBusy(false);
    }
  };
  return (
    <section className="create-account" aria-labelledby="create-account-title">
      <div>
        <p className="eyebrow">Zero-balance account</p>
        <h2 id="create-account-title">Open a synthetic wallet</h2>
        <p>Creating a wallet does not create money. It begins with posted, reserved and available balances of zero.</p>
      </div>
      {failure !== undefined && <ProblemPanel failure={failure} />}
      <form className="inline-form" onSubmit={event => void submit(event)}>
        <div className="field">
          <label htmlFor="account-name">Account name</label>
          <input id="account-name" name="name" maxLength={80} required placeholder="Everyday CAD" />
        </div>
        <div className="field compact">
          <label htmlFor="account-currency">Currency</label>
          <select id="account-currency" name="currency" defaultValue="CAD">
            <option value="CAD">CAD</option>
            <option value="USD">USD</option>
            <option value="JPY">JPY</option>
            <option value="KWD">KWD</option>
          </select>
        </div>
        <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Opening…' : 'Open wallet'}</button>
      </form>
    </section>
  );
}

function DashboardPage({ navigate }: { navigate: Navigate }): JSX.Element {
  usePageTitle('Dashboard');
  const session = useSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>();
  const [updated, setUpdated] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const load = useCallback(async () => {
    if (session.user?.role !== 'CUSTOMER') return;
    setLoading(true);
    setFailure(undefined);
    try {
      const page = await session.execute(api => api.accounts(100, 0));
      setAccounts(page.items);
      setUpdated(new Date().toISOString());
      setAnnouncement(`Balances refreshed. ${page.items.length} account${page.items.length === 1 ? '' : 's'} loaded.`);
    } catch (problem) {
      setFailure(problem);
    } finally {
      setLoading(false);
    }
  }, [session]);
  useEffect(() => { void load(); }, [load]);

  if (session.user?.role === 'ADMIN') {
    return (
      <ProductFrame navigate={navigate}>
        <div className="page page-narrow">
          <EmptyState title="Administrator interface is a later P08 slice" message="This P08A increment delivers the complete customer authentication and account-history journey without pretending that unfinished administrator tools exist." />
        </div>
      </ProductFrame>
    );
  }

  const addAccount = (account: Account) => {
    setAccounts(current => [account, ...current]);
    setAnnouncement(`${account.name} opened with a zero balance.`);
  };

  return (
    <ProductFrame navigate={navigate}>
      <div className="page">
        <header className="page-heading dashboard-heading">
          <div>
            <p className="eyebrow">Customer dashboard</p>
            <h1>Welcome, {session.user?.displayName}</h1>
            <p>Available money is posted money minus active reservations. Every value below comes from the authoritative ledger store.</p>
          </div>
          <button className="button button-secondary" type="button" onClick={() => void load()} disabled={loading}>Refresh balances</button>
        </header>
        <div className="live-region" aria-live="polite">{announcement}</div>
        {updated && <p className="freshness">Last refreshed <time dateTime={updated}>{formatInstant(updated)}</time></p>}
        {failure !== undefined && <ProblemPanel failure={failure} />}
        {loading ? <LoadingState /> : accounts.length ? (
          <section aria-labelledby="accounts-title">
            <div className="section-heading"><div><p className="eyebrow">Authoritative balances</p><h2 id="accounts-title">Your accounts</h2></div><span>{accounts.length} total</span></div>
            <div className="account-grid">{accounts.map(account => <AccountCard key={account.id} account={account} navigate={navigate} />)}</div>
          </section>
        ) : !failure ? (
          <EmptyState title="No wallets yet" message="Your customer identity is active, but no account has been opened. New wallets always begin at zero." />
        ) : null}
        <CreateAccountForm onCreated={addAccount} />
      </div>
    </ProductFrame>
  );
}

function AccountHistoryPage({ accountId, navigate }: { accountId: string; navigate: Navigate }): JSX.Element {
  usePageTitle('Account activity');
  const session = useSession();
  const limit = 15;
  const [offset, setOffset] = useState(0);
  const [account, setAccount] = useState<Account>();
  const [transactions, setTransactions] = useState<Page<Transaction>>();
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>();
  const load = useCallback(async () => {
    setLoading(true);
    setFailure(undefined);
    try {
      const [record, page] = await Promise.all([
        session.execute(api => api.accountById(accountId)),
        session.execute(api => api.accountTransactions(accountId, limit, offset))
      ]);
      setAccount(record);
      setTransactions(page);
    } catch (problem) {
      setFailure(problem);
    } finally {
      setLoading(false);
    }
  }, [accountId, offset, session]);
  useEffect(() => { void load(); }, [load]);

  return (
    <ProductFrame navigate={navigate}>
      <div className="page">
        <Link to="/" navigate={navigate} className="back-link">← Back to dashboard</Link>
        {failure !== undefined && <ProblemPanel failure={failure} />}
        {loading ? <LoadingState label="Loading account and immutable activity" /> : account && transactions ? (
          <>
            <header className="page-heading account-heading">
              <div>
                <p className="eyebrow">{account.currency} wallet</p>
                <h1>{account.name}</h1>
                <p>Recipient reference <code>{account.publicRef}</code></p>
              </div>
              <dl className="hero-balance"><dt>Available balance</dt><dd>{formatMoney(account.availableMinor, account.currency)}</dd><span>Version {account.version} · {formatInstant(account.updatedAt)}</span></dl>
            </header>
            <section className="balance-strip" aria-label="Balance breakdown">
              <Balance label="Posted" amount={account.postedMinor} currency={account.currency} />
              <Balance label="Reserved" amount={account.reservedMinor} currency={account.currency} />
              <Balance label="Available" amount={account.availableMinor} currency={account.currency} emphasized />
            </section>
            <section aria-labelledby="activity-title">
              <div className="section-heading"><div><p className="eyebrow">Immutable journal activity</p><h2 id="activity-title">Transaction history</h2></div><span>Newest first</span></div>
              {transactions.items.length ? (
                <div className="table-wrap">
                  <table>
                    <caption className="sr-only">Transactions for {account.name}</caption>
                    <thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Economic effect</th><th scope="col">Operation reference</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                      {transactions.items.map(transaction => (
                        <tr key={transaction.journalId}>
                          <td data-label="Date"><time dateTime={transaction.createdAt}>{formatInstant(transaction.createdAt)}</time></td>
                          <td data-label="Type"><span className="status-badge neutral">{humanKind(transaction.kind)}</span></td>
                          <td data-label="Economic effect" className={transaction.effectMinor.startsWith('-') ? 'money negative' : 'money positive'}>{formatMoney(transaction.effectMinor, transaction.currency, true)}</td>
                          <td data-label="Operation reference"><code title={transaction.operationId}>{shortReference(transaction.operationId)}</code></td>
                          <td className="table-action"><Link to={`/accounts/${account.id}/transactions/${transaction.journalId}`} navigate={navigate} ariaLabel={`View ${humanKind(transaction.kind)} transaction details`}>View details</Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState title="No journal activity" message="This wallet exists, but no balanced journal has affected it yet." />}
              <nav className="pagination" aria-label="Transaction history pages">
                <button className="button button-secondary" type="button" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</button>
                <span>Showing {transactions.items.length ? offset + 1 : 0}–{offset + transactions.items.length}</span>
                <button className="button button-secondary" type="button" disabled={!transactions.hasMore || loading} onClick={() => setOffset(offset + limit)}>Next</button>
              </nav>
            </section>
          </>
        ) : null}
      </div>
    </ProductFrame>
  );
}

function CopyReference({ value }: { value: string }): JSX.Element {
  const [status, setStatus] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus('Reference copied.');
    } catch {
      setStatus('Copy was not available. Select the reference manually.');
    }
  };
  return <><button className="button button-secondary button-small" type="button" onClick={() => void copy()}>Copy reference</button><span className="live-region" aria-live="polite">{status}</span></>;
}

function TransactionDetailPage({ accountId, journalId, navigate }: { accountId: string; journalId: string; navigate: Navigate }): JSX.Element {
  usePageTitle('Transaction detail');
  const session = useSession();
  const [detail, setDetail] = useState<TransactionDetail>();
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>();
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailure(undefined);
    void session.execute(api => api.accountTransaction(accountId, journalId)).then(record => {
      if (active) setDetail(record);
    }).catch(problem => {
      if (active) setFailure(problem);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [accountId, journalId, session]);

  return (
    <ProductFrame navigate={navigate}>
      <div className="page page-detail">
        <Link to={`/accounts/${accountId}`} navigate={navigate} className="back-link">← Back to account activity</Link>
        {failure !== undefined && <ProblemPanel failure={failure} />}
        {loading ? <LoadingState label="Loading authorized transaction detail" /> : detail ? (
          <>
            <header className="detail-hero">
              <div>
                <p className="eyebrow">Immutable transaction record</p>
                <h1>{humanKind(detail.kind)}</h1>
                <p><time dateTime={detail.createdAt}>{formatInstant(detail.createdAt)}</time></p>
              </div>
              <div className={detail.effectMinor.startsWith('-') ? 'detail-amount negative' : 'detail-amount positive'}>
                <span>Economic effect on this wallet</span>
                <strong>{formatMoney(detail.effectMinor, detail.currency, true)}</strong>
                <span className="status-badge"><span aria-hidden="true">✓</span> Posted</span>
              </div>
            </header>
            <section className="reference-panel" aria-labelledby="reference-title">
              <div><p className="eyebrow">Support and replay reference</p><h2 id="reference-title">Operation reference</h2></div>
              <code>{detail.operationId}</code>
              <CopyReference value={detail.operationId} />
            </section>
            <dl className="detail-grid">
              <div><dt>Journal ID</dt><dd><code>{detail.journalId}</code></dd></div>
              <div><dt>Account</dt><dd>{detail.accountName}</dd></div>
              <div><dt>Wallet reference</dt><dd><code>{detail.accountPublicRef}</code></dd></div>
              <div><dt>Currency</dt><dd>{detail.currency}</dd></div>
            </dl>
            <section className="privacy-note" aria-labelledby="privacy-title">
              <span aria-hidden="true">◎</span>
              <div><h2 id="privacy-title">Customer-safe view</h2><p>This page contains only this wallet’s economic lines. Counterparty balances, unrelated history and internal security data are intentionally not returned.</p></div>
            </section>
            <section aria-labelledby="entries-title">
              <div className="section-heading"><div><p className="eyebrow">Your side of the balanced journal</p><h2 id="entries-title">Journal entries</h2></div><span>{detail.entries.length} line{detail.entries.length === 1 ? '' : 's'}</span></div>
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Customer-owned journal entries</caption>
                  <thead><tr><th scope="col">Entry ID</th><th scope="col">Side</th><th scope="col">Amount</th><th scope="col">Created</th></tr></thead>
                  <tbody>{detail.entries.map(entry => <tr key={entry.id}><td data-label="Entry ID"><code>{entry.id}</code></td><td data-label="Side"><span className="status-badge neutral">{entry.side}</span></td><td data-label="Amount" className="money">{formatMoney(entry.amountMinor, entry.currency)}</td><td data-label="Created"><time dateTime={entry.createdAt}>{formatInstant(entry.createdAt)}</time></td></tr>)}</tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </ProductFrame>
  );
}

function NotFoundPage({ navigate }: { navigate: Navigate }): JSX.Element {
  usePageTitle('Page not found');
  return <ProductFrame navigate={navigate}><div className="page page-narrow"><EmptyState title="Page not found" message="The requested interface route is not part of the delivered product slice." action={<Link to="/" navigate={navigate} className="button button-primary">Return to dashboard</Link>} /></div></ProductFrame>;
}

export default function App(): JSX.Element {
  const { path, navigate } = useRouter();
  const session = useSession();
  const publicPath = path === '/login' || path === '/register';

  useEffect(() => {
    if (session.status === 'AUTHENTICATED' && publicPath) navigate('/', true);
    if (session.status === 'ANONYMOUS' && !publicPath) navigate('/login', true);
  }, [navigate, publicPath, session.status]);

  if (session.status === 'BOOTING') return <BootstrapScreen />;
  if (session.status === 'ERROR') return <BootstrapScreen failure={session.bootstrapError} retry={session.retryBootstrap} />;
  if (session.status === 'ANONYMOUS') {
    return <><SessionExpiredDialog navigate={navigate} />{path === '/register' ? <RegisterPage navigate={navigate} /> : <LoginPage navigate={navigate} />}</>;
  }
  if (publicPath) return <BootstrapScreen />;

  const accountMatch = path.match(/^\/accounts\/([0-9a-f-]{36})$/i);
  const detailMatch = path.match(/^\/accounts\/([0-9a-f-]{36})\/transactions\/([0-9a-f-]{36})$/i);
  let page: JSX.Element;
  if (path === '/') page = <DashboardPage navigate={navigate} />;
  else if (detailMatch?.[1] && detailMatch[2]) page = <TransactionDetailPage accountId={detailMatch[1]} journalId={detailMatch[2]} navigate={navigate} />;
  else if (accountMatch?.[1]) page = <AccountHistoryPage accountId={accountMatch[1]} navigate={navigate} />;
  else page = <NotFoundPage navigate={navigate} />;
  return <><SessionExpiredDialog navigate={navigate} />{page}</>;
}
