import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import App from './App.js';
import { isP08BPath, normalizeProductPath } from './p08b-core.js';
import { P08BRoutes, type ProductNavigate } from './p08b-ui.js';
import { useSession } from './session.js';

function currentLocation(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function useProductLocation(): { location: string; path: string; navigate: ProductNavigate } {
  const [location, setLocation] = useState(currentLocation);
  useEffect(() => {
    const update = () => setLocation(currentLocation());
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  const navigate = useCallback<ProductNavigate>((next, options = {}) => {
    const normalized = normalizeProductPath(next);
    const search = next.includes('?') ? `?${next.split('?').slice(1).join('?')}` : '';
    const destination = `${normalized}${search}`;
    const state = options.state ?? null;
    if (options.replace) window.history.replaceState(state, '', destination);
    else window.history.pushState(state, '', destination);
    window.dispatchEvent(new PopStateEvent('popstate', { state }));
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);
  return { location, path: normalizeProductPath(location), navigate };
}

function ProductLink({ href, children, navigate }: { href: string; children: string; navigate: ProductNavigate }): JSX.Element {
  return <a className="nav-link" href={href} onClick={(event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  }}>{children}</a>;
}

function NavigationBridge({ navigate }: { navigate: ProductNavigate }): JSX.Element | null {
  const session = useSession();
  const [mount, setMount] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (session.status !== 'AUTHENTICATED' || session.user?.role !== 'CUSTOMER') {
      setMount(null);
      return;
    }
    let active = true;
    let owned: HTMLElement | undefined;
    const attach = () => {
      if (!active || owned?.isConnected) return;
      const nav = document.querySelector<HTMLElement>('.site-header nav');
      if (!nav) return;
      const existing = nav.querySelector<HTMLElement>('[data-p08b-navigation]');
      owned = existing ?? document.createElement('span');
      owned.dataset.p08bNavigation = 'true';
      owned.className = 'p08b-navigation-bridge';
      if (!existing) nav.insertBefore(owned, nav.lastElementChild);
      setMount(owned);
    };
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      active = false;
      observer.disconnect();
      setMount(null);
      if (owned?.dataset.p08bNavigation === 'true') owned.remove();
    };
  }, [session.status, session.user?.role]);
  if (!mount) return null;
  return createPortal(<>
    <ProductLink href="/transfers/new" navigate={navigate}>Transfer</ProductLink>
    <ProductLink href="/payments" navigate={navigate}>Payments</ProductLink>
  </>, mount);
}

export default function ProductRouter(): JSX.Element {
  const session = useSession();
  const { location, path, navigate } = useProductLocation();
  const customRoute = isP08BPath(path);
  if (customRoute && session.status === 'AUTHENTICATED') {
    return <P08BRoutes path={path} location={location} navigate={navigate} />;
  }
  return <><App /><NavigationBridge navigate={navigate} /></>;
}
