import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * A hash router in thirty lines. Hash routes work from any static host and
 * any sub-path with no server configuration.
 */
const read = () => window.location.hash.replace(/^#/, '') || '/';
const Ctx = createContext<string>('/');

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(read);
  useEffect(() => {
    const on = () => {
      setPath(read());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return <Ctx.Provider value={path}>{children}</Ctx.Provider>;
}

export const usePath = () => useContext(Ctx);
export const go = (to: string) => {
  window.location.hash = to;
};

/** Match "/agents/:wallet" against the current path. */
export function useMatch(pattern: string): Record<string, string> | null {
  const path = usePath().split('?')[0]!;
  return useMemo(() => {
    const a = pattern.split('/').filter(Boolean);
    const b = path.split('/').filter(Boolean);
    if (a.length !== b.length) return null;
    const out: Record<string, string> = {};
    for (let i = 0; i < a.length; i += 1) {
      if (a[i]!.startsWith(':')) {
        // A malformed escape in a pasted link is no match, not a blank page.
        try {
          out[a[i]!.slice(1)] = decodeURIComponent(b[i]!);
        } catch {
          return null;
        }
      } else if (a[i] !== b[i]) return null;
    }
    return out;
  }, [pattern, path]);
}

export function Link({ to, children, className, style, onClick }: { to: string; children: ReactNode; className?: string; style?: CSSProperties; onClick?: () => void }) {
  return (
    <a href={`#${to}`} className={className} style={style} onClick={onClick}>
      {children}
    </a>
  );
}
