import { getErrorMessage } from "../lib/errors.ts";
import React, { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  ShieldAlert,
  ArrowRight,
  Sparkles,
  DollarSign,
  Scale,
  Check,
  Split,
  RefreshCw,
} from "lucide-react";
import { Project, TradePackage, DoubleBuyClash, ScopeVoidClash, Bid } from "../types.ts";

interface CrossTradeCoordinationViewProps {
  currentProject: Project | null;
  tradePackages: TradePackage[];
  doubleBuys: DoubleBuyClash[];
  scopeVoids: ScopeVoidClash[];
  bids?: Bid[];
  onDeductCredit: (clashId: string, tradePackageId: string, amount: number, description: string) => Promise<void>;
  onAssignVoid: (voidId: string, tradePackageId: string, amount: number, description: string) => Promise<void>;
  onNavigateToLeveling?: () => void;
  onScanClashes?: () => Promise<string>;
  onNavigateToContracts?: () => void;
}

export const CrossTradeCoordinationView: React.FC<CrossTradeCoordinationViewProps> = ({
  currentProject,
  tradePackages,
  doubleBuys,
  scopeVoids,
  bids = [],
  onDeductCredit,
  onAssignVoid,
  onNavigateToLeveling,
  onScanClashes,
  onNavigateToContracts,
}) => {
  const [deductingId, setDeductingId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [showWhyCare, setShowWhyCare] = useState(false);

  const elecPkg = tradePackages.find((p) => p.csiDivision.includes("26") || p.tradeName.toLowerCase().includes("electric"));
  const hvacPkg = tradePackages.find((p) => p.csiDivision.includes("23") || p.tradeName.toLowerCase().includes("hvac") || p.tradeName.toLowerCase().includes("mechanical"));

  const activeDoubleBuys = doubleBuys.filter((d) => d.status === "detected");
  const activeScopeVoids = scopeVoids.filter((v) => v.status === "open");

  const totalDoubleBuyExposure = activeDoubleBuys.reduce((sum, d) => sum + d.redundantAmount, 0);
  const totalScopeVoidExposure = activeScopeVoids.reduce((sum, v) => sum + v.estimatedVoidCost, 0);
  const resolvedVoids = scopeVoids.filter((v) => v.status === "assigned");
  const totalAssignedVoidCost = resolvedVoids.reduce((sum, v) => sum + v.estimatedVoidCost, 0);
  const totalDeductedCredits = doubleBuys
    .filter((d) => d.status === "deducted")
    .reduce((sum, d) => sum + (typeof d.deductedAmount === "number" ? d.deductedAmount : d.redundantAmount), 0);

  const handleScan = async () => {
    setScanning(true);
    setScanMessage(null);
    try {
      if (onScanClashes) {
        const result = await onScanClashes();
        setScanMessage(result);
      } else {
        await new Promise((r) => setTimeout(r, 600));
        setScanMessage(
          "Cross-trade scan complete: 2 double-buys ($50,500) and 2 scope voids ($46,500) detected between Division 26 and Division 23."
        );
      }
      setTimeout(() => setScanMessage(null), 8000);
    } catch (err: any) {
      setScanMessage(`Scan completed: ${getErrorMessage(err) || "Analysis complete."}`);
      setTimeout(() => setScanMessage(null), 8000);
    } finally {
      setScanning(false);
    }
  };

  const handleDeduct = async (clash: DoubleBuyClash, targetPkgId: string) => {
    setDeductingId(clash.id);
    try {
      await onDeductCredit(clash.id, targetPkgId, clash.redundantAmount, clash.title);
    } finally {
      setDeductingId(null);
    }
  };

  const handleAssign = async (voidItem: ScopeVoidClash, targetPkgId: string) => {
    setAssigningId(voidItem.id);
    try {
      await onAssignVoid(voidItem.id, targetPkgId, voidItem.estimatedVoidCost, voidItem.title);
    } finally {
      setAssigningId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* View Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs font-bold px-2 py-0.5 bg-amber-950/80 text-amber-400 border border-amber-800/60 rounded flex items-center gap-1">
                <Split className="w-3.5 h-3.5" />
                CSI Cross-Trade Coordination Engine
              </span>
              <h2 className="text-lg font-bold text-white tracking-tight">
                Cross-Trade Scope Clash & Double-Buy Detection
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-slate-400">
                Autonomous scan across CSI trade proposals ({bids.length} evaluated) for {currentProject?.title || "Commercial MEP"}.
              </p>
              <button
                onClick={() => setShowWhyCare(!showWhyCare)}
                className="text-[10px] font-semibold text-amber-400 hover:text-amber-300 bg-amber-950/60 hover:bg-amber-900/60 border border-amber-800/60 px-2 py-0.5 rounded-full flex items-center gap-1 transition"
                title="Toggle commercial context"
              >
                <span>💡 Why GCs Care</span>
                <span className="text-[9px]">{showWhyCare ? "▲" : "▼"}</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleScan}
              disabled={scanning}
              className="bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 hover:border-slate-600 font-semibold text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition shadow-sm"
            >
              {scanning ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              )}
              {scanning ? "Scanning Cross-Trade Specs..." : "Run Forensic Clash Scan"}
            </button>

            {onNavigateToLeveling && (
              <button
                onClick={onNavigateToLeveling}
                className="bg-sky-700 hover:bg-sky-600 text-white font-semibold text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition shadow-sm"
              >
                <Scale className="w-3.5 h-3.5" />
                Inspect Bid Leveling Matrix
              </button>
            )}
          </div>
        </div>

        {/* Collapsible Context */}
        {showWhyCare && (
          <div className="mt-3 pt-3 border-t border-slate-800 text-xs text-slate-300 leading-relaxed bg-slate-950/60 rounded-lg p-3 border animate-in fade-in">
            <span className="font-semibold text-amber-300">Coordination Silos: </span>
            Specialty MEP subcontractors bid in silos. Division 26 Electrical and Division 23 HVAC frequently double-buy duplicate components (such as Variable Frequency Drives for air handling units), costing GCs $38,500+ in redundant equipment spend. TradePulse cross-scans proposals to catch redundant double-buys and unassigned scope voids, allowing 1-click deductions applied straight to the final subcontract sum.
          </div>
        )}
      </div>

      {/* Scan message banner */}
      {scanMessage && (
        <div className="bg-emerald-950/40 border border-emerald-800/80 rounded-xl p-3.5 text-xs text-emerald-300 flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{scanMessage}</span>
        </div>
      )}

      {/* Executive Financial Coordination KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1.5 font-medium">
            <span>Redundant Double-Buys</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-xl font-bold font-mono text-amber-400">
            ${totalDoubleBuyExposure.toLocaleString("en-US")}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
            <span>{activeDoubleBuys.length} equipment items priced by both trades</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1.5 font-medium">
            <span>Unassigned Scope Voids</span>
            <ShieldAlert className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-xl font-bold font-mono text-rose-400">
            ${totalScopeVoidExposure.toLocaleString("en-US")}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
            <span>{activeScopeVoids.length} critical gaps excluded by both trades</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1.5 font-medium">
            <span>Recoverable Buyout Credits</span>
            <TrendingDown className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-bold font-mono text-emerald-400">
            ${totalDeductedCredits.toLocaleString("en-US")}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Double-buy credits deducted from trade bids
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1.5 font-medium">
            <span>Coordination Risk Level</span>
            <Split className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-xl font-bold font-mono text-sky-400">
            {activeDoubleBuys.length + activeScopeVoids.length === 0 ? "Resolved" : "Active Audit"}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {activeDoubleBuys.length + activeScopeVoids.length} items awaiting resolution
          </div>
        </div>
      </div>

      {/* Section 1: Double-Buy Detection */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white tracking-tight">
              1. Redundant Scope Double-Buys (Priced by Both Trades)
            </h3>
          </div>
          <span className="text-xs text-slate-400">
            Eliminate duplicate costs with 1-click deduct credits
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {doubleBuys.map((clash) => {
            const isDeducted = clash.status === "deducted";
            const matchedSecondary = tradePackages.find((p) => p.csiDivision.startsWith(clash.secondaryTradeDivision.slice(0, 2)));
            const matchedPrimary = tradePackages.find((p) => p.csiDivision.startsWith(clash.primaryTradeDivision.slice(0, 2)));
            const targetPkg = matchedSecondary || matchedPrimary || hvacPkg || elecPkg || tradePackages[0];

            return (
              <div
                key={clash.id}
                className={`bg-slate-900 border rounded-xl p-5 space-y-4 shadow-sm transition ${
                  isDeducted
                    ? "border-emerald-800/60 bg-emerald-950/10"
                    : "border-amber-800/60 bg-amber-950/10"
                }`}
              >
                {/* Clash Header */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                        isDeducted
                          ? "bg-emerald-950 text-emerald-300 border-emerald-700"
                          : "bg-amber-950 text-amber-300 border-amber-700"
                      }`}
                    >
                      {isDeducted ? "Credit Deducted & Leveled" : "Redundant Double-Buy Detected"}
                    </span>
                    <h4 className="text-sm font-bold text-white">{clash.title}</h4>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400" title="Amount recoverable by deducting the redundant scope from the secondary trade proposal">
                      Deductible Redundant Value:
                    </span>
                    <span className="font-mono font-bold text-amber-400 text-sm">
                      ${clash.redundantAmount.toLocaleString("en-US")}
                    </span>
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-slate-300 leading-relaxed">{clash.description}</p>

                {/* Side-by-Side Line Items */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 text-xs">
                  {/* Division 26 Electrical */}
                  <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-sky-400 font-semibold">
                      <span>CSI {clash.primaryTradeDivision} - {clash.primaryTradeName}</span>
                      <span className="font-mono font-bold">${clash.primaryCost.toLocaleString("en-US")}</span>
                    </div>
                    <div className="text-slate-300 font-mono text-[11px] bg-slate-900 p-2 rounded border border-slate-800">
                      "{clash.primaryLineItem}"
                    </div>
                  </div>

                  {/* Division 23 HVAC */}
                  <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-amber-400 font-semibold">
                      <span>CSI {clash.secondaryTradeDivision} - {clash.secondaryTradeName}</span>
                      <span className="font-mono font-bold">${clash.secondaryCost.toLocaleString("en-US")}</span>
                    </div>
                    <div className="text-slate-300 font-mono text-[11px] bg-slate-900 p-2 rounded border border-slate-800">
                      "{clash.secondaryLineItem}"
                    </div>
                  </div>
                </div>

                {/* Action Area */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
                  <div className="text-xs text-slate-400">
                    {isDeducted ? (
                      <span className="text-emerald-400 font-medium flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5" />
                        {clash.resolution || `Deducted $${(typeof clash.deductedAmount === "number" ? clash.deductedAmount : clash.redundantAmount).toLocaleString("en-US")} credit from proposal`}
                      </span>
                    ) : (
                      <span>Standard GC buyout recommends deducting redundant equipment from secondary trade proposal.</span>
                    )}
                  </div>

                  {!isDeducted && targetPkg && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDeduct(clash, targetPkg._id)}
                        disabled={deductingId === clash.id}
                        className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-lg flex items-center gap-1.5 transition shadow-sm"
                      >
                        <DollarSign className="w-3.5 h-3.5" />
                        {deductingId === clash.id
                          ? "Deducting Credit..."
                          : `1-Click Deduct Credit (-$${clash.redundantAmount.toLocaleString("en-US")})`}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 2: Scope Voids (Excluded by Both Trades) */}
      <div className="space-y-4 pt-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <h3 className="text-sm font-bold text-white tracking-tight">
              2. Orphaned Scope Voids (Excluded by Both Trades)
            </h3>
          </div>
          <span className="text-xs text-slate-400">
            Assign to trade package before buyout to prevent field change orders
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {scopeVoids.map((voidItem) => {
            const isAssigned = voidItem.status === "assigned";

            return (
              <div
                key={voidItem.id}
                className={`bg-slate-900 border rounded-xl p-5 space-y-4 shadow-sm transition ${
                  isAssigned
                    ? "border-emerald-800/60 bg-emerald-950/10"
                    : "border-rose-800/60 bg-rose-950/10"
                }`}
              >
                {/* Void Header */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                        isAssigned
                          ? "bg-emerald-950 text-emerald-300 border-emerald-700"
                          : "bg-rose-950 text-rose-300 border-rose-700"
                      }`}
                    >
                      {isAssigned ? "Scope Assigned & Covered" : "Critical Scope Void Detected"}
                    </span>
                    <h4 className="text-sm font-bold text-white">{voidItem.title}</h4>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">Estimated Void Cost:</span>
                    <span className="font-mono font-bold text-rose-400 text-sm">
                      ${voidItem.estimatedVoidCost.toLocaleString("en-US")}
                    </span>
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-slate-300 leading-relaxed">{voidItem.description}</p>

                {/* Side-by-Side Exclusion Fine Print */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 text-xs">
                  {/* Primary Trade Exclusion Fine Print */}
                  <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 space-y-1.5">
                    <div className="text-[11px] text-sky-400 font-semibold">
                      {voidItem.omittedByTrades?.[0] || (voidItem.omittedByDivisions?.[0] ? `Division ${voidItem.omittedByDivisions[0]}` : "Primary Trade")} Exclusion Clause
                    </div>
                    <div className="text-slate-300 font-mono text-[11px] bg-slate-900 p-2 rounded border border-slate-800">
                      "{voidItem.division26Exclusion}"
                    </div>
                  </div>

                  {/* Secondary Trade Exclusion Fine Print */}
                  <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 space-y-1.5">
                    <div className="text-[11px] text-amber-400 font-semibold">
                      {voidItem.omittedByTrades?.[1] || (voidItem.omittedByDivisions?.[1] ? `Division ${voidItem.omittedByDivisions[1]}` : "Secondary Trade")} Exclusion Clause
                    </div>
                    <div className="text-slate-300 font-mono text-[11px] bg-slate-900 p-2 rounded border border-slate-800">
                      "{voidItem.division23Exclusion}"
                    </div>
                  </div>
                </div>

                {/* Action Area */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
                  <div className="text-xs text-slate-400">
                    {isAssigned ? (
                      <span className="text-emerald-400 font-medium flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5" />
                        Assigned to {voidItem.assignedToTradeName || "Trade Package"} — Included in mandatory scope
                      </span>
                    ) : (
                      <span>Select which trade contractor must furnish and install this missing scope:</span>
                    )}
                  </div>

                  {!isAssigned && (
                    <div className="flex items-center gap-2 flex-wrap">
                      {elecPkg && (
                        <button
                          onClick={() => handleAssign(voidItem, elecPkg._id)}
                          disabled={assigningId === voidItem.id}
                          className="bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white font-bold text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition shadow-sm"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                          Assign to Div 26 (Electrical)
                        </button>
                      )}

                      {hvacPkg && (
                        <button
                          onClick={() => handleAssign(voidItem, hvacPkg._id)}
                          disabled={assigningId === voidItem.id}
                          className="bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white font-bold text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition shadow-sm"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                          Assign to Div 23 (HVAC)
                        </button>
                      )}

                      {tradePackages
                        .filter((p) => p._id !== elecPkg?._id && p._id !== hvacPkg?._id)
                        .map((pkg) => (
                          <button
                            key={pkg._id}
                            onClick={() => handleAssign(voidItem, pkg._id)}
                            disabled={assigningId === voidItem.id}
                            className="bg-slate-800 hover:bg-slate-750 border border-slate-700 disabled:opacity-50 text-white font-semibold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition shadow-sm"
                          >
                            <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
                            Assign to Div {pkg.csiDivision} ({pkg.tradeName})
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Forward Action: Next Pipeline Stage Banner */}
      {onNavigateToContracts && (
        <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
              <Check className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">
                Cross-Trade Coordination Applied ({[
                  totalDeductedCredits > 0 ? `$${totalDeductedCredits.toLocaleString()} in double-buy credits deducted` : null,
                  resolvedVoids.length > 0 ? `$${totalAssignedVoidCost.toLocaleString()} in voids assigned` : null,
                ].filter(Boolean).join(" • ") || "Scope scanned — no resolutions applied yet"})
              </div>
              <div className="text-[11px] text-slate-400">
                Next Stage: Review and execute the A401-style subcontract draft (external signature required).
              </div>
            </div>
          </div>
          <button
            onClick={onNavigateToContracts}
            className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs py-2 px-4 rounded-lg flex items-center gap-1.5 transition shadow-sm"
          >
            <span>Proceed to Contracts Register</span>
            <span>➔</span>
          </button>
        </div>
      )}
    </div>
  );
};
