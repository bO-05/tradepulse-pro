import React, { useState, useEffect } from "react";
import {
  Sparkles,
  ChevronRight,
  ChevronLeft,
  X,
  Play,
  Tv,
  Minimize2,
  Maximize2,
  Volume2,
  Zap,
} from "lucide-react";

export interface DemoScene {
  id: string;
  tabId: string;
  stepNumber: string;
  title: string;
  category: string;
  problemStatement: string;
  talkTrack: string;
  keyMetric: string;
  actionLabel: string;
  actionDescription: string;
}

export const DEMO_SCENES: DemoScene[] = [
  {
    id: "scoping",
    tabId: "packages",
    stepNumber: "01",
    category: "CSI MasterFormat Scoping",
    title: "The $186k Scope Exclusion Trap & Automated Scoping",
    problemStatement:
      "Commercial GCs lose an average of $186,000 on MEP buyout due to fine-print scope exclusions and trade overlaps hidden in architectural specs.",
    talkTrack:
      "\"Welcome to TradePulse Pro. Commercial General Contractors frequently get burned by deceptive low bids. TradePulse automatically parses complex CSI specifications into Division 26 Electrical, 23 HVAC, and 22 Plumbing packages—each with dedicated programmatic @agentmail.to inboxes for trade communication.\"",
    keyMetric: "3 CSI Trade Packages • Dedicated AgentMail Inboxes",
    actionLabel: "Advance to Contractor Sourcing",
    actionDescription: "Inspects scoped packages and transitions to autonomous subcontractor discovery.",
  },
  {
    id: "discovery",
    tabId: "discovery",
    stepNumber: "02",
    category: "Autonomous Discovery",
    title: "Autonomous Specialty Contractor Discovery (Firecrawl)",
    problemStatement:
      "Vetting specialty MEP subcontractors manually across state licensing boards takes days of tedious verification.",
    talkTrack:
      "\"Using Firecrawl, TradePulse Pro autonomously crawls Texas TDLR state licensing registries and regional web directories. It extracts active master licenses, safety compliance ratings, and verified contact emails directly into Convex.\"",
    keyMetric: "4 Verified Specialty Contractors • 100% TDLR Validated",
    actionLabel: "Advance to Pre-Bid Q&A",
    actionDescription: "Reviews verified contractors and moves to incoming pre-bid inquiries.",
  },
  {
    id: "qna",
    tabId: "qna",
    stepNumber: "03",
    category: "Dynamic Pre-Bid Q&A",
    title: "AI Technical Clarifications & CSI Addendum Issuance",
    problemStatement:
      "Uncoordinated verbal answers to bidder inquiries lead to $300,000+ in post-award delay and dispute claims.",
    talkTrack:
      "\"Subcontractors email technical questions to the package inbox. Our spec-grounded AI analyzes the inquiry against project specifications, drafts an accurate citation, and flags edge cases for PM review. Once approved, it compiles a legally binding CSI Addendum No. 01 stored in Convex File Storage.\"",
    keyMetric: "Spec-Grounded Citations • Binding CSI Addendum No. 01",
    actionLabel: "Advance to Forensic Leveling",
    actionDescription: "Moves to the core bid leveling engine to compare incoming subcontractor proposals.",
  },
  {
    id: "leveling",
    tabId: "leveling",
    stepNumber: "04",
    category: "Forensic Bid Leveling",
    title: "ADR-0003 Normalization & Deceptive Low Bid Flagging",
    problemStatement:
      "Alterman bids $1,100,000 vs Rosendin's $1,225,000—appearing $125,000 cheaper on paper while hiding critical crane hoisting, UL firestopping, and seismic exclusions.",
    talkTrack:
      "\"Here is the heart of TradePulse Pro. Alterman appears to be the lowest bidder at $1.10M. But our ADR-0003 Forensic Leveling Engine parses the fine print, uncovering $147,000 in excluded crane hoisting, UL firestopping, and seismic bracing. Alterman's true leveled cost is $1.286M—making Rosendin Electric $61,000 cheaper!\"",
    keyMetric: "$61k-$96k Net GC Savings • Deceptive Low Bid Caught",
    actionLabel: "Advance to Scope Clash Engine",
    actionDescription: "Awards the compliant winner and proceeds to cross-trade coordination.",
  },
  {
    id: "coordination",
    tabId: "coordination",
    stepNumber: "05",
    category: "Cross-Trade Coordination",
    title: "Cross-Trade Scope Clash & Double-Buy Deductions",
    problemStatement:
      "Division 26 Electrical and Division 23 HVAC both price the same equipment (VFDs), resulting in redundant spend.",
    talkTrack:
      "\"Trades don't talk to each other. Both Electrical and HVAC priced Variable Frequency Drives for mechanical fans. TradePulse Pro's clash engine detects this $38,500 double-buy and allows the GC to deduct it with 1 click, transferring the credit straight into buyout savings.\"",
    keyMetric: "$38,500 Double-Buy Deducted • Zero Redundant Spend",
    actionLabel: "Advance to Subcontract Execution",
    actionDescription: "Transitions to the Contracts Register to inspect the generated AIA A401 agreement.",
  },
  {
    id: "contracts",
    tabId: "contracts",
    stepNumber: "06",
    category: "Subcontract Buyout",
    title: "Instant AIA Document A401™ Subcontract Agreement",
    problemStatement:
      "Manual subcontract drafting causes 2 to 3 weeks of administrative lag, risking site mobilization delays.",
    talkTrack:
      "\"With the winner leveled and clashes resolved, TradePulse instantly drafts an authentic 10-article AIA Document A401 Subcontract Agreement. It incorporates all mandatory inclusions, retainage terms, and liquidated damages, ready for digital signature and instant PDF/text export.\"",
    keyMetric: "100% AIA A401 Compliance • $1,225,000 Subcontract Sealed",
    actionLabel: "Complete Tour & View Audit Trail",
    actionDescription: "Inspects executed subcontract and reviews the immutable causal audit log.",
  },
];

interface InvestorDemoTourBarProps {
  activeTab: string;
  onSelectTab: (tabId: string) => void;
  onClose: () => void;
  onExecuteSceneAction?: (sceneId: string) => Promise<void>;
  onOpenSimulationModal?: () => void;
}

export const InvestorDemoTourBar: React.FC<InvestorDemoTourBarProps> = ({
  activeTab,
  onSelectTab,
  onClose,
  onExecuteSceneAction,
  onOpenSimulationModal,
}) => {
  const [currentSceneIndex, setCurrentSceneIndex] = useState<number>(() => {
    const idx = DEMO_SCENES.findIndex((s) => s.tabId === activeTab);
    return idx >= 0 ? idx : 0;
  });
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [isExecutingAction, setIsExecutingAction] = useState<boolean>(false);
  const [showScriptModal, setShowScriptModal] = useState<boolean>(false);

  useEffect(() => {
    const idx = DEMO_SCENES.findIndex((s) => s.tabId === activeTab);
    if (idx >= 0 && idx !== currentSceneIndex) {
      setCurrentSceneIndex(idx);
    }
  }, [activeTab, currentSceneIndex]);

  const scene = DEMO_SCENES[currentSceneIndex];

  const handleGoToScene = (index: number) => {
    if (index >= 0 && index < DEMO_SCENES.length) {
      setCurrentSceneIndex(index);
      onSelectTab(DEMO_SCENES[index].tabId);
    }
  };

  const handleNext = () => {
    if (currentSceneIndex < DEMO_SCENES.length - 1) {
      handleGoToScene(currentSceneIndex + 1);
    } else {
      onSelectTab("audit");
    }
  };

  const handlePrev = () => {
    if (currentSceneIndex > 0) {
      handleGoToScene(currentSceneIndex - 1);
    }
  };

  const handleRunSceneAction = async () => {
    setIsExecutingAction(true);
    try {
      if (onExecuteSceneAction) {
        await onExecuteSceneAction(scene.id);
      } else {
        handleNext();
      }
    } finally {
      setIsExecutingAction(false);
    }
  };

  const isTourCompleted = activeTab === "audit" || activeTab === "diagnostics";

  if (isTourCompleted) {
    return (
      <div className="bg-gradient-to-r from-emerald-950/70 via-slate-900 to-emerald-950/70 border-b border-emerald-500/40 shadow-xl relative z-30 transition-all duration-200">
        <div className="px-4 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400">
              <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-bold text-white tracking-wide">
                  🎉 Investor Demo Tour Complete • All 6 Procurement Lifecycle Stages Executed
                </h4>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full font-mono font-bold">
                  Complete
                </span>
              </div>
              <p className="text-[11px] text-slate-300 mt-0.5">
                CSI Scoping ➔ Contractor Discovery ➔ AI Pre-Bid Addenda ➔ ADR-0003 Leveling ➔ Scope Clash Deduction ➔ AIA A401 Subcontract.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleGoToScene(0)}
              className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs py-1.5 px-3 rounded-lg flex items-center gap-1.5 shadow transition"
              title="Restart Demo Tour from Scene 01"
            >
              <span>🔄 Restart Demo Tour</span>
            </button>
            <button
              onClick={onClose}
              className="bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white font-medium text-xs py-1.5 px-3 rounded-lg flex items-center gap-1 transition border border-slate-700"
              title="Close Teleprompter"
            >
              <X className="w-3.5 h-3.5" />
              <span>Dismiss</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isMinimized) {
    return (
      <div className="fixed bottom-4 left-4 z-40 animate-in fade-in duration-200">
        <button
          onClick={() => setIsMinimized(false)}
          className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold px-3.5 py-2 rounded-xl flex items-center gap-2 shadow-2xl border border-amber-300/40 text-xs transition"
          title="Expand Investor Demo Teleprompter"
        >
          <Tv className="w-4 h-4 text-slate-950" />
          <span>🎬 Investor Demo Tour ({scene.stepNumber}/06)</span>
          <Maximize2 className="w-3.5 h-3.5 text-slate-950/80" />
        </button>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 border-b border-amber-500/40 shadow-xl relative z-30 transition-all duration-200">
      <div className="px-4 lg:px-8 py-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Left: Scene Tag & Talk Track */}
          <div className="flex-1 min-w-[320px] flex items-center gap-2.5">
            <span className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[11px] font-bold tracking-wide">
              <Tv className="w-3 h-3 text-amber-400 animate-pulse" />
              <span>Scene {scene.stepNumber}/06: <strong className="text-amber-200">{scene.category}</strong></span>
            </span>

            {/* Compact Talk Track Cue - Clickable to Open Full Script */}
            <button
              onClick={() => setShowScriptModal(!showScriptModal)}
              className="flex-1 bg-slate-950/90 hover:bg-slate-900 border border-amber-500/30 hover:border-amber-400/50 rounded-lg px-2.5 py-1 flex items-center gap-2 text-xs text-amber-200 overflow-hidden shadow-inner text-left transition group cursor-pointer"
              title="Click to view full presenter script and talking points"
            >
              <Volume2 className="w-3.5 h-3.5 text-amber-400 shrink-0 group-hover:scale-110 transition" />
              <span className="truncate italic font-medium">
                <strong className="text-amber-300 font-semibold not-italic mr-1">Cue:</strong>
                {scene.talkTrack}
              </span>
              <span className="text-[10px] font-mono text-amber-400/80 shrink-0 hidden md:inline ml-auto bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/40">
                Script 📖
              </span>
            </button>

            <span className="hidden xl:inline-flex shrink-0 text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/50">
              {scene.keyMetric}
            </span>
          </div>

          {/* Right: Step Pills, Action Button & Controls */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Step Pills & Prev Control */}
            <div className="hidden sm:flex items-center gap-0.5 bg-slate-950/80 p-0.5 rounded-lg border border-slate-800">
              <button
                onClick={handlePrev}
                disabled={currentSceneIndex === 0}
                className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30 transition"
                title="Previous Scene"
              >
                <ChevronLeft className="w-3 h-3" />
              </button>
              {DEMO_SCENES.map((s, idx) => (
                <button
                  key={s.id}
                  onClick={() => handleGoToScene(idx)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition ${
                    idx === currentSceneIndex
                      ? "bg-amber-500 text-slate-950 shadow-sm"
                      : "text-slate-400 hover:text-white hover:bg-slate-800"
                  }`}
                  title={`${s.stepNumber}: ${s.title}`}
                >
                  {s.stepNumber}
                </button>
              ))}
            </div>

            {/* Quick Action Button */}
            <button
              onClick={handleRunSceneAction}
              disabled={isExecutingAction}
              className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs py-1.5 px-3 rounded-lg flex items-center gap-1.5 shadow-sm transition active:scale-95"
            >
              <Play className="w-3 h-3 fill-slate-950" />
              <span>{scene.actionLabel}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>

            {onOpenSimulationModal && (
              <button
                onClick={onOpenSimulationModal}
                className="hidden md:flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold transition"
                title="Launch 60-second automated investor simulation"
              >
                <Zap className="w-3 h-3 text-amber-400 fill-amber-400" />
                <span className="text-[11px]">60s Sim</span>
              </button>
            )}

            <button
              onClick={() => setIsMinimized(true)}
              className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition text-xs"
              title="Minimize teleprompter"
            >
              <Minimize2 className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={onClose}
              className="text-slate-400 hover:text-rose-400 p-1 rounded hover:bg-slate-800 transition"
              title="Close Demo Tour"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Presenter Teleprompter Script Drawer */}
      {showScriptModal && (
        <div className="bg-slate-950 border-t border-amber-500/30 px-4 lg:px-8 py-3 text-xs animate-in slide-in-from-top-2 duration-150">
          <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-start justify-between gap-4">
            <div className="space-y-1.5 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded">
                  Scene {scene.stepNumber} Presenter Script
                </span>
                <span className="font-bold text-white text-sm">{scene.title}</span>
              </div>
              <p className="text-slate-400 text-xs leading-relaxed">
                <strong className="text-amber-400">Commercial ICP Pain:</strong> {scene.problemStatement}
              </p>
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-amber-100 italic leading-relaxed text-xs">
                "{scene.talkTrack}"
              </div>
            </div>

            <div className="shrink-0 flex flex-col sm:flex-row md:flex-col gap-2 items-start md:items-end">
              <span className="text-[11px] text-emerald-400 font-mono bg-emerald-950/60 border border-emerald-800/60 px-2 py-1 rounded">
                {scene.keyMetric}
              </span>
              <button
                onClick={() => setShowScriptModal(false)}
                className="text-slate-400 hover:text-white text-xs px-2.5 py-1 rounded border border-slate-800 hover:bg-slate-850"
              >
                Close Script ✕
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
