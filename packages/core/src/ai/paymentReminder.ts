/**
 * Payment reminder drafting — "Money Moves" slice 3 (5 October 2026,
 * docs/ideas/AiFA_Improvement_Proposal_Money_Moves.md).
 *
 * Turns an overdue-invoice Money Move into a ready-to-send WhatsApp
 * message. DRAFT ONLY: nothing here sends anything. The UI shows the
 * text for the owner to edit, then opens a `wa.me` click-to-chat link —
 * the owner taps Send inside WhatsApp themselves, exactly like the
 * existing Quotation send flow (quotationInvoiceTransport.ts header,
 * owner's Sprint 21 choice).
 *
 * Deterministic templates, not an AI call: the facts (who, which
 * invoice, how much, how late) are already known exactly, so a template
 * is cheaper, works with no AI key, and can never invent a wrong amount.
 * Tone steps up with lateness (friendly → firm → final) and the owner
 * can pick English or Bahasa Melayu.
 */

export type ReminderLanguage = "en" | "ms";
export type ReminderTone = "friendly" | "firm" | "final";

export interface PaymentReminderInput {
  /** Customer display name; null/empty falls back to a neutral greeting. */
  customerName: string | null;
  invoiceNo: string;
  outstandingBalance: number;
  /** ISO date "YYYY-MM-DD". */
  dueDate: string;
  daysOverdue: number;
  /** Sender's business name for the sign-off; omitted when unknown. */
  businessName?: string | null;
}

/** ≤30 days friendly, 31-60 firm, over 60 final notice. */
export function reminderToneFor(daysOverdue: number): ReminderTone {
  if (daysOverdue > 60) return "final";
  if (daysOverdue > 30) return "firm";
  return "friendly";
}

function rm(n: number): string {
  return `RM${n.toFixed(2)}`;
}

export function draftPaymentReminder(
  input: PaymentReminderInput,
  language: ReminderLanguage = "en",
): string {
  const tone = reminderToneFor(input.daysOverdue);
  const name = input.customerName?.trim() || null;
  const amount = rm(input.outstandingBalance);
  const days = input.daysOverdue;
  const sign = input.businessName?.trim()
    ? `\n\n${input.businessName.trim()}`
    : "";

  if (language === "ms") {
    const greet = name ? `Salam sejahtera ${name},` : "Salam sejahtera,";
    const body =
      tone === "friendly"
        ? `Ini peringatan mesra bahawa invois ${input.invoiceNo} berjumlah ${amount} telah tamat tempoh pada ${input.dueDate} (${days} hari lepas). Mohon jasa baik pihak tuan/puan untuk membuat bayaran apabila berkesempatan.`
        : tone === "firm"
          ? `Invois ${input.invoiceNo} berjumlah ${amount} masih belum dijelaskan dan telah lewat ${days} hari (tarikh akhir ${input.dueDate}). Mohon jelaskan bayaran secepat mungkin, atau maklumkan kepada kami jika ada sebarang isu.`
          : `Ini notis akhir untuk invois ${input.invoiceNo} berjumlah ${amount}, yang telah lewat ${days} hari (tarikh akhir ${input.dueDate}). Mohon jelaskan bayaran dalam masa 7 hari atau hubungi kami segera untuk berbincang.`;
    const close =
      tone === "friendly"
        ? "Terima kasih."
        : "Terima kasih atas perhatian segera pihak tuan/puan.";
    return `${greet}\n\n${body}\n\n${close}${sign}`;
  }

  const greet = name ? `Hi ${name},` : "Hello,";
  const body =
    tone === "friendly"
      ? `A friendly reminder that invoice ${input.invoiceNo} for ${amount} was due on ${input.dueDate} (${days} day(s) ago). We'd appreciate payment when convenient.`
      : tone === "firm"
        ? `Invoice ${input.invoiceNo} for ${amount} is now ${days} days overdue (due ${input.dueDate}). Please arrange payment as soon as possible, or let us know if there is any issue.`
        : `This is a final reminder for invoice ${input.invoiceNo} for ${amount}, now ${days} days overdue (due ${input.dueDate}). Please settle within 7 days or contact us right away to discuss.`;
  const close =
    tone === "friendly" ? "Thank you." : "Thank you for your prompt attention.";
  return `${greet}\n\n${body}\n\n${close}${sign}`;
}

/**
 * Normalises a Malaysian phone number to the digits-only E.164 form
 * `wa.me` expects (e.g. "012-345 6789" → "60123456789"). Returns null
 * when the number is missing or clearly not a phone number, so the UI
 * can say so instead of opening a broken link.
 */
export function normaliseMyPhoneE164(
  phone: string | null | undefined,
): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2); // international prefix
  if (digits.startsWith("0")) digits = `60${digits.slice(1)}`; // local trunk 0 → country code
  if (digits.length < 9 || digits.length > 15) return null;
  return digits;
}

/**
 * Click-to-chat link. With no phone, WhatsApp opens with the text ready
 * and asks the owner to pick the contact themselves.
 */
export function buildWhatsAppLink(
  phoneE164: string | null,
  text: string,
): string {
  const q = `?text=${encodeURIComponent(text)}`;
  return phoneE164 ? `https://wa.me/${phoneE164}${q}` : `https://wa.me/${q}`;
}
