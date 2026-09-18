import { expect, test } from "vitest";
import { computeProcurementMetrics, getNormalizationBreakdown, getSuspiciouslyLowBidIds } from "./leveling.ts";
import type { Agreement, Bid, TradePackage } from "./types.ts";

const pkg = (id: string, budget: number, status: TradePackage["status"] = "leveling"): TradePackage => ({
  _id: id,
  projectId: "p1",
  csiDivision: "26 00 00",
  tradeName: "Trade",
  budgetEstimate: budget,
  agentMailbox: "x@agentmail.to",
  agentMailboxId: "i1",
  scopeSummary: "",
  mandatoryInclusions: [],
  bidDeadline: "2026-10-31",
  status,
});

const bid = (over: Partial<Bid> & { _id: string; tradePackageId: string; leveledTotalCost: number }): Bid => ({
  contractorId: "c1",
  subcontractorName: "Sub",
  baseBidAmount: over.leveledTotalCost,
  lineItems: [],
  identifiedExclusions: [],
  longLeadEquipmentWeeks: 10,
  leadTimePenalty: 0,
  coiComplianceStatus: "compliant",
  coiPenalty: 0,
  isAwarded: false,
  receivedAt: 0,
  ...over,
});

const agreement = (tradePackageId: string, status: Agreement["status"]): Agreement => ({
  _id: `a-${tradePackageId}`,
  projectId: "p1",
  tradePackageId,
  bidId: "b1",
  contractorId: "c1",
  agreementNumber: "A401-1",
  documentTitle: "AIA A401",
  subcontractorName: "Sub",
  generalContractorName: "GC",
  projectTitle: "P",
  projectLocation: "Austin, TX",
  csiDivision: "26 00 00",
  tradeName: "Trade",
  contractSum: 1_000_000,
  retainagePercent: 10,
  liquidatedDamagesDaily: 1200,
  scopeSummary: "",
  mandatoryInclusions: [],
  status,
  contractText: "",
  createdAt: 0,
});

test("Headline numbers reconcile with the seeded demo data set", () => {
  const packages = [pkg("p26", 1_250_000), pkg("p23", 1_850_000), pkg("p22", 950_000)];
  const bids: Bid[] = [
    bid({ _id: "b1", tradePackageId: "p26", subcontractorName: "Rosendin Electric, Inc.", baseBidAmount: 1_225_000, leveledTotalCost: 1_225_000 }),
    bid({
      _id: "b2",
      tradePackageId: "p26",
      subcontractorName: "Alterman, Inc.",
      baseBidAmount: 1_100_000,
      leveledTotalCost: 1_286_000,
      identifiedExclusions: [
        { description: "Crane hoisting", costImpact: 45_000, severity: "critical" },
        { description: "Firestop", costImpact: 22_000, severity: "critical" },
        { description: "Seismic", costImpact: 55_000, severity: "critical" },
        { description: "Overtime", costImpact: 25_000, severity: "moderate" },
      ],
      leadTimePenalty: 24_000,
      coiPenalty: 15_000,
      coiComplianceStatus: "deficiency_detected",
      longLeadEquipmentWeeks: 16,
    }),
    bid({ _id: "b3", tradePackageId: "p23", subcontractorName: "TDIndustries, Inc.", leveledTotalCost: 1_820_000 }),
    bid({
      _id: "b4",
      tradePackageId: "p23",
      subcontractorName: "The Brandt Companies, LLC",
      baseBidAmount: 1_650_000,
      leveledTotalCost: 1_785_000,
      identifiedExclusions: [{ description: "Exclusions", costImpact: 108_000, severity: "critical" }],
      leadTimePenalty: 12_000,
      coiPenalty: 15_000,
      coiComplianceStatus: "deficiency_detected",
    }),
    bid({ _id: "b5", tradePackageId: "p22", subcontractorName: "Clarke Kent Plumbing", leveledTotalCost: 935_000 }),
    bid({
      _id: "b6",
      tradePackageId: "p22",
      subcontractorName: "Limbach Facility Services LLC",
      baseBidAmount: 820_000,
      leveledTotalCost: 908_500,
      identifiedExclusions: [{ description: "Exclusions", costImpact: 61_500, severity: "critical" }],
      leadTimePenalty: 12_000,
      coiPenalty: 15_000,
      coiComplianceStatus: "deficiency_detected",
    }),
  ];
  const agreements = [agreement("p26", "generated")];
  const metrics = computeProcurementMetrics({ estBudget: 4_250_000 }, packages, bids, agreements);

  expect(metrics.totalBudget).toBe(4_250_000);
  expect(metrics.totalLeveledBuyout).toBe(3_918_500);
  expect(metrics.variance).toBe(331_500);
  expect(metrics.deceptiveBidsCount).toBe(1);
  // "Hidden gaps exposed" reconciles with the flagged Alterman card components:
  // 147,000 exclusions + 24,000 lead + 15,000 COI = 186,000.
  expect(metrics.gapsCaught).toBe(186_000);
  expect(getNormalizationBreakdown(bids[1]).totalUplift).toBe(186_000);
  // Award count comes from the agreement, so KPI and stepper cannot disagree.
  expect(metrics.awardedPackages).toBe(1);
  expect(metrics.totalPackages).toBe(3);
  // Every package has a real bid, so the leveled total is bid-based (F2).
  expect(metrics.leveledBasis).toBe("bids");
  expect(metrics.varianceIsLeveled).toBe(true);
  expect(metrics.leveledBuyoutCaption).toBe("Best leveled bid per package");
  expect(metrics.leveledBuyoutShort).toBe("best bid per package");
});

test("Superseded agreements do not count as awards", () => {
  const packages = [pkg("p26", 1_000_000, "leveling")];
  const bids = [bid({ _id: "b1", tradePackageId: "p26", leveledTotalCost: 900_000 })];
  const metrics = computeProcurementMetrics({ estBudget: 1_000_000 }, packages, bids, [agreement("p26", "superseded")]);
  expect(metrics.awardedPackages).toBe(0);
});

test("Packages without bids use their budget estimate and expose no gaps", () => {
  const packages = [pkg("p26", 1_000_000, "draft"), pkg("p23", 2_000_000, "draft")];
  const metrics = computeProcurementMetrics({ estBudget: 3_500_000 }, packages, [], []);
  expect(metrics.totalLeveledBuyout).toBe(3_000_000);
  expect(metrics.gapsCaught).toBe(0);
  expect(metrics.packagesUsingBudget).toBe(2);
  expect(metrics.awardedPackages).toBe(0);
  // F2: zero bids means the figure is a budget estimate, never a bid-based buyout.
  expect(metrics.leveledBasis).toBe("budget");
  expect(metrics.varianceIsLeveled).toBe(false);
  expect(metrics.leveledBuyoutCaption).toContain("Budget estimates only");
  expect(metrics.leveledBuyoutCaption).not.toContain("Best leveled bid");
  expect(metrics.leveledBuyoutShort).toBe("budget estimates only");
});

test("F2: a mixed portfolio reports the budget share and never claims all-bid variance", () => {
  const packages = [pkg("p26", 1_000_000, "leveling"), pkg("p23", 2_000_000, "draft")];
  const bids = [bid({ _id: "b1", tradePackageId: "p26", leveledTotalCost: 950_000 })];
  const metrics = computeProcurementMetrics({ estBudget: 3_500_000 }, packages, bids, []);
  expect(metrics.totalLeveledBuyout).toBe(2_950_000);
  expect(metrics.leveledBasis).toBe("mixed");
  expect(metrics.varianceIsLeveled).toBe(false);
  expect(metrics.leveledBuyoutShort).toBe("1/2 pkgs on budget estimates");
  expect(metrics.leveledBuyoutCaption).toContain("still on budget estimates");
});

test("Buyout equals budget when a project has no packages and no bids", () => {
  const metrics = computeProcurementMetrics({ estBudget: 5_500_000 }, [], [], []);
  expect(metrics.totalLeveledBuyout).toBe(5_500_000);
  expect(metrics.variance).toBe(0);
  expect(metrics.leveledBasis).toBe("empty");
  expect(metrics.varianceIsLeveled).toBe(false);
  expect(metrics.leveledBuyoutShort).toBe("project budget");
});

test("Out-of-band low bids are flagged below 50% of the package budget", () => {
  const packages = [pkg("p26", 1_250_000, "leveling")];
  const bids = [
    bid({ _id: "b1", tradePackageId: "p26", baseBidAmount: 1_225_000, leveledTotalCost: 1_225_000 }),
    bid({ _id: "b2", tradePackageId: "p26", baseBidAmount: 250_000, leveledTotalCost: 250_000 }),
  ];
  const flagged = getSuspiciouslyLowBidIds(bids, packages[0].budgetEstimate);
  expect(flagged.has("b2")).toBe(true);
  expect(flagged.has("b1")).toBe(false);
  // No budget or a zero budget cannot flag anything.
  expect(getSuspiciouslyLowBidIds(bids, 0).size).toBe(0);
});