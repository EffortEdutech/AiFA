import { useState, type InputHTMLAttributes } from "react";

import { Icon } from "./icons";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/**
 * Password field with a show/hide (eye) toggle. Drop-in for
 * `<input className="ui-input" type="password" />` inside a <Field>:
 * spread the Field's control props and pass value/onChange as usual.
 * The toggle is a real button (keyboard + screen-reader operable,
 * `aria-pressed`), is skipped by autofill, and never submits the form.
 */
export function PasswordInput({ className, ...rest }: PasswordInputProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  return (
    <div className="ui-password">
      <input
        {...rest}
        className={["ui-input", "ui-password__input", className].filter(Boolean).join(" ")}
        type={visible ? "text" : "password"}
      />
      <button
        type="button"
        className="ui-password__toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        title={visible ? "Hide password" : "Show password"}
      >
        <Icon name={visible ? "eyeOff" : "eye"} size={18} />
      </button>
    </div>
  );
}
