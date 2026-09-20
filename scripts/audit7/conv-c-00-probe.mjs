/**
 * CONV-C probe (read-only): locate the demo project, its packages, bids and
 * key derived fields used by the checks. No writes.
 */
import { q, writeEvidence } from "./lib.mjs";

const projects = (await q("projects:listProjects", {})) || [];
const demo = projects.find((p) => /The Domain Tower B/i.test(p.title));
if (!demo) throw new Error("demo project not found: " + JSON.stringify(projects.map((p) => p.title)));

const packages = (await q("tradePackages:listByProject", { projectId: demo._id })) || [];
const [bids, contractors, agreements, conversations] = await Promise.all([
  q("bids:listAllProjectBids", { projectId: demo._id }),
  q("contractors:listByProject", { projectId: demo._id }),
  q("agreements:listAgreements", { projectId: demo._id }),
  Promise.all(packages.map((p) => q("rfq:listConversations", { tradePackageId: p._id }).catch(() => []))).then((x) => x.flat()),
]);

const out = {
  capturedAt: new Date().toISOString(),
  demo: { _id: demo._id, title: demo.title, estBudget: demo.estBudget, isDemoProject: demo.isDemoProject },
  packages: packages.map((p) => ({ _id: p._id, csiDivision: p.csiDivision, tradeName: p.tradeName, budgetEstimate: p.budgetEstimate, status: p.status })),
  contractors: contractors.map((c) => ({ _id: c._id, companyName: c.companyName, tradePackageId: c.tradePackageId, rfqStatus: c.rfqStatus })),
  bids: (bids || []).map((b) => ({
    _id: b._id,
    tradePackageId: b.tradePackageId,
    subcontractorName: b.subcontractorName,
    baseBidAmount: b.baseBidAmount,
    leadTimeTargetWeeks: b.leadTimeTargetWeeks,
    longLeadEquipmentWeeks: b.longLeadEquipmentWeeks,
    leadTimePenalty: b.leadTimePenalty,
    coiPenalty: b.coiPenalty,
    coiComplianceStatus: b.coiComplianceStatus,
    leveledTotalCost: b.leveledTotalCost,
    isAwarded: b.isAwarded,
    exclusions: (b.identifiedExclusions || []).map((e) => ({ description: e.description, costImpact: e.costImpact, isWaived: e.isWaived })),
    alternates: (b.valueEngineeringAlternates || []).map((a) => ({ description: a.description, costDeduct: a.costDeduct, isAccepted: a.isAccepted })),
  })),
  agreements: agreements.map((a) => ({ agreementNumber: a.agreementNumber, subcontractorName: a.subcontractorName, contractSum: a.contractSum, status: a.status, documentTitle: a.documentTitle })),
  conversationCount: conversations.length,
  conversations: conversations.map((c) => ({ _id: c._id, subject: c.subject, status: c.status, tradePackageId: c.tradePackageId })),
};
writeEvidence("fix6-conv-c-00-probe.json", out);
console.log(
  JSON.stringify(
    {
      demo: out.demo,
      packages: out.packages,
      bidCount: out.bids.length,
      bids: out.bids.map((b) => [b.subcontractorName, b.baseBidAmount, b.leadTimeTargetWeeks, b.longLeadEquipmentWeeks, b.leadTimePenalty, b.leveledTotalCost, b.isAwarded]),
      agreements: out.agreements,
    },
    null,
    1
  )
);