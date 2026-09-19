import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const URL = "https://brainy-skunk-440.convex.cloud";
export const WEBSITE = "https://brainy-skunk-440.convex.site";
export const PREFIX = "AUDIT-QA35-";
export const EVIDENCE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "evidence"
);

export function client() {
  const raw = new ConvexHttpClient(URL);
  return {
    raw,
    query: (name, args) => withRetry(() => raw.query(name, args), 3),
    mutation: (name, args) => withRetry(() => raw.mutation(name, args), 2),
    action: (name, args) => withRetry(() => raw.action(name, args), 2),
  };
}

export async function withRetry(fn, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const msg = String(err?.message ?? err);
      const transient = /fetch failed|ECONNRESET|socket hang up|network|ETIMEDOUT|EAI_AGAIN|timeout/i.test(msg);
      if (!transient) throw err;
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw last;
}

export function fixtureTitle(purpose) {
  return `${PREFIX}${purpose}`;
}

export function writeEvidence(name, obj) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `fix4-qa35-${name}.json`);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  console.log(`[evidence] ${file}`);
  return file;
}

export function readEvidence(name) {
  return JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, `fix4-qa35-${name}.json`), "utf8"));
}

export function writeLog(name, lines) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `fix4-qa35-${name}.log`);
  fs.writeFileSync(file, lines.join("\n") + "\n");
  console.log(`[log] ${file}`);
  return file;
}

export async function call(label, fn) {
  try {
    const value = await fn();
    return { label, ok: true, value };
  } catch (err) {
    const data = err && typeof err === "object" && "data" in err ? err.data : null;
    return {
      label,
      ok: false,
      data: typeof data === "string" ? data : data == null ? null : JSON.stringify(data),
      message: err?.message ?? String(err),
      name: err?.name ?? null,
    };
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function findProjectByTitle(c, title) {
  const projects = (await c.query("projects:listProjects", {})) || [];
  return projects.find((p) => p.title === title) || null;
}

export const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

export async function projectSnapshot(c, projectId) {
  const [project, packages, agreements, bids, contractors, logs] = await Promise.all([
    c.query("projects:getProject", { projectId }),
    c.query("tradePackages:listByProject", { projectId }),
    c.query("agreements:listAgreements", { projectId }),
    c.query("bids:listAllProjectBids", { projectId }),
    c.query("contractors:listByProject", { projectId }),
    c.query("auditLogs:listRecentLogs", { projectId, limit: 500 }),
  ]);
  return {
    project,
    packages: packages || [],
    agreements: agreements || [],
    bids: bids || [],
    contractors: contractors || [],
    logs: logs || [],
  };
}

export const NEW_CREDIT_RX = /^Cross-Trade Clash Credit \[([^\]]+)\]:/;
export const LEGACY_CREDIT_RX = /^Cross-Trade Clash Credit: Deduct redundant /;
export const CREDIT_RX = /^Cross-Trade Clash Credit(?: \[[^\]]+\])?:/;

/** Interval markers, not "^" prefix, because QA fixtures prefix some names. */
export const isCreditRow = (v) => CREDIT_RX.test(String(v?.description || ""));

/** Clash id carried by a credit row marker ([clash-...]) or null for legacy. */
export function creditClashId(desc) {
  const m = NEW_CREDIT_RX.exec(String(desc || ""));
  return m ? m[1] : null;
}

/** Recompute the ADR-0003 leveled total from persisted bid fields. */
export function recomputeLeveled(bid) {
  const activeExclusionsCost = (bid.identifiedExclusions || []).reduce(
    (sum, x) => (x.isWaived ? sum : sum + (x.costImpact || 0)),
    0
  );
  const acceptedVeDeduct = (bid.valueEngineeringAlternates || []).reduce(
    (sum, x) => (x.isAccepted ? sum + (x.costDeduct || 0) : sum),
    0
  );
  return Math.max(
    0,
    bid.baseBidAmount + activeExclusionsCost + (bid.leadTimePenalty || 0) + (bid.coiPenalty || 0) - acceptedVeDeduct
  );
}

export const creditRows = (bid) => (bid?.valueEngineeringAlternates || []).filter(isCreditRow);

/**
 * Cross-trade credit invariant sweep over a project (marker-aware A35):
 *  - cards: detectCrossTradeClashes output
 *  - claims: summed deductedAmount across "deducted" cards (backend KPI)
 *  - actualAccepted: summed accepted Cross-Trade Clash Credit rows on every bid (real money)
 *  - unspecified: a deducted card whose deductedAmount has no accepted credit row
 *    carrying the SAME clash marker ([clashId]) (legacy note rows count as match-all fallback)
 *  - masked: a deducted card whose own credit is not accepted, but an unrelated accepted
 *    credit of equal amount exists
 *  - stacked: >1 accepted credit row for the same clash marker
 *  - leveledDrift: recomputed ADR-0003 leveled total != persisted leveledTotalCost
 */
export async function creditInvariants(c, projectId) {
  const [detect, packages, bidsAll] = await Promise.all([
    c.query("coordination:detectCrossTradeClashes", { projectId }),
    c.query("tradePackages:listByProject", { projectId }),
    c.query("bids:listAllProjectBids", { projectId }),
  ]);
  const cards = [
    ...(detect.doubleBuys || []).map((d) => ({ ...d, kind: "double_buy" })),
    ...(detect.scopeVoids || []).map((v) => ({ ...v, kind: "scope_void" })),
  ];
  const deductedCards = cards.filter((x) => x.kind === "double_buy" && x.status === "deducted");
  const staleCards = cards.filter((x) => x.kind === "double_buy" && x.staleResolution === true);
  const acceptedCredits = [];
  const allCredits = [];
  const leveledDrift = [];
  for (const b of bidsAll) {
    const rows = creditRows(b);
    for (const r of rows) {
      allCredits.push({ bidId: b._id, pkg: b.tradePackageId, clashId: creditClashId(r.description), amount: r.costDeduct || 0, accepted: !!r.isAccepted, description: String(r.description) });
    }
    for (const r of rows.filter((r) => r.isAccepted)) {
      acceptedCredits.push({ bidId: b._id, clashId: creditClashId(r.description), amount: r.costDeduct || 0, description: String(r.description) });
    }
    const rec = recomputeLeveled(b);
    if (rec !== b.leveledTotalCost) {
      leveledDrift.push({ bidId: b._id, persisted: b.leveledTotalCost, recomputed: rec, delta: b.leveledTotalCost - rec });
    }
  }
  const matchesCard = (r, card) => {
    if (r.clashId) return r.clashId === card.id;
    return String(r.description || "").includes(card.title);
  };
  const unspecified = deductedCards.filter((card) => !acceptedCredits.some((r) => r.amount === card.deductedAmount && matchesCard(r, card)));
  const stacked = [];
  for (const card of deductedCards) {
    const same = acceptedCredits.filter((r) => matchesCard(r, card));
    if (same.length > 1) stacked.push({ clashId: card.id, title: card.title, rows: same.length, amounts: same.map((r) => r.amount) });
  }
  const masked = deductedCards.filter((card) => {
    if (acceptedCredits.some((r) => r.amount === card.deductedAmount && matchesCard(r, card))) return false;
    return acceptedCredits.some((r) => r.amount === card.deductedAmount && !matchesCard(r, card));
  });
  const claimsTotal = deductedCards.reduce((s, d) => s + (typeof d.deductedAmount === "number" ? d.deductedAmount : d.redundantAmount || 0), 0);
  const actualTotal = acceptedCredits.reduce((s, r) => s + r.amount, 0);
  return {
    cards,
    packages: packages.map((p) => ({ _id: p._id, csiDivision: p.csiDivision, tradeName: p.tradeName })),
    deductedCards,
    staleCards,
    acceptedCredits,
    allCredits,
    claimsTotal,
    actualTotal,
    kpiVsActual: claimsTotal === actualTotal,
    unspecified: unspecified.map((c) => ({ id: c.id, title: c.title, deductedAmount: c.deductedAmount })),
    masked: masked.map((c) => ({ id: c.id, title: c.title, deductedAmount: c.deductedAmount })),
    stacked,
    leveledDrift,
    summary: {
      detected: cards.filter((c) => c.kind === "double_buy" && c.status === "detected").length,
      deducted: deductedCards.length,
      stale: staleCards.length,
      acceptedCredits: acceptedCredits.length,
    },
  };
}