import React from "react";
import {
  DollarSign,
  TrendingDown,
  ShieldAlert,
  AlertTriangle,
  Award,
} from "lucide-react";
import { Project, TradePackage, Bid } from "../types.ts";
import { getDeceptiveBidIds } from "../leveling.ts";

interface ExecutiveKpiBarProps {
  currentProject: Project | null;
  tradePackages: TradePackage[];
  allBids: Bid[];
}

export const ExecutiveKpiBar: React.FC<ExecutiveKpiBarProps> = ({
  currentProject,
  tradePackages,
  allBids,
}) => {
  if (!currentProject) return null;

  // 1. Total Project Budget
  const totalBudget = currentProject.estBudget || 0;

  // 2. Package-level best leveled bids and deceptive bid detection
  let totalLeveledBuyout = 0;
  let totalExclusionsIdentified = 0;
  const deceptiveBidIds = new Set<string>();

  tradePackages.forEach((pkg) => {
    const pkgBids = allBids.filter((b) => b.tradePackageId === pkg._id);
    if (pkgBids.length > 0) {
      for (const bidId of getDeceptiveBidIds(pkgBids)) deceptiveBidIds.add(bidId);
      // Use the awarded bid when present; otherwise use the current lowest leveled bid.
      const sortedByLeveled = [...pkgBids].sort((a, b) => a.leveledTotalCost - b.leveledTotalCost);
      const lowestLeveled = sortedByLeveled[0];

      // If awarded, use awarded bid; else best leveled
      const awardedBid = pkgBids.find((b) => b.isAwarded);
      const effectiveBid = awardedBid || lowestLeveled;
      totalLeveledBuyout += effectiveBid.leveledTotalCost;
      (effectiveBid.identifiedExclusions || []).forEach((exc) => {
        if (!exc.isWaived) {
          totalExclusionsIdentified += exc.costImpact || 0;
        }
      });
    } else {
      totalLeveledBuyout += pkg.budgetEstimate;
    }
  });

  // If no package bids and no trade packages exist, estimate buyout equals project budget
  if (allBids.length === 0 && tradePackages.length === 0) {
    totalLeveledBuyout = totalBudget;
  }

  // 3. Procurement Savings
  const variance = totalBudget - totalLeveledBuyout;
  const variancePercent = totalBudget > 0 ? (variance / totalBudget) * 100 : 0;
  const isSavings = variance >= 0;

  // 4. Packages awarded
  const awardedPackages = tradePackages.filter((p) => p.status === "awarded").length;
  const totalPackages = tradePackages.length;
  const deceptiveBidsCount = tradePackages.reduce(
    (count, pkg) => count + allBids.filter((bid) => bid.tradePackageId === pkg._id && deceptiveBidIds.has(bid._id)).length,
    0
  );

  const [isCompact, setIsCompact] = React.useState(true);

  if (isCompact) {
    return (
      <div className="bg-slate-900/95 border border-slate-800 rounded-xl px-4 lg:px-5 py-1.5 shadow-sm transition-all">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold hidden sm:inline">
              Baseline:
            </span>
            <span className="text-slate-300 font-medium">
              Budget: <strong className="font-mono text-white font-bold">${totalBudget.toLocaleString()}</strong>
            </span>
            <span className="text-slate-700 hidden sm:inline">•</span>
            <span className="text-slate-300 font-medium">
              Leveled Buyout: <strong className={`font-mono font-bold ${isSavings ? "text-emerald-400" : "text-rose-400"}`}>${totalLeveledBuyout.toLocaleString()}</strong>
              <span className="text-[10px] font-mono text-slate-400 ml-1">(Normalized)</span>
            </span>
            <span className="text-slate-700 hidden sm:inline">•</span>
            <span className="text-slate-300 font-medium">
              Variance: <strong className={`font-mono font-bold ${isSavings ? "text-emerald-400" : "text-rose-400"}`}>{isSavings ? `+$${variance.toLocaleString()}` : `-$${Math.abs(variance).toLocaleString()}`}</strong>
              <span className={`text-[10px] font-mono ml-1 font-bold ${isSavings ? "text-emerald-400" : "text-rose-400"}`}>
                ({variancePercent.toFixed(1)}%)
              </span>
            </span>
            {deceptiveBidsCount > 0 && (
              <>
                <span className="text-slate-700 hidden md:inline">•</span>
                <span className="bg-amber-950/80 text-amber-300 border border-amber-800/80 px-2 py-0.5 rounded-full font-semibold text-[10px] flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                  <span>{deceptiveBidsCount} Deceptive Bid Caught</span>
                </span>
              </>
            )}
            {totalExclusionsIdentified > 0 && (
              <>
                <span className="text-slate-700 hidden lg:inline">•</span>
                <span className="bg-sky-950/80 text-sky-300 border border-sky-800/80 px-2 py-0.5 rounded-full font-semibold text-[10px] flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3 text-sky-400" />
                  <span>Gaps Plugged: +${totalExclusionsIdentified.toLocaleString()}</span>
                </span>
              </>
            )}
            <span className="text-slate-700 hidden xl:inline">•</span>
            <span className="text-slate-400 font-medium hidden xl:inline text-[11px]">
              Buyout: <strong className="font-mono text-white">{awardedPackages}/{totalPackages || 3} Awarded</strong>
            </span>
          </div>

          <button
            onClick={() => setIsCompact(false)}
            className="text-[11px] font-semibold text-slate-400 hover:text-emerald-400 flex items-center gap-1 transition px-2 py-0.5 rounded hover:bg-slate-800"
            title="Expand into full 6-card financial dashboard"
          >
            <span>Expand 6-Card KPI View</span>
            <span className="text-[10px]">▼</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/90 border border-slate-800/90 rounded-xl px-4 lg:px-6 py-2.5 shadow-md transition-all">
      <div className="max-w-7xl mx-auto mb-1.5 flex items-center justify-between text-xs text-slate-500">
        <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
          Commercial Procurement Financial Baseline • ADR-0003 Normalized
        </span>
        <button
          onClick={() => setIsCompact(true)}
          className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 transition"
        >
          <span>Compact Mode</span>
          <span className="text-[10px]">▲</span>
        </button>
      </div>
      <div className="max-w-7xl mx-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {/* KPI 1: Total Project Budget */}
        <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] uppercase tracking-wider font-semibold">Total Budget</span>
            <DollarSign className="w-3.5 h-3.5 text-slate-500" />
          </div>
          <div>
            <div className="text-base sm:text-lg font-black font-mono text-white">
              ${totalBudget.toLocaleString()}
            </div>
            <div className="text-[10px] text-slate-500 font-medium truncate">
              {currentProject.title}
            </div>
          </div>
        </div>

        {/* KPI 2: Leveled Buyout Forecast */}
        <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] uppercase tracking-wider font-semibold">Leveled Buyout</span>
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${isSavings ? "bg-emerald-950 text-emerald-400 border-emerald-800/60" : "bg-rose-950 text-rose-400 border-rose-800/60"}`}>
              ADR-0003
            </span>
          </div>
          <div>
            <div className={`text-base sm:text-lg font-black font-mono ${isSavings ? "text-emerald-400" : "text-rose-400"}`}>
              ${totalLeveledBuyout.toLocaleString()}
            </div>
            <div className="text-[10px] text-slate-400 font-medium">
              Normalized baseline total
            </div>
          </div>
        </div>

        {/* KPI 3: Buyout Savings / Variance */}
        <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] uppercase tracking-wider font-semibold">Variance vs Budget</span>
            <TrendingDown className={`w-3.5 h-3.5 ${isSavings ? "text-emerald-400" : "text-rose-400"}`} />
          </div>
          <div>
            <div className={`text-base sm:text-lg font-black font-mono ${isSavings ? "text-emerald-400" : "text-rose-400"}`}>
              {isSavings ? `+$${variance.toLocaleString()}` : `-$${Math.abs(variance).toLocaleString()}`}
            </div>
            <div className={`text-[10px] font-semibold ${isSavings ? "text-emerald-400" : "text-rose-400"}`}>
              {isSavings ? `Savings: ${variancePercent.toFixed(1)}%` : `Over Budget: ${Math.abs(variancePercent).toFixed(1)}%`}
            </div>
          </div>
        </div>

        {/* KPI 4: Deceptive Low Bids Thwarted */}
        <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] uppercase tracking-wider font-semibold">Deceptive Bids Flagged</span>
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div>
            <div className="text-base sm:text-lg font-black font-mono text-amber-300 flex items-center gap-1.5">
              {deceptiveBidsCount} <span className="text-xs font-normal text-slate-400">proposals</span>
            </div>
            <div className="text-[10px] text-amber-400/80 font-medium">
              Hidden cost creep exposed
            </div>
          </div>
        </div>

        {/* KPI 5: Scope Exclusions Normalized */}
        <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] uppercase tracking-wider font-semibold">Scope Gaps Caught</span>
            <ShieldAlert className="w-3.5 h-3.5 text-sky-400" />
          </div>
          <div>
            <div className="text-base sm:text-lg font-black font-mono text-sky-300">
              +${totalExclusionsIdentified.toLocaleString()}
            </div>
            <div className="text-[10px] text-slate-400 font-medium">
              Priced into normalization
            </div>
          </div>
        </div>

        {/* KPI 6: Subcontract Buyout Progress */}
        <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] uppercase tracking-wider font-semibold">Buyout Progress</span>
            <Award className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div>
            <div className="text-base sm:text-lg font-black font-mono text-white flex items-center gap-1.5">
              {awardedPackages} <span className="text-slate-500 font-normal text-xs">of</span> {totalPackages || 3}
            </div>
            <div className="w-full bg-slate-800 h-1.5 rounded-full mt-1.5 overflow-hidden">
              <div
                className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                style={{
                  width: `${totalPackages > 0 ? (awardedPackages / totalPackages) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
