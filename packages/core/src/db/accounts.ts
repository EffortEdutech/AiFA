/**
 * Shared Phase 1 chart-of-accounts constants (Vol 11_1 §4.1) — kept in one
 * place so the exact account-name strings used by the ledger repository,
 * the AI pipeline's debit/credit-account rules, and the dashboard's
 * cash-position/receivables/payables queries can't silently drift apart
 * into typo'd duplicates.
 */
export const CASH_BANK_ACCOUNT = "Cash / Bank";
export const ACCOUNTS_PAYABLE_ACCOUNT = "Accounts Payable";
/** Sprint 6 addition — the Sales-domain counterpart to Accounts Payable. */
export const ACCOUNTS_RECEIVABLE_ACCOUNT = "Accounts Receivable";
