/**
 * Prompt construction and response parsing shared by every AiProvider that
 * talks to a Claude-family text model — extracted from anthropicProvider.ts
 * (Sprint 6, AI Gateway migration) so gatewayProvider.ts can reuse the exact
 * same prompts/parsing instead of drifting from a second copy. No behavior
 * change from the original inline versions.
 */
import type {
  BusinessDomain,
  CategoryClassificationResult,
  DomainClassificationResult,
  ProfessionalContextBundle,
  VisionExtractedFields,
  VisionExtractionResult,
  WorkspaceAnswerResult,
} from "../types";

export function buildPrompt(pcb: ProfessionalContextBundle): string {
  return [
    "You are the Bookkeeping Intelligence Engine for a small-business finance app (Vol 2_2).",
    "Classify the following business event using ONLY the candidate categories and rules provided — never invent a category outside this list (Vol 2_2 Section 6). The user intent below states which domain (Expense, Sales, or Purchase) this event belongs to.",
    "",
    `User intent: ${pcb.user_intent}`,
    `Relevant PKA rule IDs: ${pcb.relevant_rules.join(", ")}`,
    `Business context: ${JSON.stringify(pcb.business_context)}`,
    `Financial context: ${JSON.stringify(pcb.financial_context)}`,
    `Limitations: ${pcb.limitations.join(" ")}`,
    "",
    "Respond with ONLY a single JSON object, no prose, no markdown fences, matching exactly:",
    '{"category": string | null, "confidence": number between 0 and 1, "reasoning": string, "clarifying_question": string | null, "matched_rule_ids": string[]}',
    'If you cannot confidently pick a category from the candidate list, set category to null, confidence below 0.6, and provide a specific clarifying_question (not a generic "please review").',
  ].join("\n");
}

export function parseClassificationJson(text: string): CategoryClassificationResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("AI response did not contain a JSON object.");
  }
  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  return {
    category: typeof parsed.category === "string" ? parsed.category : null,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    clarifying_question:
      typeof parsed.clarifying_question === "string"
        ? parsed.clarifying_question
        : null,
    matched_rule_ids: Array.isArray(parsed.matched_rule_ids)
      ? parsed.matched_rule_ids.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
  };
}

/**
 * Sprint 57 (Phase 5, 14 September 2026) — reuses the SAME `/ai-chat`
 * Gateway route `buildPrompt`/`classify()` already call (see
 * gatewayProvider.ts's `chat()` helper). No new Gateway server route is
 * needed for this capability, unlike vision/`buildVisionPrompt` — a
 * genuine, disclosed difference worth stating plainly rather than
 * assuming every new AI capability needs new server infrastructure.
 */
export function buildDomainClassificationPrompt(
  rawText: string,
  candidateDomains: BusinessDomain[],
): string {
  return [
    "You are the Universal Input Router for a small-business finance app (Vol_5_5).",
    "A business owner captured the text below — by typing it, forwarding a WhatsApp/email message, or having a photo/PDF/voice note already extracted to this text. Decide which ONE of the candidate domains it belongs to, and extract whatever structured fields you can read confidently.",
    "",
    `Candidate domains: ${candidateDomains.join(", ")}`,
    `Captured text: ${JSON.stringify(rawText)}`,
    "",
    "Respond with ONLY a single JSON object, no prose, no markdown fences, matching exactly:",
    '{"domain": string | null, "confidence": number between 0 and 1, "reasoning": string, "extracted_fields": object}',
    'Set domain to null (and confidence below 0.5) if the text does not clearly match any candidate domain — never force a guess into the closest-sounding option. "extracted_fields" is a flat object of whatever you found (e.g. amount, counterparty, startDate, endDate, lineItems) — omit fields you did not find rather than inventing a value; never fabricate a field the text does not support.',
  ].join("\n");
}

export function parseDomainClassificationJson(
  text: string,
  candidateDomains: BusinessDomain[],
): DomainClassificationResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("AI domain-classification response did not contain a JSON object.");
  }
  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  const domainCandidate = parsed.domain;
  const domain: BusinessDomain | null =
    typeof domainCandidate === "string" &&
    (candidateDomains as string[]).includes(domainCandidate)
      ? (domainCandidate as BusinessDomain)
      : null; // an unrecognised or missing domain is treated as "couldn't tell", never guessed into the nearest candidate
  const fields =
    typeof parsed.extracted_fields === "object" && parsed.extracted_fields !== null
      ? (parsed.extracted_fields as Record<string, unknown>)
      : {};
  return {
    domain,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    extractedFields: fields,
  };
}

export function buildVisionPrompt(): string {
  return [
    "You are reading a photographed business receipt or invoice for a small-business finance app (Vol 7_1 Section 5.1).",
    "Extract ONLY what you can read with confidence. Do not guess or fabricate any value.",
    "",
    "Respond with ONLY a single JSON object, no prose, no markdown fences, matching exactly:",
    '{"description": string | null, "counterparty_name": string | null, "amount": number | null, "currency": string | null, "extraction_status": "complete" | "partial" | "failed"}',
    '"complete" means description, amount, and currency were all read confidently. "partial" means at least one of those is missing/unreadable but something useful was read. "failed" means nothing usable was read (blurry, unrelated image, etc.) -- in that case every field must be null.',
  ].join("\n");
}

export function buildWorkspacePrompt(
  pcb: ProfessionalContextBundle,
  question: string,
): string {
  return [
    "You are the AI CFO Assistant for a small-business finance app (Vol 2_4), answering the owner's question inside the AI Workspace (Vol 7_2).",
    "Answer ONLY using the financial_context provided below. Never fabricate a figure or reference a Business Event id that is not listed in financial_context or the available source references. If the question cannot be answered from this data, set out_of_scope to true and explain what's missing instead of guessing (Vol 1_4 Section 7).",
    "",
    `User intent: ${pcb.user_intent}`,
    `Financial context: ${JSON.stringify(pcb.financial_context)}`,
    `Available source references (Business Event ids): ${pcb.source_references.join(", ") || "none"}`,
    `Limitations: ${pcb.limitations.join(" ")}`,
    "",
    `Owner's question: ${question}`,
    "",
    "Respond with ONLY a single JSON object, no prose, no markdown fences, matching exactly:",
    '{"answer": string, "sources": string[], "out_of_scope": boolean}',
    '"sources" must be a subset of the Business Event ids listed above, OR a short descriptive string like "cash_position" for a pure computation with no single source event. Use an empty array when out_of_scope is true.',
  ].join("\n");
}

export function parseWorkspaceAnswerJson(text: string): WorkspaceAnswerResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("AI Workspace response did not contain a JSON object.");
  }
  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  return {
    answer: typeof parsed.answer === "string" ? parsed.answer : "",
    sources: Array.isArray(parsed.sources)
      ? parsed.sources.filter((s): s is string => typeof s === "string")
      : [],
    out_of_scope:
      typeof parsed.out_of_scope === "boolean" ? parsed.out_of_scope : true, // an unparseable/missing flag defaults to the safe side: don't assume in-scope
  };
}

export function parseVisionExtractionJson(text: string): VisionExtractionResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Vision response did not contain a JSON object.");
  }
  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  const extractedFields: VisionExtractedFields = {
    description:
      typeof parsed.description === "string" ? parsed.description : null,
    counterpartyName:
      typeof parsed.counterparty_name === "string"
        ? parsed.counterparty_name
        : null,
    amount: typeof parsed.amount === "number" ? parsed.amount : null,
    currency: typeof parsed.currency === "string" ? parsed.currency : null,
  };
  const status = parsed.extraction_status;
  const extractionStatus: VisionExtractionResult["extractionStatus"] =
    status === "complete" || status === "partial" || status === "failed"
      ? status
      : "failed"; // an unrecognised status value is treated as failed, never guessed into 'complete'
  return { extractedFields, extractionStatus };
}
