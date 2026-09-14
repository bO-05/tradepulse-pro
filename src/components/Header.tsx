import React, { useState, useEffect } from "react";
import {
  Building2,
  Layers,
  Search,
  MessageSquareCode,
  Scale,
  Activity,
  Zap,
  Radio,
  Plus,
  ChevronDown,
  Clock,
  ShieldCheck,
  FileCheck,
  Split,
  Trash2,
  Tv,
} from "lucide-react";
import { Project } from "../types.ts";

interface HeaderProps {
  projects?: Project[];
  currentProject: Project | null;
  onSelectProject?: (projectId: string) => void;
  onCreateProject?: (proj: {
    title: string;
    location: string;
    projectType: string;
    estBudget: number;
    targetCompletionWeeks: number;
    specDocumentText: string;
    isDemoProject: boolean;
  }) => Promise<void>;
  onDeleteProject?: (projectId: string) => Promise<void>;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenSimulation: () => void;
  isStandaloneMode?: boolean;
  clashCount?: number;
  isTourOpen?: boolean;
  onToggleTour?: () => void;
  packagesCount?: number;
  contractorsCount?: number;
  conversationsCount?: number;
  bidsCount?: number;
  agreementsCount?: number;
}

export const Header: React.FC<HeaderProps> = ({
  projects = [],
  currentProject,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  activeTab,
  setActiveTab,
  onOpenSimulation,
  isStandaloneMode = false,
  clashCount = 0,
  isTourOpen = false,
  onToggleTour,
  packagesCount = 3,
  contractorsCount = 4,
  conversationsCount = 3,
  bidsCount = 2,
  agreementsCount = 1,
}) => {
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newLocation, setNewLocation] = useState("Austin, TX");
  const [newType, setNewType] = useState("Class-A Commercial Mixed-Use");
  const [newBudget, setNewBudget] = useState(5500000);
  const [newWeeks, setNewWeeks] = useState(52);
  const [newSpec, setNewSpec] = useState("");
  const [creating, setCreating] = useState(false);

  // Keyboard shortcut listener for 1-6 keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input or textarea
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        document.activeElement?.tagName === "SELECT"
      ) {
        return;
      }
      // Don't trigger if modifier keys are pressed (e.g. Ctrl+1 to switch browser tabs)
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      if (e.key === "1") setActiveTab("packages");
      else if (e.key === "2") setActiveTab("discovery");
      else if (e.key === "3") setActiveTab("qna");
      else if (e.key === "4") setActiveTab("leveling");
      else if (e.key === "5") setActiveTab("coordination");
      else if (e.key === "6") setActiveTab("contracts");
      else if (e.key === "7") setActiveTab("audit");
      else if (e.key === "8") setActiveTab("diagnostics");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setActiveTab]);

  const pipelineStages = [
    {
      id: "packages",
      step: "01",
      label: "CSI Scoping",
      sublabel: "MasterFormat",
      icon: Layers,
      badge: `${packagesCount} Pkgs`,
    },
    {
      id: "discovery",
      step: "02",
      label: "Discovery",
      sublabel: "Firecrawl SERP",
      icon: Search,
      badge: `${contractorsCount} Subs`,
    },
    {
      id: "qna",
      step: "03",
      label: "Pre-Bid Q&A",
      sublabel: "AI Addenda",
      icon: MessageSquareCode,
      badge: `${conversationsCount} RFIs`,
    },
    {
      id: "leveling",
      step: "04",
      label: "Bid Leveling",
      sublabel: "ADR-0003",
      icon: Scale,
      badge: `${bidsCount} Bids`,
    },
    {
      id: "coordination",
      step: "05",
      label: "Scope Clash",
      sublabel: "Coordination",
      icon: Split,
      badge: clashCount > 0 ? `${clashCount} Clashes` : "Clear",
      badgeColor: clashCount > 0 ? "bg-amber-950 text-amber-300 border-amber-800" : "bg-emerald-950 text-emerald-400 border-emerald-800",
    },
    {
      id: "contracts",
      step: "06",
      label: "Subcontracts",
      sublabel: "AIA A401",
      icon: FileCheck,
      badge: `${agreementsCount} Award`,
    },
  ];

  const utilityTabs = [
    { id: "audit", label: "Live Activity Audit", icon: Clock },
    { id: "diagnostics", label: "Evals & Architecture", icon: Activity },
  ];

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onCreateProject || !newTitle.trim()) return;
    setCreating(true);
    try {
      await onCreateProject({
        title: newTitle.trim(),
        location: newLocation.trim() || "Austin, TX",
        projectType: newType,
        estBudget: Number(newBudget) > 0 ? Number(newBudget) : 1000000,
        targetCompletionWeeks: Number(newWeeks) > 0 ? Number(newWeeks) : 52,
        specDocumentText: newSpec.trim() || `Project Scope for ${newTitle.trim()}. Standard CSI MasterFormat commercial obligations.`,
        isDemoProject: false,
      });
      setIsNewProjectModalOpen(false);
      setNewTitle("");
      setNewSpec("");
    } finally {
      setCreating(false);
    }
  };

  return (
    <header className="border-b border-slate-800 bg-slate-900/95 backdrop-blur sticky top-0 z-40 shadow-lg">
      {/* Top Banner with Sponsor Integration Badges & Presentation Mode */}
      <div className="border-b border-slate-800/80 px-4 lg:px-8 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-2 py-0.5 rounded-full">
            <Radio className={`w-3 h-3 text-emerald-400 ${isStandaloneMode ? "" : "animate-pulse"}`} />
            {isStandaloneMode ? "Zero-Cloud Localhost Resilient Mode" : "Convex Reactive WebSockets Active"}
          </span>
          <span className="text-slate-500 hidden sm:inline">•</span>
          <span className="text-slate-400 hidden sm:inline font-mono text-[11px]">
            Convex "All Gas" Hackathon 2026
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden xl:flex items-center gap-1.5 mr-1">
            <span className="text-slate-500 text-[11px]">Sponsors:</span>
            <span className="bg-orange-950/40 text-orange-300 border border-orange-800/40 px-1.5 py-0.5 rounded text-[10px] font-mono">Convex</span>
            <span className="bg-emerald-950/40 text-emerald-300 border border-emerald-800/40 px-1.5 py-0.5 rounded text-[10px] font-mono">OpenAI</span>
            <span className="bg-amber-950/40 text-amber-300 border border-amber-800/40 px-1.5 py-0.5 rounded text-[10px] font-mono">Firecrawl</span>
            <span className="bg-blue-950/40 text-blue-300 border border-blue-800/40 px-1.5 py-0.5 rounded text-[10px] font-mono">AgentMail</span>
          </div>

          {/* Investor Demo Tour Toggle Button */}
          {onToggleTour && (
            <button
              onClick={onToggleTour}
              className={`font-bold px-2.5 py-1 rounded-lg flex items-center gap-1.5 text-xs transition border shadow-sm ${
                isTourOpen
                  ? "bg-amber-400 text-slate-950 border-amber-300 ring-2 ring-amber-400/40"
                  : "bg-slate-800 hover:bg-slate-750 text-amber-300 border-amber-500/40 hover:border-amber-400"
              }`}
              title="Toggle Investor Demo Tour Teleprompter"
            >
              <Tv className="w-3.5 h-3.5" />
              <span>🎬 Demo Tour</span>
            </button>
          )}

          <button
            onClick={onOpenSimulation}
            className="bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-slate-950 font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 shadow-sm text-xs transition"
          >
            <Zap className="w-3 h-3 fill-slate-950" />
            ⚡ 60s Judge Dock
          </button>
        </div>
      </div>

      {/* Main Header Bar */}
      <div className="px-4 lg:px-8 py-2 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shadow-lg shadow-emerald-500/10 border border-emerald-400/30">
            <Building2 className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight flex items-center gap-1.5">
                TradePulse <span className="text-emerald-400">Pro</span>
              </h1>
              <span className="text-[10px] uppercase font-bold tracking-wider bg-slate-800 text-slate-300 border border-slate-700 px-1.5 py-0.5 rounded">
                CSI MasterFormat
              </span>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              Autonomous Subcontractor Procurement, Dynamic Pre-Bid Q&A & Real-Time Bid Leveling
            </p>
          </div>
        </div>

        {/* Project Selector & New Project Button */}
        <div className="flex items-center gap-2">
          {projects.length > 0 && onSelectProject && (
            <div className="relative">
              <select
                value={currentProject?._id ?? ""}
                onChange={(e) => onSelectProject(e.target.value)}
                aria-label="Select Commercial Construction Project"
                className="bg-slate-850 border border-slate-700 hover:border-slate-600 text-slate-200 text-xs rounded-lg pl-3 pr-8 py-1.5 focus:outline-none focus:border-emerald-500 font-medium appearance-none cursor-pointer max-w-[240px] sm:max-w-xs truncate"
              >
                {projects.map((p) => (
                  <option key={p._id} value={p._id} className="bg-slate-900 text-white">
                    {p.title} ({p.location})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
            </div>
          )}

          <button
            onClick={() => setIsNewProjectModalOpen(true)}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-600 text-xs font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition shadow-sm"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            <span>New Project</span>
          </button>

          {currentProject && !currentProject.isDemoProject && onDeleteProject && (
            <button
              onClick={async () => {
                if (window.confirm(`Are you sure you want to delete project "${currentProject.title}"? This will permanently remove all associated trade packages, bids, and contracts.`)) {
                  await onDeleteProject(currentProject._id);
                }
              }}
              className="bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-800/60 text-xs font-semibold px-2 py-1.5 rounded-lg flex items-center gap-1 transition shadow-sm"
              title="Delete custom project"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span className="hidden sm:inline">Delete</span>
            </button>
          )}
        </div>
      </div>

      {/* Procurement Pipeline Stepper & Navigation */}
      <div className="px-4 lg:px-8 flex items-center justify-between border-t border-slate-800/80 bg-slate-950/50 overflow-x-auto no-scrollbar gap-2">
        {/* 6-Stage Pipeline Stepper */}
        <div className="flex items-center gap-1 py-1 shrink-0">
          {pipelineStages.map((stage, idx) => {
            const Icon = stage.icon;
            const isActive = activeTab === stage.id;
            const isCompleted =
              (stage.id === "packages" && packagesCount > 0) ||
              (stage.id === "discovery" && contractorsCount > 0) ||
              (stage.id === "qna" && conversationsCount > 0) ||
              (stage.id === "leveling" && bidsCount > 0) ||
              (stage.id === "coordination" && clashCount === 0 && agreementsCount > 0) ||
              (stage.id === "contracts" && agreementsCount > 0);
            return (
              <React.Fragment key={stage.id}>
                <button
                  onClick={() => setActiveTab(stage.id)}
                  className={`group flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg transition whitespace-nowrap ${
                    isActive
                      ? "bg-slate-800 text-white shadow-sm ring-1 ring-emerald-500/60"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-850/60"
                  }`}
                  title={`${stage.step}: ${stage.label} - ${stage.sublabel} (Press ${idx + 1})`}
                >
                  <span
                    className={`text-[10px] font-mono px-1 py-0.5 rounded font-bold transition flex items-center justify-center min-w-[18px] ${
                      isActive
                        ? "bg-emerald-500 text-slate-950 shadow-sm"
                        : isCompleted
                        ? "bg-emerald-950 text-emerald-400 border border-emerald-800/80"
                        : "bg-slate-800 text-slate-400 group-hover:text-slate-200"
                    }`}
                  >
                    {isCompleted && !isActive ? "✓" : stage.step}
                  </span>
                  <Icon
                    className={`w-3.5 h-3.5 ${isActive ? "text-emerald-400" : isCompleted ? "text-emerald-500/80" : "text-slate-500 group-hover:text-slate-300"}`}
                  />
                  <span className={isActive ? "text-white font-bold" : ""}>{stage.label}</span>

                  {stage.badge && (
                    <span
                      className={`text-[9px] font-mono px-1.5 py-0.5 rounded border font-medium ${
                        stage.badgeColor ||
                        (isActive
                          ? "bg-emerald-950/80 text-emerald-300 border-emerald-700/60"
                          : "bg-slate-900 text-slate-400 border-slate-700/60")
                      }`}
                    >
                      {stage.badge}
                    </span>
                  )}
                </button>

                {idx < pipelineStages.length - 1 && (
                  <span className="text-slate-700 select-none text-xs">›</span>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Secondary Auxiliary Utilities (Audit & Diagnostics) */}
        <div className="flex items-center gap-1 py-1 border-l border-slate-800/80 pl-2 shrink-0">
          {utilityTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition whitespace-nowrap ${
                  isActive
                    ? "bg-slate-800 text-emerald-400 font-semibold ring-1 ring-slate-700"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-850/60"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? "text-emerald-400" : "text-slate-500"}`} />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* New Project Modal */}
      {isNewProjectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-emerald-400" />
                Create New Construction Project
              </h3>
              <button
                onClick={() => setIsNewProjectModalOpen(false)}
                className="text-slate-400 hover:text-white text-xs font-mono"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-400 font-medium mb-1">Project Title</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Austin Innovation Tower - Phase II"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Location</label>
                  <input
                    type="text"
                    required
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    placeholder="e.g. Austin, TX"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Project Type</label>
                  <input
                    type="text"
                    required
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    placeholder="e.g. Healthcare / Mixed-Use"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Estimated Budget ($)</label>
                  <input
                    type="number"
                    required
                    value={newBudget}
                    onChange={(e) => setNewBudget(Number(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Duration (Weeks)</label>
                  <input
                    type="number"
                    required
                    value={newWeeks}
                    onChange={(e) => setNewWeeks(Number(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">Specification Summary</label>
                <textarea
                  rows={3}
                  value={newSpec}
                  onChange={(e) => setNewSpec(e.target.value)}
                  placeholder="Outline high-level trade scopes, design criteria, and mandatory inclusions..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsNewProjectModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-lg transition flex items-center gap-1.5"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {creating ? "Creating Project..." : "Create Commercial Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
};
