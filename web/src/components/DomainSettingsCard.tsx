/**
 * Domain settings — Sprint 65 (Architecture §2.4). Lets an Owner bind a
 * custom domain to this business: add a domain, show the DNS TXT record it
 * must publish to prove control, and check verification on demand.
 *
 * Custom-domain-only for v1 (ontology's confirmed decision, Architecture
 * §2.4) — no aifa.my fallback subdomain, so this card only ever manages the
 * one real domain a business chooses to bind. Deliberately separate from
 * WebsiteSettingsCard.tsx (this is domain/DNS state, not site content), but
 * rendered alongside it in BusinessSettingsPage.tsx, gated by the same
 * `canConfigure` (`settings: configure`) check.
 *
 * Once verified, this domain's routing is live immediately via
 * resolve_domain() (Sprint 65's own routing primitive) — Sprint 66's
 * homepage renderer is what actually calls it on incoming requests.
 */
import { useEffect, useState } from "react";

import { addDomain, checkDomainNow, getDomains, type DomainBinding } from "../lib/domains";

interface Props {
  businessId: string;
  canConfigure: boolean;
}

export function DomainSettingsCard({ businessId, canConfigure }: Props): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [domains, setDomains] = useState<DomainBinding[]>([]);

  const [newDomain, setNewDomain] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      setLoadError(null);
      setDomains(await getDomains(businessId));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load your domain.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  async function handleAddDomain(): Promise<void> {
    setAddBusy(true);
    setAddError(null);
    try {
      await addDomain(businessId, newDomain.trim());
      setNewDomain("");
      await load();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Could not add that domain.");
    } finally {
      setAddBusy(false);
    }
  }

  async function handleCheckNow(domainId: string): Promise<void> {
    setCheckingId(domainId);
    setCheckError(null);
    setCheckMessage(null);
    try {
      const verified = await checkDomainNow(domainId);
      setCheckMessage(verified ? "Verified!" : "Not verified yet — DNS records can take time to propagate.");
      await load();
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : "Could not check verification right now.");
    } finally {
      setCheckingId(null);
    }
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Domain</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Bind your own domain to your Public Site. We check for the DNS record automatically every few minutes, or
        you can check right away below.
      </p>

      {loadError && <p className="error">{loadError}</p>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          {domains.map((d) => (
            <div key={d.id} style={{ border: "1px solid var(--border, #333)", borderRadius: 8, padding: 12, marginBottom: 8 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{d.domain}</strong>
                <span className={d.verificationStatus === "verified" ? "muted" : "error"}>
                  {d.verificationStatus === "verified" ? "Verified" : "Pending verification"}
                </span>
              </div>
              {d.verificationStatus === "pending" && (
                <div style={{ marginTop: 8 }}>
                  <p className="muted" style={{ marginBottom: 4 }}>
                    Add this as a TXT record on <code>{d.domain}</code> at your domain registrar, then check
                    verification:
                  </p>
                  <code
                    style={{ display: "block", padding: 8, background: "rgba(127,127,127,0.15)", borderRadius: 4, wordBreak: "break-all" }}
                  >
                    {d.verificationToken}
                  </code>
                  {canConfigure && (
                    <div className="row" style={{ marginTop: 8 }}>
                      <button onClick={() => void handleCheckNow(d.id)} disabled={checkingId === d.id}>
                        {checkingId === d.id ? "Checking…" : "Check now"}
                      </button>
                    </div>
                  )}
                </div>
              )}
              {d.verifiedAt && (
                <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  Verified {new Date(d.verifiedAt).toLocaleString()}
                </p>
              )}
            </div>
          ))}
          {checkMessage && <p className="muted">{checkMessage}</p>}
          {checkError && <p className="error">{checkError}</p>}

          {canConfigure && domains.length === 0 && (
            <div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <input
                  placeholder="www.yourbusiness.com"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  style={{ padding: 6, flex: "1 1 220px" }}
                />
                <button onClick={() => void handleAddDomain()} disabled={addBusy || newDomain.trim() === ""}>
                  {addBusy ? "Adding…" : "Add domain"}
                </button>
              </div>
              {addError && <p className="error">{addError}</p>}
            </div>
          )}
          {!canConfigure && domains.length === 0 && (
            <p className="muted">
              Editing requires `settings: configure` access — contact an Owner or Bookkeeper to change this.
            </p>
          )}
        </>
      )}
    </div>
  );
}
