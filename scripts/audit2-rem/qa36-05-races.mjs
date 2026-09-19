/**
 * QA36-05 concurrency races on the clash-keyed identity:
 *  - two concurrent deducts for the SAME clash with different amounts: exactly one applies
 *  - two concurrent reverses: exactly one succeeds
 *  - concurrent deduct + reverse from a clean state: final state must stay invariant-clean
 *  - concurrent deducts for DIFFERENT clashes on the same bid: both apply, no row lost
 *  - concurrent same-clash deducts in two different projects: both apply, each isolated
 */
import {
  client, readEvidence, writeEvidence, writeLog, call, sleep,
  creditInvariants, getBid, creditRows, creditClashId,
  CLASH_VFD, CLASH_DISC, VFD_TITLE, DISC_TITLE,
} from "./qa36-lib.mjs";

const c = client();
const F = readEvidence("fixtures");
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const results = [];
const record = (id, name, pass, detail) => {
  results.push({ id, name, pass: Boolean(pass), detail });
  say(`${pass ? "PASS" : "FAIL"}  ${id} ${name} :: ${JSON.stringify(detail).slice(0, 1500)}`);
};
const rows = (b) => creditRows(b).map((r) => ({ id: creditClashId(r.description), a: r.costDeduct || 0, acc: !!r.isAccepted }));

async function resetClash(cx, projectId, clashId, pkgId) {
  // best-effort: reverse twice (applied then stale)
  for (let i = 0; i < 2; i++) {
    const r = await call(`reset.${clashId}.${i}`, () => cx.mutation("coordination:reverseDoubleBuyCredit", { projectId, clashId, tradePackageId: pkgId }));
    if (!r.ok) break;
    await sleep(250);
  }
}

async function main() {
  const A = F.isoA, B = F.isoB;
  const AB = A.b23.bidId, BB = B.b23.bidId;

  // 1. same-clash concurrent deducts with different amounts
  {
    await resetClash(c, A.id, CLASH_VFD, A.p23);
    const inner = await Promise.allSettled([
      c.mutation("coordination:deductDoubleBuyCredit", { projectId: A.id, clashId: CLASH_VFD, tradePackageId: A.p23, deductAmount: 38500, description: VFD_TITLE }),
      c.mutation("coordination:deductDoubleBuyCredit", { projectId: A.id, clashId: CLASH_VFD, tradePackageId: A.p23, deductAmount: 12000, description: VFD_TITLE }),
    ]);
    const okCount = inner.filter((x) => x.status === "fulfilled").length;
    const failMsgs = inner.filter((x) => x.status === "rejected").map((x) => String(x.reason?.data ?? x.reason?.message ?? x.reason));
    await sleep(400);
    const b = await getBid(c, A.id, AB); const inv = await creditInvariants(c, A.id);
    const applied = inv.acceptedCredits[0];
    record("A36-R01", "two concurrent same-clash deducts (38,500 vs 12,000): exactly one applies; single marker; card==row; invariants clean",
      okCount === 1 && rows(b).length === 1 && inv.clean && applied && applied.amount === (b.leveledTotalCost === 441500 ? 38500 : 12000) &&
        (b.leveledTotalCost === 441500 || b.leveledTotalCost === 468000) && failMsgs.some((m) => /already been applied/.test(m)),
      { okCount, failMsgs, leveled: b.leveledTotalCost, rows: rows(b), summary: inv.summary });
    await resetClash(c, A.id, CLASH_VFD, A.p23);
  }

  // 2. concurrent reverses
  {
    await c.mutation("coordination:deductDoubleBuyCredit", { projectId: A.id, clashId: CLASH_VFD, tradePackageId: A.p23, deductAmount: 38500, description: VFD_TITLE });
    await sleep(300);
    const r = await Promise.allSettled([
      c.mutation("coordination:reverseDoubleBuyCredit", { projectId: A.id, clashId: CLASH_VFD, tradePackageId: A.p23 }),
      c.mutation("coordination:reverseDoubleBuyCredit", { projectId: A.id, clashId: CLASH_VFD, tradePackageId: A.p23 }),
    ]);
    const okCount = r.filter((x) => x.status === "fulfilled").length;
    const failMsgs = r.filter((x) => x.status === "rejected").map((x) => String(x.reason?.data ?? x.reason?.message ?? x.reason));
    await sleep(400);
    const b = await getBid(c, A.id, AB); const inv = await creditInvariants(c, A.id);
    record("A36-R02", "two concurrent reverses: exactly one succeeds; bid exactly 480,000; zero rows; invariants clean",
      okCount === 1 && b.leveledTotalCost === 480000 && rows(b).length === 0 && inv.clean && failMsgs.some((m) => /no applied credit/.test(m)),
      { okCount, failMsgs, leveled: b.leveledTotalCost, summary: inv.summary });
  }

  // 3. concurrent deduct + reverse from a clean state
  {
    await resetClash(c, A.id, CLASH_VFD, A.p23);
    const r = await Promise.allSettled([
      c.mutation("coordination:deductDoubleBuyCredit", { projectId: A.id, clashId: CLASH_VFD, tradePackageId: A.p23, deductAmount: 38500, description: VFD_TITLE }),
      c.mutation("coordination:reverseDoubleBuyCredit", { projectId: A.id, clashId: CLASH_VFD, tradePackageId: A.p23 }),
    ]);
    const ded = r[0].status === "fulfilled";
    const rev = r[1].status === "fulfilled";
    await sleep(400);
    const b = await getBid(c, A.id, AB); const inv = await creditInvariants(c, A.id);
    const consistent =
      inv.clean &&
      ((ded && rev) ? b.leveledTotalCost === 480000 && rows(b).length === 0 :
        (ded && !rev) ? b.leveledTotalCost === 441500 && rows(b).length === 1 :
          (!ded && !rev) ? b.leveledTotalCost === 480000 && rows(b).length === 0 : false);
    record("A36-R03", "concurrent deduct+reverse from clean: final state is one of the two legal serializations; invariants clean",
      consistent,
      { ded, rev, leveled: b.leveledTotalCost, rows: rows(b), summary: inv.summary, dedErr: r[0].status === "rejected" ? String(r[0].reason?.data ?? "") : null, revErr: r[1].status === "rejected" ? String(r[1].reason?.data ?? "") : null });
    await resetClash(c, A.id, CLASH_VFD, A.p23);
  }

  // 4. concurrent deducts for DIFFERENT clashes on the same bid
  {
    const r = await Promise.allSettled([
      c.mutation("coordination:deductDoubleBuyCredit", { projectId: A.id, clashId: CLASH_VFD, tradePackageId: A.p23, deductAmount: 38500, description: VFD_TITLE }),
      c.mutation("coordination:deductDoubleBuyCredit", { projectId: A.id, clashId: CLASH_DISC, tradePackageId: A.p23, deductAmount: 12000, description: DISC_TITLE }),
    ]);
    const okCount = r.filter((x) => x.status === "fulfilled").length;
    await sleep(400);
    const b = await getBid(c, A.id, AB); const inv = await creditInvariants(c, A.id);
    record("A36-R04", "two concurrent deducts for VFD and DISC on one bid: both apply (429,500), two distinct markers, invariants clean",
      okCount === 2 && b.leveledTotalCost === 429500 && rows(b).length === 2 && new Set(rows(b).map((x) => x.id)).size === 2 && inv.clean && inv.actualTotal === 50500,
      { okCount, leveled: b.leveledTotalCost, rows: rows(b), summary: inv.summary });
    await resetClash(c, A.id, CLASH_VFD, A.p23);
    await resetClash(c, A.id, CLASH_DISC, A.p23);
  }

  // 5. same-clash concurrent deducts in two projects
  {
    const r = await Promise.allSettled([
      c.mutation("coordination:deductDoubleBuyCredit", { projectId: A.id, clashId: CLASH_VFD, tradePackageId: A.p23, deductAmount: 38500, description: VFD_TITLE }),
      c.mutation("coordination:deductDoubleBuyCredit", { projectId: B.id, clashId: CLASH_VFD, tradePackageId: B.p23, deductAmount: 38500, description: VFD_TITLE }),
    ]);
    const okCount = r.filter((x) => x.status === "fulfilled").length;
    await sleep(400);
    const [ba, bb] = [await getBid(c, A.id, AB), await getBid(c, B.id, BB)];
    const [ia, ib] = await Promise.all([creditInvariants(c, A.id), creditInvariants(c, B.id)]);
    record("A36-R05", "same-clash concurrent deducts in two projects: both apply; each project isolated and clean (480,000 -> 441,500 / 520,000 -> 481,500)",
      okCount === 2 && ba.leveledTotalCost === 441500 && bb.leveledTotalCost === 481500 && ia.clean && ib.clean &&
        ia.acceptedCredits.every((x) => x.pkg === A.p23) && ib.acceptedCredits.every((x) => x.pkg === B.p23),
      { okCount, a: ba.leveledTotalCost, b: bb.leveledTotalCost });
    await resetClash(c, A.id, CLASH_VFD, A.p23);
    await resetClash(c, B.id, CLASH_VFD, B.p23);
  }

  const fails = results.filter((r) => !r.pass);
  writeEvidence("races", { results, summary: { pass: results.length - fails.length, total: results.length } });
  writeLog("races", log);
  console.log(`races: ${results.length - fails.length}/${results.length}`);
}

main().catch((e) => {
  console.error(e);
  writeLog("races-crash", [String(e?.stack ?? e)]);
  process.exit(1);
});