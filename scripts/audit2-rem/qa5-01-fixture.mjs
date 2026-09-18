import { delay, q, http, openApp, selectPackageCard, selectProject, shot, writeJson, PROJECT_TITLE, CONCRETE, PLUMBING, HVAC } from "./qa5-common.mjs";

const OUT = { startedAt: new Date().toISOString(), steps: [] };
const step = (name, data) => {
  OUT.steps.push({ name, at: new Date().toISOString(), ...data });
  console.log("STEP", name, JSON.stringify(data).slice(0, 500));
};

async function createProject(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("New Project"));
    b?.click();
  });
  await delay(600);
  const fields = {
    "Project title": PROJECT_TITLE,
    "Project location": "Austin, TX",
    "Project type": "Commercial Mixed-Use",
    "General contractor or contracting entity": "QA5 General Contractors, LP",
    "Estimated budget in dollars": "6500000",
    "Target completion duration in weeks": "60",
  };
  for (const [label, value] of Object.entries(fields)) {
    await page.evaluate(
      (lbl, val) => {
        const el = document.querySelector(`[aria-label="${lbl}"]`);
        if (!el) throw new Error("missing field " + lbl);
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
        setter.call(el, val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      },
      label,
      value
    );
  }
  await page.evaluate(() => {
    const ta = [...document.querySelectorAll("textarea")].find((x) =>
      (x.getAttribute("placeholder") || "").includes("Outline high-level trade scopes")
    );
    if (ta) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(ta, "QA5 verification fixture: commercial MEP scope, Divisions 03/22/23.");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await delay(300);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.textContent || "").includes("Create Commercial Project")
    );
    b?.click();
  });
  for (let i = 0; i < 30; i++) {
    await delay(700);
    const projects = await q("projects:listProjects", {});
    const found = projects.find((p) => p.title === PROJECT_TITLE);
    if (found) return found;
  }
  throw new Error("project was not created");
}

async function createPackage(page, spec) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Create Trade Package"));
    b?.click();
  });
  await delay(700);
  await page.evaluate(
    (s) => {
      const setVal = (el, val) => {
        const proto =
          el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLSelectElement.prototype && el.tagName === "SELECT"
            ? HTMLSelectElement.prototype
            : el instanceof HTMLInputElement
            ? HTMLInputElement.prototype
            : HTMLTextAreaElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
        setter.call(el, val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const byLabel = (l) => {
        const el = document.querySelector(`[aria-label="${l}"]`);
        if (!el) throw new Error("missing " + l);
        return el;
      };
      setVal(byLabel("CSI division number"), s.csi);
      setVal(byLabel("Trade package name"), s.name);
      setVal(byLabel("Budget estimate in dollars"), String(s.budget));
      setVal(byLabel("Scope summary"), "QA5 scope: " + s.name + " complete turnkey commercial scope.");
      setVal(byLabel("Mandatory inclusions, one per line"), "Crane hoisting\nSeismic bracing\nTemporary power");
      setVal(byLabel("Bid deadline"), "2026-12-15");
    },
    spec
  );
  await delay(300);
  await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    const d = dialogs[dialogs.length - 1];
    const b = d ? [...d.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Create Package") : null;
    b?.click();
  });
  for (let i = 0; i < 25; i++) {
    await delay(600);
    const projects = await q("projects:listProjects", {});
    const proj = projects.find((p) => p.title === PROJECT_TITLE);
    if (!proj) continue;
    const pkgs = await q("tradePackages:listByProject", { projectId: proj._id });
    const found = pkgs.find((p) => p.csiDivision === spec.csi);
    if (found) return found;
  }
  throw new Error("package not created: " + spec.csi);
}

async function addContractor(page, tradeName, name, email) {
  await clickTabSafe(page, "01:");
  const selected = await selectPackageCard(page, tradeName);
  if (!selected) throw new Error("package card not found: " + tradeName);
  await clickTabSafe(page, "02:");
  const switched = await page.evaluate((needle) => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.textContent || "").includes(needle) && x.getAttribute("aria-pressed") !== null
    );
    if (!b) return false;
    b.click();
    return true;
  }, tradeName);
  if (!switched) throw new Error("package ribbon not found: " + tradeName);
  await delay(1000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Add Contractor Manually"));
    b?.click();
  });
  await delay(600);
  await page.evaluate(
    (n, e) => {
      const setVal = (el, val) => {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
        setter.call(el, val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const setByPlaceholder = (ph, val) => {
        const el = [...document.querySelectorAll("input")].find((x) => x.getAttribute("placeholder") === ph);
        if (!el) throw new Error("missing field " + ph);
        setVal(el, val);
      };
      setByPlaceholder("e.g. Rosendin Electric, Inc.", n);
      setByPlaceholder("estimating@rosendin.com", e);
      setByPlaceholder("e.g. TECL-38492", "QA5-LIC-1001");
      setByPlaceholder("https://www.rosendin.com", "https://qa5.example.com");
    },
    name,
    email
  );
  await delay(300);
  await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    const d = dialogs[dialogs.length - 1];
    const b = d ? [...d.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Add to Directory")) : null;
    b?.click();
  });
  for (let i = 0; i < 20; i++) {
    await delay(600);
    const projects = await q("projects:listProjects", {});
    const proj = projects.find((p) => p.title === PROJECT_TITLE);
    const list = await q("contractors:listByProject", { projectId: proj._id });
    const found = list.find((c) => c.companyName === name);
    if (found) return found;
  }
  throw new Error("contractor not created: " + name);
}

const run = async () => {
  const { browser, page } = await openApp();
  try {
    let projects = await q("projects:listProjects", {});
    let project = projects.find((p) => p.title === PROJECT_TITLE);
    if (!project) {
      project = await createProject(page);
      step("project-created", { id: project._id });
    } else {
      step("project-existing", { id: project._id });
    }
    await shot(page, "fix4-qa5-fixture-project.png");
    OUT.projectId = project._id;
    await selectProject(page, project._id);
    await clickTabSafe(page, "01:");

    for (const spec of [CONCRETE, PLUMBING, HVAC]) {
      const pkgs = await q("tradePackages:listByProject", { projectId: project._id });
      if (!pkgs.find((p) => p.csiDivision === spec.csi)) {
        const pkg = await createPackage(page, spec);
        step("package-created", { csi: pkg.csiDivision, id: pkg._id });
      }
    }

    await clickTabSafe(page, "02:");
    const contractorSpecs = [
      { trade: CONCRETE.name, name: "QA5 Concrete Partners LLC", email: "bids@qa5concrete.example" },
      { trade: CONCRETE.name, name: "QA5 Solid Structures Inc.", email: "estimating@qa5solid.example" },
      { trade: PLUMBING.name, name: "QA5 Flow Systems LLC", email: "bids@qa5flow.example" },
      { trade: PLUMBING.name, name: "QA5 Pipeworks Group Inc.", email: "estimating@qa5pipe.example" },
      { trade: HVAC.name, name: "QA5 Air Balance Corp.", email: "bids@qa5air.example" },
      { trade: HVAC.name, name: "QA5 Thermal Works LLC", email: "estimating@qa5thermal.example" },
    ];
    const existing = await q("contractors:listByProject", { projectId: project._id });
    for (const c of contractorSpecs) {
      if (!existing.find((x) => x.companyName === c.name)) {
        const created = await addContractor(page, c.trade, c.name, c.email);
        step("contractor-created", { name: created.companyName, id: created._id });
      }
    }

    const state = {
      projectId: project._id,
      packages: await q("tradePackages:listByProject", { projectId: project._id }),
      contractors: await q("contractors:listByProject", { projectId: project._id }),
    };
    OUT.state = state;
    await shot(page, "fix4-qa5-fixture-discovery.png");
    writeJson("fix4-qa5-fixture.json", OUT);
  } catch (e) {
    OUT.error = String(e && e.stack ? e.stack : e);
    writeJson("fix4-qa5-fixture.json", OUT);
    console.error("ERROR", OUT.error);
  } finally {
    await browser.close();
  }
};

async function clickTabSafe(page, prefix) {
  await page.evaluate((p) => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith(p));
    b?.click();
  }, prefix);
  await delay(1200);
}

run();