import { Bid } from "./types.ts";

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
