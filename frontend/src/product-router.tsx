import { useCallback, useEffect, useRef, useState } from 'react';
import App from './App.js';
import { adminRoute } from './admin-api.js';
import { P08FRoutes } from './p08f-ui.js';
import { isP08BPath, normalizeProductPath } from './p08b-core.js';
import { P08BRoutes, type ProductNavigate } from './p08b-ui.js';
import { adjustmentRoute } from './p08c-core.js';
import { P08CRoutes } from './p08c-ui.js';
import { P08DRoutes } from './p08d-ui.js';
import { P08ERoutes } from './p08e-ui.js';
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

export default function ProductRouter(): JSX.Element {
  const session = useSession();
  const { location, path, navigate } = useProductLocation();
  const previousPath = useRef(path);
  useEffect(() => {
    const changed = previousPath.current !== path;
    previousPath.current = path;
    if (!changed || session.status !== 'AUTHENTICATED') return;
    const main = document.getElementById('main-content');
    // Respect a destination's more specific focus management (e.g. receipts).
    if (!main || main.contains(document.activeElement)) return;
    const heading = main.querySelector<HTMLElement>('h1');
    if (heading) heading.tabIndex = -1;
    (heading ?? main).focus({ preventScroll: true });
  }, [path, session.status]);
  let content: JSX.Element;
  if (session.status === 'AUTHENTICATED' && adminRoute(path)) {
    content = <P08FRoutes path={path} location={location} navigate={navigate} />;
  } else if (session.status === 'AUTHENTICATED' && (path === '/webhooks' || path.startsWith('/webhooks/'))) {
    content = <P08ERoutes path={path} navigate={navigate} />;
  } else if (session.status === 'AUTHENTICATED' && (adjustmentRoute(path) || (path === '/' && session.user?.role === 'ADMIN'))) {
    content = <P08CRoutes path={path === '/' ? '/admin/adjustments' : path} navigate={navigate} />;
  } else if (session.status === 'AUTHENTICATED' && (path === '/schedules' || path.startsWith('/schedules/'))) {
    content = <P08DRoutes path={path} navigate={navigate} />;
  } else if (isP08BPath(path) && session.status === 'AUTHENTICATED') {
    content = <P08BRoutes path={path} location={location} navigate={navigate} />;
  } else {
    content = <App />;
  }
  return content;
}
