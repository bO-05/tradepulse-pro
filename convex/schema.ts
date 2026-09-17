import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Commercial construction project root
  projects: defineTable({
    title: v.string(), // e.g. "The Domain Tower B - Commercial MEP"
    location: v.string(), // "Austin, TX"
    projectType: v.string(), // "Class-A Commercial Mixed-Use"
    estBudget: v.number(),
    targetCompletionWeeks: v.number(),
    specDocumentText: v.string(),
    isDemoProject: v.boolean(), // Allows public read access for judges
    generalContractorName: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_demo", ["isDemoProject"]),

  // CSI MasterFormat Trade Packages
  tradePackages: defineTable({
    projectId: v.id("projects"),
    csiDivision: v.string(), // e.g. "26 00 00"
    tradeName: v.string(), // "Electrical & Lighting Systems"
    budgetEstimate: v.number(),
    agentMailbox: v.string(), // e.g. "austin-elec-rfq@agentmail.to"
    agentMailboxId: v.string(),
    scopeSummary: v.string(),
    mandatoryInclusions: v.array(v.string()), // ["Crane hoisting", "Seismic bracing", "Temporary power"]
    bidDeadline: v.string(),
    status: v.string(), // "draft" | "rfqs_dispatched" | "leveling" | "awarded"
  }).index("by_project", ["projectId"]),

  // Discovered Subcontractors
  contractors: defineTable({
    tradePackageId: v.id("tradePackages"),
    companyName: v.string(),
    contactEmail: v.string(),
    phone: v.optional(v.string()),
    licenseNumber: v.string(),
    licenseStatus: v.string(),
    sourceUrl: v.string(),
    rfqStatus: v.string(), // "discovered" | "invited" | "rfi_submitted" | "bid_received"
    dispatchedAt: v.optional(v.number()),
  }).index("by_package", ["tradePackageId"]),

  // Two-way Pre-Bid RFIs and Clarifications
  conversations: defineTable({
    tradePackageId: v.id("tradePackages"),
    contractorId: v.id("contractors"),
    threadId: v.string(), // Matches AgentMail thread_id
    inboundSubject: v.string(),
    inboundQuestion: v.string(),
    autonomousReply: v.string(),
    confidenceScore: v.number(),
    status: v.string(), // "clarified" | "escalated_to_pm"
    pmCertifiedAt: v.optional(v.number()),
    pmCertifiedBy: v.optional(v.string()),
    reviewNote: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_contractor", ["contractorId"])
    .index("by_thread", ["threadId"])
    .index("by_package", ["tradePackageId"]),

  // Normalized Apples-to-Apples Bid Leveling Records
  bids: defineTable({
    tradePackageId: v.id("tradePackages"),
    contractorId: v.id("contractors"),
    subcontractorName: v.string(),
    baseBidAmount: v.number(),
    lineItems: v.array(
      v.object({
        item: v.string(),
        unit: v.string(),
        quantity: v.number(),
        unitCost: v.number(),
        totalCost: v.number(),
      })
    ),
    identifiedExclusions: v.array(
      v.object({
        canonicalCode: v.optional(v.string()),
        description: v.string(),
        costImpact: v.number(),
        severity: v.string(), // "critical" | "moderate" | "minor"
        isWaived: v.optional(v.boolean()),
      })
    ),
    valueEngineeringAlternates: v.optional(
      v.array(
        v.object({
          description: v.string(),
          costDeduct: v.number(),
          isAccepted: v.boolean(),
        })
      )
    ),
    longLeadEquipmentWeeks: v.number(),
    leadTimePenalty: v.number(),
    coiComplianceStatus: v.string(), // "compliant" | "deficiency_detected"
    coiPenalty: v.number(),
    leveledTotalCost: v.number(), // True normalized cost = base + un-waived scope gaps + penalties - accepted alternates
    isAwarded: v.boolean(),
    sourceFileId: v.optional(v.id("projectFiles")),
    revisionNumber: v.optional(v.number()), // 1 = first submission; increments on re-ingest
    lastRevisedAt: v.optional(v.number()),
    receivedAt: v.number(),
  })
    .index("by_package", ["tradePackageId"])
    .index("by_contractor", ["contractorId"])
    .index("by_source_file", ["sourceFileId"]),

  // Persisted cross-trade clash resolution state (deduct credits / assigned voids)
  clashResolutions: defineTable({
    projectId: v.id("projects"),
    clashId: v.string(),
    kind: v.union(v.literal("double_buy"), v.literal("scope_void")),
    status: v.union(v.literal("deducted"), v.literal("assigned")),
    amount: v.number(),
    note: v.optional(v.string()),
    resolvedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_clash", ["projectId", "clashId"]),

  // AIA Document A401 Subcontract Agreements
  agreements: defineTable({
    projectId: v.id("projects"),
    tradePackageId: v.id("tradePackages"),
    bidId: v.id("bids"),
    contractorId: v.id("contractors"),
    agreementNumber: v.string(), // e.g. "A401-2026-2601"
    documentTitle: v.string(), // "AIA Document A401™ – 2017 Standard Form of Agreement Between Contractor and Subcontractor"
    subcontractorName: v.string(),
    subcontractorEmail: v.optional(v.string()),
    generalContractorName: v.string(),
    projectTitle: v.string(),
    projectLocation: v.string(),
    csiDivision: v.string(),
    tradeName: v.string(),
    contractSum: v.number(),
    retainagePercent: v.number(),
    liquidatedDamagesDaily: v.number(),
    scopeSummary: v.string(),
    mandatoryInclusions: v.array(v.string()),
    status: v.string(), // "generated" | "executed"
    contractText: v.string(),
    executedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_bid", ["bidId"])
    .index("by_package", ["tradePackageId"])
    .index("by_project", ["projectId"]),

  // Convex File Storage (_storage) for drawings, specs, quote PDFs, and COIs
  projectFiles: defineTable({
    projectId: v.id("projects"),
    tradePackageId: v.optional(v.id("tradePackages")),
    storageId: v.string(),
    fileName: v.string(),
    fileType: v.string(), // "blueprint" | "spec" | "quote_pdf" | "coi_certificate" | "addendum"
    fileSize: v.number(),
    uploadedBy: v.string(),
    uploadedAt: v.number(),
    textContent: v.optional(v.string()),
  })
    .index("by_project", ["projectId"])
    .index("by_package", ["tradePackageId"]),

  // Live Reactive Activity Audit Stream
  auditLogs: defineTable({
    projectId: v.id("projects"),
    tradePackageId: v.optional(v.id("tradePackages")),
    eventType: v.string(), // "rfq_dispatched" | "rfi_clarified" | "quote_received" | "bid_leveled" | "contract_awarded" | "file_uploaded" | "compliance_audit" | "cron_executed"
    title: v.string(),
    description: v.string(),
    actor: v.string(),
    timestamp: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_package", ["tradePackageId"])
    .index("by_timestamp", ["timestamp"]),

  // Real-World Chief Estimator Evaluation Runs & Telemetry
  evalRuns: defineTable({
    runId: v.string(), // e.g. "eval_20260912_104500"
    targetEnvironment: v.string(), // "prod" | "dev" | "local"
    triggeredBy: v.string(), // "cli_benchmark" | "judge_diagnostics" | "regression"
    totalCases: v.number(),
    passedCases: v.number(),
    scopeRecallAvg: v.number(),
    scopePrecisionAvg: v.number(),
    leveledCostMape: v.number(),
    veAccuracyAvg: v.number(),
    coiF1Score: v.number(),
    clashRecallAvg: v.number(),
    aiaConformityAvg: v.number(),
    overallScore: v.number(),
    totalDurationMs: v.number(),
    createdAt: v.number(),
  })
    .index("by_runId", ["runId"])
    .index("by_createdAt", ["createdAt"]),

  // Full LLM Prompt/Completion Execution Traces & Comparative Benchmarks
  agentTraces: defineTable({
    runId: v.string(),
    caseId: v.string(),
    csiDivision: v.string(),
    contractorName: v.string(),
    provider: v.string(), // "OpenAI" | "Anthropic" | "Vertex AI / Gemini" | "DeterministicEngine"
    model: v.string(),
    rawPrompt: v.string(),
    systemPrompt: v.optional(v.string()),
    rawResponse: v.string(),
    parsedOutput: v.any(),
    groundTruth: v.any(),
    metrics: v.any(),
    status: v.string(), // "PASS" | "FAIL"
    latencyMs: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    timestamp: v.number(),
  })
    .index("by_runId", ["runId"])
    .index("by_caseId", ["caseId"])
    .index("by_run_and_timestamp", ["runId", "timestamp"])
    .index("by_timestamp", ["timestamp"]),
});
