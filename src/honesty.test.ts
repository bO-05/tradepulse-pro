import { expect, test } from "vitest";

/**
 * Claims-integrity regression checks.
 *
 * These assert the source of the user-facing surfaces still tells the truth:
 * no fabricated registry verification, no canned-document download, no
 * "parity / zero cheating" eval framing. If someone reintroduces those strings,
 * this suite fails before the claims reach the deployment.
 */
const componentSources = import.meta.glob("./components/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const libSources = import.meta.glob("./lib/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const convexSources = import.meta.glob("../convex/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function find(pathFragment: string, sources: Record<string, string>): string {
  const key = Object.keys(sources).find((k) => k.endsWith(pathFragment));
  if (!key) throw new Error(`Source not found: ${pathFragment}`);
  return sources[key];
}

test("Discovery never claims registry verification for unverified records", () => {
  const discovery = find("contractorDiscovery.ts", convexSources);
  expect(discovery).not.toContain("835-24");
  expect(discovery).not.toContain("20000 + i * 142");
  expect(discovery).not.toContain("Firecrawl Live Web Discovery");
  expect(discovery).not.toContain("Built-in sample directory");
  expect(discovery).toContain("Unverified — from web search result");
  expect(discovery).toContain("no usable results");

  const view = find("SubcontractorDiscoveryView.tsx", componentSources);
  expect(view).not.toContain("Verified Trades");
  expect(view).not.toContain("Live Web & TDLR Directory Ingest");
  expect(view).toContain("Provenance shown per record");
});

test("File download serves stored bytes and never synthesises documents from the filename", () => {
  const view = find("ProjectFilesView.tsx", componentSources);
  expect(view).not.toContain("getRealDocumentPdfBytes(");
  expect(view).not.toContain("getRealDocumentText(");
  expect(view).not.toContain("100% Real Construction Document Specification");
  expect(view).toContain("resolveStoredFileUrl");

  const helper = find("storedFile.ts", libSources);
  expect(helper).toContain("resolveStoredFileUrl");
});

test("Eval surface is labeled as an extraction/normalization check with a real holdout", () => {
  const diagnostics = find("SponsorDiagnosticsView.tsx", componentSources);
  expect(diagnostics).not.toContain("Zero Cheating");
  expect(diagnostics).not.toContain("PARITY ACHIEVED");
  expect(diagnostics).not.toContain("Chief Estimator Ground-Truth Evaluation Suite");
  expect(diagnostics).toContain("Bid Extraction & ADR-0003 Normalization Check");
  expect(diagnostics).toContain("Holdout");
  expect(diagnostics).toContain("states no total at all");

  const evals = find("evals.ts", convexSources);
  expect(evals).toContain("case-holdout-26-01");
  expect(evals).toContain("isHoldout: true");
  expect(evals).toContain("holdoutMape");
});

test("Sponsor status cards do not overclaim availability or registry verification", () => {
  const diagnostics = find("SponsorDiagnosticsView.tsx", componentSources);
  expect(diagnostics).not.toContain("TDLR & TSBPE");
  expect(diagnostics).not.toContain("Primary LLM Reasoning");
  expect(diagnostics).not.toContain("satisfying 100% of the hackathon judging rubric");
  expect(diagnostics).toContain("Adapter Ready / Key Required");
  expect(diagnostics).toContain("provenance-first");
});

test("Tour narration does not hard-code demo dollar figures or verification claims", () => {
  const tour = find("InvestorDemoTourBar.tsx", componentSources);
  expect(tour).not.toContain("$61k-$96k");
  expect(tour).not.toContain("100% TDLR Validated");
  expect(tour).not.toContain("$1,225,000 Subcontract Sealed");
  // Narrative is built from live context.
  expect(tour).toContain("buildDemoScenes");
  expect(tour).toContain("runnerUpBaseCost");
});

test("Lead-time adjustment copy is not presented as contract liquidated damages", () => {
  const docs = find("realDocuments.ts", convexSources);
  expect(docs).not.toContain("liquidated damages at $6,000/week");
  expect(docs).toContain("LEAD-TIME DELAY ADJUSTMENT");
});

test("Model diagnostics disclose unavailable providers instead of silently grading another one", () => {
  const router = find("llmRouter.ts", convexSources);
  expect(router).toContain("getProviderAvailability");
  expect(router).toContain("No fallback provider was invoked");
  expect(router).toContain("unavailable: true");

  const diagnostics = find("SponsorDiagnosticsView.tsx", componentSources);
  expect(diagnostics).toContain("Adapter ready —");
  expect(diagnostics).toContain("getProviderAvailability");
  // No implied measured throughput hard-coded on the provider cards.
  expect(diagnostics).not.toContain("m.throughput");
  expect(diagnostics).not.toContain("305");
});