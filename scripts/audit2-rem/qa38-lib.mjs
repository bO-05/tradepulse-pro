/**
 * QA38 shared harness (fix4-qa38-* evidence). Final clean-round pass.
 * Marker-aware: matches both clash-keyed and legacy credit-row formats.
 */
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const URL = "https://brainy-skunk-440.convex.cloud";
export const WEBSITE = "https://brainy-skunk-440.convex.site";
export const PREFIX = "AUDIT-QA38-";
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
  const file = path.join(EVIDENCE_DIR, `fix4-qa38-${name}.json`);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  console.log(`[evidence] ${file}`);
  return file;
}

export function readEvidence(name) {
  return JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, `fix4-qa38-${name}.json`), "utf8"));
}

export function writeLog(name, lines) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `fix4-qa38-${name}.log`);
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
export const CREDIT_RX = /^Cross-Trade Clash Credit(\s*\[|\s*:)/;
export const REVERSED_AUDIT_RX = /Double-Buy Credit Reversed/;
export const CLEARED_AUDIT_RX = /Double-Buy Credit Record Cleared/;

export const isCreditRow = (v) => CREDIT_RX.test(String(v?.description || ""));

export function creditClashId(desc) {
  const m = NEW_CREDIT_RX.exec(String(desc || ""));
  return m ? m[1] : null;
}

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
  const detectedCards = cards.filter((x) => x.kind === "double_buy" && x.status === "detected");
  const acceptedCredits = [];
  const declinedCredits = [];
  const allCredits = [];
  const leveledDrift = [];
  for (const b of bidsAll) {
    for (const r of creditRows(b)) {
      const rec = {
        bidId: b._id,
        pkg: b.tradePackageId,
        clashId: creditClashId(r.description),
        legacy: LEGACY_CREDIT_RX.test(String(r.description || "")),
        amount: r.costDeduct || 0,
        accepted: !!r.isAccepted,
        description: String(r.description),
      };
      allCredits.push(rec);
      (rec.accepted ? acceptedCredits : declinedCredits).push(rec);
    }
    const recomputed = recomputeLeveled(b);
    if (recomputed !== b.leveledTotalCost) {
      leveledDrift.push({ bidId: b._id, persisted: b.leveledTotalCost, recomputed, delta: b.leveledTotalCost - recomputed });
    }
  }
  const matchesCard = (r, card) =>
    r.clashId ? r.clashId === card.id : String(r.description || "").includes(card.title);
  const perCard = deductedCards.map((card) => {
    const own = acceptedCredits.filter((r) => matchesCard(r, card));
    return {
      id: card.id,
      cardAmount: card.deductedAmount,
      rowCount: own.length,
      rowSum: own.reduce((s, r) => s + r.amount, 0),
      amounts: own.map((r) => r.amount),
      clashIds: own.map((r) => r.clashId),
    };
  });
  const overclaim = perCard.filter((p) => p.rowCount === 0 || p.rowSum !== p.cardAmount);
  const stacked = perCard.filter((p) => p.rowCount > 1);
  const mismatchRow = perCard.filter((p) => p.rowCount > 0 && p.rowSum !== p.cardAmount);
  const orphanCredit = acceptedCredits.filter((r) => {
    const card = deductedCards.find((card) => (r.clashId ? r.clashId === card.id : String(r.description || "").includes(card.title)));
    if (!card) return true;
    return String(r.description || "").includes(card.title) === false && r.clashId === null;
  });
  const staleWithAccepted = staleCards.filter((card) => acceptedCredits.some((r) => matchesCard(r, card)));
  const detectedWithAccepted = detectedCards.filter((card) => acceptedCredits.some((r) => matchesCard(r, card)));
  const limbo = declinedCredits.filter((r) => !staleCards.some((card) => matchesCard(r, card)));
  const claimsTotal = deductedCards.reduce(
    (s, d) => s + (typeof d.deductedAmount === "number" ? d.deductedAmount : d.redundantAmount || 0),
    0
  );
  const actualTotal = acceptedCredits.reduce((s, r) => s + r.amount, 0);
  return {
    cards,
    packages: packages.map((p) => ({ _id: p._id, csiDivision: p.csiDivision, tradeName: p.tradeName })),
    deductedCards,
    staleCards,
    detectedCards,
    acceptedCredits,
    declinedCredits,
    allCredits,
    claimsTotal,
    actualTotal,
    kpiVsActual: claimsTotal === actualTotal,
    overclaim,
    mismatchRow,
    stacked,
    orphanCredit,
    staleWithAccepted,
    detectedWithAccepted,
    limbo,
    leveledDrift,
    clean:
      overclaim.length === 0 &&
      stacked.length === 0 &&
      orphanCredit.length === 0 &&
      staleWithAccepted.length === 0 &&
      detectedWithAccepted.length === 0 &&
      limbo.length === 0 &&
      claimsTotal === actualTotal &&
      leveledDrift.length === 0,
    summary: {
      deducted: deductedCards.length,
      stale: staleCards.length,
      acceptedCredits: acceptedCredits.length,
      declinedCredits: declinedCredits.length,
      claimsTotal,
      actualTotal,
    },
  };
}

export const getBid = async (c, projectId, bidId) =>
  (await c.query("bids:listAllProjectBids", { projectId }))?.find((b) => b._id === bidId) || null;
export const detect = (c, projectId) => c.query("coordination:detectCrossTradeClashes", { projectId });
export const logs = (c, projectId, limit = 500) =>
  c.query("auditLogs:listRecentLogs", { projectId, limit }) || [];

export const VFD_TITLE = "Variable Frequency Drives (VFDs) for AHUs & Pumps";
export const DISC_TITLE = "Rooftop Mechanical Equipment Disconnect Switches";
export const CLASH_VFD = "clash-vfd-01";
export const CLASH_DISC = "clash-disconnect-02";