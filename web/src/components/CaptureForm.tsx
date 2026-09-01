import { useState } from "react";

import { recordBankTransaction } from "@aifa/core/db/bankingRepository";
import type { PaymentMethod } from "@aifa/core/db/businessEventRepository";
import type { SqlDb } from "@aifa/core/db/types";
import {
  confirmCategory,
  runCaptureInterpretation,
  categoryOptionsForDomain,
  type InterpretationOutcome,
} from "@aifa/core/ai/capturePipeline";
import type { AiProvider } from "@aifa/core/ai/types";

type Domain = "expense" | "sale" | "purchase" | "banking";

interface Props {
  db: SqlDb;
  provider: AiProvider;
  businessId: string;
  onCaptured: () => void;
}

/**
 * Manual/text capture — Sprint 18's Phase 2a slice (Vol 12_0 §4: "Yes" for
 * all four domains, text-only — photo/document capture is explicitly "No"
 * this phase, upload-fallback deferred to Phase 2b). Runs through
 * @aifa/core's exact same runCaptureInterpretation/confirmCategory /
 * recordBankTransaction the mobile app uses — proving the Sprint 13
 * extraction holds for a second real UI, this sprint's whole point.
 */
export function CaptureForm({ db, provider, businessId, onCaptured }: Props): JSX.Element {
  const [domain, setDomain] = useState<Domain>("expense");
  const [description, setDescription] = useState("");
  const [counterpartyName, setCounterpartyName] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<InterpretationOutcome | null>(null);
  const [chosenCategory, setChosenCategory] = useState("");

  async function handleSubmit(): Promise<void> {
    const parsedAmount = Number(amount);
    if (!description.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("Enter a description and a positive amount.");
      return;
    }
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      if (domain === "banking") {
        await recordBankTransaction(db, {
          businessId,
          transactionType: "deposit",
          description: description.trim(),
          amount: parsedAmount,
          currency: "USD",
        });
        setDescription("");
        setAmount("");
        onCaptured();
      } else {
        const result = await runCaptureInterpretation(db, provider, {
          domain,
          businessId,
          description: description.trim(),
          counterpartyName: counterpartyName.trim() || undefined,
          amount: parsedAmount,
          currency: "USD",
          paymentMethod,
        });
        setOutcome(result);
        if (result.decision === "auto_record") {
          setDescription("");
          setAmount("");
          setCounterpartyName("");
          onCaptured();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Capture failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(): Promise<void> {
    if (!outcome || !chosenCategory) return;
    setBusy(true);
    try {
      await confirmCategory(
        db,
        outcome.event,
        outcome.data,
        chosenCategory,
        paymentMethod,
      );
      setOutcome(null);
      setDescription("");
      setAmount("");
      setCounterpartyName("");
      setChosenCategory("");
      onCaptured();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm category.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Record a transaction</h2>
      <div className="row">
        <select value={domain} onChange={(e) => setDomain(e.target.value as Domain)}>
          <option value="expense">Expense</option>
          <option value="sale">Sale</option>
          <option value="purchase">Purchase</option>
          <option value="banking">Banking (deposit)</option>
        </select>
        <input
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{ flex: 1, minWidth: 160, padding: 8 }}
        />
        {domain !== "banking" && (
          <input
            placeholder="Counterparty (optional)"
            value={counterpartyName}
            onChange={(e) => setCounterpartyName(e.target.value)}
            style={{ padding: 8 }}
          />
        )}
        <input
          type="number"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ width: 110, padding: 8 }}
        />
        {domain !== "banking" && (
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
          >
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="card">Card</option>
            <option value="unspecified">Unspecified / on account</option>
          </select>
        )}
        <button onClick={() => void handleSubmit()} disabled={busy}>
          {busy ? "Recording…" : "Record"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      {outcome && outcome.decision !== "auto_record" && (
        <div style={{ marginTop: 12, borderTop: "1px solid #e2e2e5", paddingTop: 12 }}>
          {outcome.decision === "draft_confirm" && (
            <p>
              AI suggests <strong>{outcome.category}</strong> (confidence{" "}
              {Math.round(outcome.confidence * 100)}%). Confirm or pick a
              different category:
            </p>
          )}
          {outcome.decision === "clarify" && (
            <p>{outcome.clarifyingQuestion ?? "AI needs a category — please pick one:"}</p>
          )}
          {outcome.decision === "queued_retry" && (
            <p className="muted">
              Couldn't reach the AI right now — this capture is queued and
              will be classified once available.
            </p>
          )}
          {(outcome.decision === "draft_confirm" || outcome.decision === "clarify") && (
            <div className="row">
              <select
                value={chosenCategory || outcome.category || ""}
                onChange={(e) => setChosenCategory(e.target.value)}
              >
                <option value="">Choose category…</option>
                {categoryOptionsForDomain(outcome.event.domain_hint).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button onClick={() => void handleConfirm()} disabled={busy || !chosenCategory}>
                Confirm
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
