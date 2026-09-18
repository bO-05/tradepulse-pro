import { Agreement, Bid, TradePackage } from "./types.ts";

export function calculateLeveledCost(
  bid: Pick<Bid, "baseBidAmount" | "identifiedExclusions" | "valueEngineeringAlternates" | "leadTimePenalty" | "coiPenalty">
): number {
  const activeExclusions = (bid.identifiedExclusions || []).reduce(
    (sum, exclusion) => (exclusion.isWaived ? sum : sum + (exclusion.costImpact || 0)),
    0
  );
  const acceptedAlternates = (bid.valueEngineeringAlternates || []).reduce(
    (sum, alternate) => (alternate.isAccepted ? sum + (alternate.costDeduct || 0) : sum),
    0
  );

  return Math.max(
    0,
    bid.baseBidAmount + activeExclusions + (bid.leadTimePenalty || 0) + (bid.coiPenalty || 0) - acceptedAlternates
  );
}

export function getDeceptiveBidIds(bids: Bid[]): Set<string> {
  const lowestLeveledBid = bids.reduce<Bid | null>(
    (lowest, bid) => (!lowest || bid.leveledTotalCost < lowest.leveledTotalCost ? bid : lowest),
    null
  );

  if (!lowestLeveledBid) return new Set<string>();

  return new Set(
    bids
      .filter(
        (bid) =>
          bid._id !== lowestLeveledBid._id &&
          bid.baseBidAmount < lowestLeveledBid.baseBidAmount &&
          bid.leveledTotalCost > lowestLeveledBid.leveledTotalCost
      )
      .map((bid) => bid._id)
  );
}

export interface NormalizationBreakdown {
  exclusions: number;
  leadPenalty: number;
  coiPenalty: number;
  veAccepted: number;
  totalUplift: number;
}

/**
 * Single source of truth for one bid's ADR-0003 normalization components.
 * `totalUplift` is the hidden cost the leveling engine added on top of the base bid
 * (exclusions + lead-time + COI penalties − accepted VE credits).
 */
export function getNormalizationBreakdown(bid: Bid): NormalizationBreakdown {
  const exclusions = (bid.identifiedExclusions || []).reduce(
    (sum, exclusion) => (exclusion.isWaived ? sum : sum + (exclusion.costImpact || 0)),
    0
  );
  const veAccepted = (bid.valueEngineeringAlternates || []).reduce(
    (sum, alternate) => (alternate.isAccepted ? sum + (alternate.costDeduct || 0) : sum),
    0
  );
  const leadPenalty = bid.leadTimePenalty || 0;
  const coiPenalty = bid.coiPenalty || 0;
  return {
    exclusions,
    leadPenalty,
    coiPenalty,
    veAccepted,
    totalUplift: exclusions + leadPenalty + coiPenalty - veAccepted,
  };
}

/** Awarded bid wins; otherwise the lowest leveled bid. */
export function getEffectiveBid(bids: Bid[]): Bid | null {
  if (!bids || bids.length === 0) return null;
  const awarded = bids.find((bid) => bid.isAwarded);
  if (awarded) return awarded;
  return [...bids].sort((a, b) => a.leveledTotalCost - b.leveledTotalCost)[0];
}

/**
 * Bids whose leveled cost is less than half of the package budget are almost
 * always scope omissions, unit errors or a mis-read document. They are flagged
 * for verification rather than blocked, so a GC cannot award one by accident.
 */
export function getSuspiciouslyLowBidIds(bids: Bid[], packageBudget: number): Set<string> {
  if (!Number.isFinite(packageBudget) || packageBudget <= 0) return new Set<string>();
  const threshold = packageBudget * 0.5;
  return new Set(bids.filter((bid) => bid.leveledTotalCost > 0 && bid.leveledTotalCost < threshold).map((bid) => bid._id));
}

export interface ProcurementMetrics {
  totalBudget: number;
  totalLeveledBuyout: number;
  packagesWithBids: number;
  packagesUsingBudget: number;
  variance: number;
  variancePercent: number;
  isSavings: boolean;
  /** What the leveled total is actually made of, so labels can tell the truth. */
  leveledBasis: "bids" | "mixed" | "budget" | "empty";
  /** Full caption for card surfaces. */
  leveledBuyoutCaption: string;
  /** Compact caption for the always-visible KPI strip. */
  leveledBuyoutShort: string;
  /** True only when every package has a real leveled bid (no budget fallbacks). */
  varianceIsLeveled: boolean;
  deceptiveBidIds: string[];
  deceptiveBidsCount: number;
  gapsCaught: number;
  awardedPackages: number;
  totalPackages: number;
  buyoutProgressPercent: number;
}

/**
 * Computed once per project and read by every surface (KPI bar, header stepper,
 * demo tour, contracts register) so headline numbers can never disagree.
 */
export function computeProcurementMetrics(
  project: { estBudget?: number } | null | undefined,
  tradePackages: TradePackage[],
  allBids: Bid[],
  agreements: Agreement[] = []
): ProcurementMetrics {
  const totalBudget = project?.estBudget || 0;
  let totalLeveledBuyout = 0;
  let packagesWithBids = 0;
  let packagesUsingBudget = 0;
  const deceptiveBidIds = new Set<string>();
  let gapsCaught = 0;

  for (const pkg of tradePackages) {
    const pkgBids = allBids.filter((bid) => bid.tradePackageId === pkg._id);
    if (pkgBids.length === 0) {
      totalLeveledBuyout += pkg.budgetEstimate || 0;
      packagesUsingBudget += 1;
      continue;
    }
    packagesWithBids += 1;
    for (const bidId of getDeceptiveBidIds(pkgBids)) deceptiveBidIds.add(bidId);
    const effectiveBid = getEffectiveBid(pkgBids);
    if (effectiveBid) {
      totalLeveledBuyout += effectiveBid.leveledTotalCost;
    }
  }

  // "Gaps caught" is the hidden cost exposed on flagged deceptive bids only,
  // so it reconciles with the highlighted bid card and the audit narrative.
  for (const bidId of deceptiveBidIds) {
    const bid = allBids.find((b) => b._id === bidId);
    if (bid) gapsCaught += getNormalizationBreakdown(bid).totalUplift;
  }

  if (allBids.length === 0 && tradePackages.length === 0) {
    totalLeveledBuyout = totalBudget;
  }

  const variance = totalBudget - totalLeveledBuyout;
  const variancePercent = totalBudget > 0 ? (variance / totalBudget) * 100 : 0;

  // Basis of the leveled total. Claiming "best bid per package" while any package
  // is standing on its budget estimate is a false procurement signal (F2).
  const leveledBasis: ProcurementMetrics["leveledBasis"] =
    tradePackages.length === 0
      ? "empty"
      : packagesUsingBudget === 0
      ? "bids"
      : packagesWithBids === 0
      ? "budget"
      : "mixed";

  const pkgWord = (n: number) => `${n} package${n === 1 ? "" : "s"}`;
  const leveledBuyoutCaption =
    leveledBasis === "bids"
      ? "Best leveled bid per package"
      : leveledBasis === "mixed"
      ? `Best leveled bid where available; ${packagesUsingBudget} of ${tradePackages.length} packages still on budget estimates`
      : leveledBasis === "budget"
      ? `Budget estimates only — no bids received yet (${pkgWord(packagesUsingBudget)} pending)`
      : "Project budget — no trade packages scoped yet";

  const leveledBuyoutShort =
    leveledBasis === "bids"
      ? "best bid per package"
      : leveledBasis === "mixed"
      ? `${packagesUsingBudget}/${tradePackages.length} pkgs on budget estimates`
      : leveledBasis === "budget"
      ? "budget estimates only"
      : "project budget";

  const varianceIsLeveled = leveledBasis === "bids";

  // Award source of truth: a non-superseded subcontract agreement exists,
  // or a bid is explicitly awarded, or the package status says awarded.
  const awardedPkgIds = new Set<string>();
  for (const agreement of agreements) {
    if (agreement.status !== "superseded") awardedPkgIds.add(agreement.tradePackageId);
  }
  for (const bid of allBids) {
    if (bid.isAwarded) awardedPkgIds.add(bid.tradePackageId);
  }
  for (const pkg of tradePackages) {
    if (pkg.status === "awarded") awardedPkgIds.add(pkg._id);
  }
  const awardedPackages = tradePackages.filter((pkg) => awardedPkgIds.has(pkg._id)).length;
  const totalPackages = tradePackages.length;

  return {
    totalBudget,
    totalLeveledBuyout,
    packagesWithBids,
    packagesUsingBudget,
    variance,
    variancePercent,
    isSavings: variance >= 0,
    leveledBasis,
    leveledBuyoutCaption,
    leveledBuyoutShort,
    varianceIsLeveled,
    deceptiveBidIds: [...deceptiveBidIds],
    deceptiveBidsCount: [...deceptiveBidIds].reduce(
      (count, bidId) => count + allBids.filter((bid) => bid._id === bidId).length,
      0
    ),
    gapsCaught,
    awardedPackages,
    totalPackages,
    buyoutProgressPercent: totalPackages > 0 ? (awardedPackages / totalPackages) * 100 : 0,
  };
}