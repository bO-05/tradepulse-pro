/**
 * CONV-C 07 (audit-6 check 8 + /llms.txt email claim): doc truth for README.md,
 * docs/audits/DEMO-SCRIPT.md and the live /llms.txt body.
 */
import fs from "node:fs";
import path from "node:path";
import { writeEvidence } from "./lib.mjs";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const lines = (p) => read(p).split(/\r?\n/);

const README = lines("README.md");
const DEMO = lines("docs/audits/DEMO-SCRIPT.md");
const HACK = lines("hackathon.md");

const find = (arr, re) => arr.map((l, i) => ({ line: i + 1, text: l.trim() })).filter((x) => re.test(x.text));

const llmsRes = await fetch("https://brainy-skunk-440.convex.site/llms.txt", { redirect: "follow" });
const llms = await llmsRes.text();
const llmsLines = llms.split(/\r?\n/);

const out = {
  capturedAt: new Date().toISOString(),
  readme: {
    aiA401ContractGeneratorPhrase: find(README, /AIA Document A401 Contract Generator/i),
    authenticAiaPhrase: find(README, /authentic\s+AIA/i),
    a401Mentions: find(README, /A401/i),
    dollar38500: find(README, /38,500/),
    dollar50500: find(README, /50,500/),
    authenticMentions: find(README, /authentic/i),
  },
  demoScript: {
    a401Style: find(DEMO, /A401-style/i),
    a401Any: find(DEMO, /A401/i),
    verifiedLicensingLines: find(DEMO, /verified licensing|TDLR verified|100%/i),
  },
  hackathon: {
    a401Any: find(HACK, /A401/i),
  },
  llms: {
    status: llmsRes.status,
    deliveredClaimLines: find(llmsLines, /deliver|sent\b|emailed|emails dispatch/i),
    agentmailLines: find(llmsLines, /AgentMail/i),
    dispatchLines: find(llmsLines, /dispatch|dipatch/i),
  },
};
// qualification checks
out.readme.dollar38500Qualified = out.readme.dollar38500.every(
  (x) => /VFD/i.test(x.text) && /50,500|total/i.test(x.text)
) && out.readme.dollar50500.some((x) => /38,500/.test(x.text) && /VFD/i.test(x.text));
out.readme.noFalseA401Generator = out.readme.aiA401ContractGeneratorPhrase.length === 0 && out.readme.authenticAiaPhrase.length === 0;
out.demoScriptSaysA401Style = out.demoScript.a401Style.length > 0 && out.demoScript.a401Any.every((x) => /A401-style/i.test(x.text));
out.llmsNoDeliveredEmailClaim = out.llms.deliveredClaimLines.length === 0;

writeEvidence("fix6-conv-c-07-doc-truth.json", out);
console.log(JSON.stringify(out, null, 1));