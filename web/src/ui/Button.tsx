import { forwardRef, type ButtonHTMLAttributes } from "react";

import { Icon, type IconName } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  /** Shows a spinner and disables the button while an action runs. */
  loading?: boolean;
  icon?: IconName;
}

/**
 * One button for the whole console. `primary` is the single gold brand
 * button (one per screen area); everything else is white, red or ghost.
 * Defaults to type="button" so a button inside a form never submits it by
 * accident.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  const classes = ["ui-btn", `ui-btn--${variant}`, size === "sm" ? "ui-btn--sm" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="ui-spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
});
