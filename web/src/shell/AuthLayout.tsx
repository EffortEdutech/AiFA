/**
 * Shared frame for every screen shown before the console itself (sign-in,
 * workspace picker, business setup, device setup, data-cleared notice).
 * One brand header, one centred panel, one footer slot — so those screens
 * look like one product instead of five separate cards.
 */
import type { ReactNode } from "react";

interface AuthLayoutProps {
  title: string;
  description?: ReactNode;
  /** Small centred text under the panel (e.g. a mode toggle). */
  footer?: ReactNode;
  children: ReactNode;
}

export function AuthLayout({ title, description, footer, children }: AuthLayoutProps): JSX.Element {
  return (
    <div className="aifa-auth">
      <div className="aifa-auth__brand">
        <span className="aifa-brand__mark" aria-hidden="true">
          A
        </span>
        <span>AiFA</span>
      </div>
      <main className="aifa-auth__panel">
        <h1 className="aifa-auth__title">{title}</h1>
        {description && <div className="aifa-auth__desc">{description}</div>}
        {children}
      </main>
      {footer && <div className="aifa-auth__footer">{footer}</div>}
    </div>
  );
}
