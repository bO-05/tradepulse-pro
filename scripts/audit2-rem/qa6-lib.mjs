import {
  BASE_URL,
  EVIDENCE_DIR,
  REPO_ROOT,
  attachDiagnostics,
  bodyText,
  clickButtonByText,
  clickTab,
  delay,
  getSelectorState,
  launchBrowser,
  realClickButtonByText,
  selectProjectByTitle,
  setInputValue,
  setViewport,
  shot,
  waitForAppReady,
  writeJson,
  writeLog,
} from "./lib.mjs";

export {
  BASE_URL,
  EVIDENCE_DIR,
  REPO_ROOT,
  attachDiagnostics,
  bodyText,
  clickButtonByText,
  clickTab,
  delay,
  getSelectorState,
  launchBrowser,
  realClickButtonByText,
  selectProjectByTitle,
  setInputValue,
  setViewport,
  shot,
  waitForAppReady,
  writeJson,
  writeLog,
};

export const DEMO_PROJECT = "The Domain Tower B - Commercial MEP";
export const DEMO_PROJECT_SHORT = "Domain Tower B";

export async function gotoDemo(page, projectNeedle = DEMO_PROJECT) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAppReady(page);
  await delay(800);
  const selected = await selectProjectByTitle(page, projectNeedle);
  await delay(1000);
  return selected;
}

export async function clickHeaderTab(page, label) {
  await page.evaluate((t) => {
    const b = [...document.querySelectorAll("header button")].find(
      (x) => (x.getAttribute("title") || "").includes(t) || (x.innerText || "").includes(t)
    );
    if (b) b.click();
  }, label);
  await delay(700);
}

export const STACK_PROBE = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0.05;
  };
  const nameOf = (el) => {
    if (!el) return "(none)";
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim().slice(0, 90);
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const t = lb.split(/\s+/).map((id) => (document.getElementById(id) || {}).innerText || "").join(" ").trim();
      if (t) return t.replace(/\s+/g, " ").slice(0, 90);
    }
    const t = (el.innerText || "").trim().replace(/\s+/g, " ");
    return t ? t.slice(0, 90) : (el.getAttribute("title") || el.getAttribute("placeholder") || "").trim().slice(0, 90);
  };
  const overlays = [...document.querySelectorAll("div.fixed.inset-0")].filter(vis);
  const dialogs = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(vis);
  const top = dialogs[dialogs.length - 1] || null;
  const topOverlay = overlays[overlays.length - 1] || null;
  const a = document.activeElement;
  const sc = document.scrollingElement || document.documentElement;
  const labelledby = top ? top.getAttribute("aria-labelledby") : null;
  const labelledbyText = labelledby
    ? labelledby.split(/\s+/).map((id) => (document.getElementById(id) || {}).innerText || "").join(" ").trim().replace(/\s+/g, " ").slice(0, 90)
    : null;
  return {
    overlayCount: overlays.length,
    dialogCount: dialogs.length,
    topRole: top ? top.getAttribute("role") : null,
    topAriaModal: top ? top.getAttribute("aria-modal") : null,
    topLabelledby: labelledby,
    topLabelledbyResolved: labelledby ? !!labelledbyText : null,
    topLabelledbyText: labelledbyText,
    topAriaLabel: top ? top.getAttribute("aria-label") : null,
    topTitle: top ? ((top.querySelector("h1,h2,h3") || {}).innerText || "").trim().slice(0, 70) : null,
    topZ: top ? getComputedStyle(top.parentElement || top).zIndex : null,
    topOverlayZ: topOverlay ? getComputedStyle(topOverlay).zIndex : null,
    activeTag: a ? a.tagName.toLowerCase() : null,
    activeType: a ? a.getAttribute("type") : null,
    activeName: nameOf(a),
    activeId: a && a.id ? a.id : null,
    activeInsideTop: top ? top.contains(a) : false,
    activeInsideAnyOverlay: topOverlay ? topOverlay.contains(a) : false,
    bodyOverflowInline: document.body.style.overflow,
    bodyOverflowComputed: getComputedStyle(document.body).overflow,
    htmlOverflowComputed: getComputedStyle(document.documentElement).overflow,
    scrollY: window.scrollY,
    scrollingTop: Math.round(sc.scrollTop),
    scrollingCanScroll: sc.scrollHeight > sc.clientHeight,
  };
};

export async function armOpenerBySelector(page, selector) {
  return page.evaluate((sel) => {
    const els = [...document.querySelectorAll(sel)].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const el = els[0];
    if (!el) return null;
    window.__qa6Opener = el;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      name: (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 80),
      title: el.getAttribute("title"),
    };
  }, selector);
}

export async function armOpenerByText(page, text, exact = false) {
  return page.evaluate(
    (needle, ex) => {
      const els = [...document.querySelectorAll("button")].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const el = els.find((b) => {
        const t = (b.innerText || "").trim();
        return ex ? t === needle : t.includes(needle);
      });
      if (!el) return null;
      window.__qa6Opener = el;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        name: (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 80),
        title: el.getAttribute("title"),
      };
    },
    text,
    exact
  );
}

export async function focusRestoreProbe(page) {
  return page.evaluate(() => {
    const a = document.activeElement;
    const op = window.__qa6Opener;
    const scrub = (el) =>
      !el
        ? null
        : (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 80);
    return {
      active: scrub(a),
      opener: scrub(op),
      identity: !!op && a === op,
      tag: a ? a.tagName.toLowerCase() : null,
    };
  });
}

export async function tabSweep(page, opts = {}) {
  const times = opts.times || 40;
  const shift = !!opts.shift;
  const mode = opts.mode || "stack";
  const stops = [];
  let outside = 0;
  for (let i = 0; i < times; i++) {
    if (shift) {
      await page.keyboard.down("Shift");
      await page.keyboard.press("Tab");
      await page.keyboard.up("Shift");
    } else {
      await page.keyboard.press("Tab");
    }
    await delay(20);
    const s = await page.evaluate(STACK_PROBE);
    const inside = mode === "top" ? s.activeInsideTop : s.activeInsideTop || s.activeInsideAnyOverlay;
    if (!inside) outside++;
    stops.push({ name: s.activeName.slice(0, 60), tag: s.activeTag, type: s.activeType, zone: inside ? "inside" : "OUTSIDE" });
  }
  return { stops, outside, first: stops[0], last: stops[stops.length - 1] };
}

export async function wheelProbe(page, x = 12, y = 450, deltaY = 700) {
  const before = await page.evaluate(() => ({
    y: window.scrollY,
    over: getComputedStyle(document.body).overflow,
  }));
  let dialogScrollBefore = null;
  await page.evaluate((yy) => {
    const ds = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(
      (e) => e.getBoundingClientRect().width > 0
    );
    const top = ds[ds.length - 1];
    if (top) {
      top.setAttribute("data-qa6-scroll", "1");
      window.__qa6DialogScrollBefore = top.scrollTop;
    }
    window.__qa6WheelY = yy;
  }, y);
  await page.mouse.move(x, y);
  await page.mouse.wheel({ deltaY });
  await delay(300);
  const after = await page.evaluate(() => {
    const ds = [...document.querySelectorAll('[data-qa6-scroll="1"]')];
    const top = ds[ds.length - 1] || null;
    const out = {
      y: window.scrollY,
      dialogScrollAfter: top ? top.scrollTop : null,
      dialogScrollBefore: window.__qa6DialogScrollBefore,
    };
    if (top) top.removeAttribute("data-qa6-scroll");
    return out;
  });
  return { before, after, documentScrollChanged: after.y !== before.y, dialogScrollChanged: after.dialogScrollAfter !== after.dialogScrollBefore };
}

export async function axScan(page, client, rootSelector, controlSelector = "input,select,textarea") {
  const doc = await client.send("DOM.getDocument", { depth: 1 });
  let rootId = doc.root.nodeId;
  if (rootSelector && rootSelector !== "body" && rootSelector !== ":root") {
    const r = await client.send("DOM.querySelector", { nodeId: rootId, selector: rootSelector });
    if (!r.nodeId) return { ok: false, reason: "root not found", controls: [] };
    rootId = r.nodeId;
  }
  const { nodeIds } = await client.send("DOM.querySelectorAll", { nodeId: rootId, selector: controlSelector });
  const dom = await page.evaluate(
    (sel, cs) => {
      const root = sel && sel !== "body" && sel !== ":root" ? document.querySelector(sel) : document.body;
      if (!root) return [];
      return [...root.querySelectorAll(cs)].map((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const visible = r.width > 0 && r.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        const id = el.id || "";
        const forLabel = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
        const wrapLabel = el.closest("label");
        return {
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute("type") || "",
          id,
          name: el.getAttribute("name") || "",
          visible,
          disabled: !!el.disabled,
          ariaLabel: el.getAttribute("aria-label"),
          ariaLabelledby: el.getAttribute("aria-labelledby"),
          nativeLabel: forLabel ? forLabel.innerText.trim().slice(0, 60) : null,
          wrappingLabel: wrapLabel ? wrapLabel.innerText.trim().slice(0, 60) : null,
          placeholder: el.getAttribute("placeholder"),
          title: el.getAttribute("title"),
          snippet: el.outerHTML.replace(/\s+/g, " ").slice(0, 130),
        };
      });
    },
    rootSelector,
    controlSelector
  );
  const controls = [];
  for (let i = 0; i < dom.length; i++) {
    const nodeId = nodeIds[i];
    let ax = { role: null, name: null, ignored: null };
    if (nodeId) {
      try {
        const { nodes } = await client.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
        const n = nodes && nodes[0];
        ax = { role: n && n.role ? n.role.value : null, name: n && n.name ? n.name.value : null, ignored: n ? !!n.ignored : null };
      } catch (err) {
        ax = { role: "error", name: null, ignored: null, error: String(err && err.message ? err.message : err) };
      }
    }
    controls.push({ ...dom[i], ax });
  }
  const visible = controls.filter((c) => c.visible);
  const unnamed = visible.filter((c) => !c.ax.name || !String(c.ax.name).trim());
  return {
    ok: true,
    rootSelector,
    domCount: controls.length,
    visibleCount: visible.length,
    unnamedCount: unnamed.length,
    unnamed: unnamed.map((c) => ({
      tag: c.tag,
      type: c.type,
      role: c.ax.role,
      id: c.id,
      name: c.name,
      placeholder: c.placeholder,
      nativeLabel: c.nativeLabel,
      wrappingLabel: c.wrappingLabel,
      ariaLabel: c.ariaLabel,
      snippet: c.snippet,
    })),
    named: visible
      .filter((c) => c.ax.name && String(c.ax.name).trim())
      .map((c) => ({ tag: c.tag, role: c.ax.role, name: c.ax.name, fromPlaceholder: !!c.placeholder && c.ax.name === c.placeholder })),
  };
}

export const CLIP_SCAN = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden";
  };
  const clipped = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    const isClamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
    const isEllipsis = cs.textOverflow === "ellipsis";
    if (!isClamp && !isEllipsis) continue;
    const overflowed = isClamp
      ? el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1
      : el.scrollWidth > el.clientWidth + 1;
    if (!overflowed) continue;
    const text = (el.innerText || el.textContent || "").trim();
    if (text.length < 3) continue;
    clipped.push({
      text: text.replace(/\s+/g, " ").slice(0, 80),
      title: el.getAttribute("title"),
      ariaLabel: el.getAttribute("aria-label"),
      clamp: cs.webkitLineClamp,
      clientW: el.clientWidth,
      scrollW: el.scrollWidth,
      cls: (el.className || "").toString().slice(0, 70),
    });
  }
  const seen = new Set();
  return clipped.filter((c) => {
    const k = c.text;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};