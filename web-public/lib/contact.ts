// Contact-detail helpers for the public site (UI polish Phase 5).
//
// Turns the free-text email and phone an owner typed into safe links. A value
// that does not look right gets no link and is shown as plain text instead,
// so a typo never becomes a broken or unsafe href.

const EMAIL_PATTERN = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

export function emailHref(email: string): string | null {
  const value = email.trim();
  return EMAIL_PATTERN.test(value) ? `mailto:${value}` : null;
}

/**
 * Digits-only international number for tel: and wa.me links, or null when the
 * number cannot be read with confidence. Malaysian local numbers (leading 0)
 * get the 60 country code; "+" and "00" prefixes are taken as international.
 */
export function internationalDigits(phone: string): string | null {
  const raw = phone.trim();
  if (!raw || /[^\d\s()+.\-]/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");

  let normalised: string;
  if (raw.startsWith("+")) normalised = digits;
  else if (digits.startsWith("00")) normalised = digits.slice(2);
  else if (digits.startsWith("0")) normalised = `60${digits.slice(1)}`;
  else if (digits.startsWith("60")) normalised = digits;
  else return null;

  return normalised.length >= 9 && normalised.length <= 15 ? normalised : null;
}

export function telHref(phone: string): string | null {
  const digits = internationalDigits(phone);
  return digits ? `tel:+${digits}` : null;
}

export function whatsAppHref(phone: string): string | null {
  const digits = internationalDigits(phone);
  return digits ? `https://wa.me/${digits}` : null;
}
