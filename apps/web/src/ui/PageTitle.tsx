// The h1 of a view, always with the brand full stop ("Räume.", "Einstellungen.").
// Every view uses this instead of a bare <h1>; apps/web/test/web.test.mjs enforces it.
import type { ReactNode } from 'react';

export function PageTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h1 className={className}>
      {children}
      <span className="period">.</span>
    </h1>
  );
}
