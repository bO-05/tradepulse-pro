export const SCAN = () => {
  const parse = (s) => {
    if (!s) return null;
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((v) => parseFloat(v));
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a);
    const l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0.05;
  };
  const hasDirectText = (el) => {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim().length >= 2) return true;
    return false;
  };
  const pageBase = parse(getComputedStyle(document.body).backgroundColor) || { r: 10, g: 15, b: 29, a: 1 };
  const results = [];
  const gradientText = [];
  for (const el of document.querySelectorAll("*")) {
    if (!hasDirectText(el) || !visible(el)) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    if (el.closest("button:disabled,input:disabled,select:disabled,textarea:disabled,[aria-disabled='true']")) continue;
    const cs = getComputedStyle(el);
    const fgRaw = parse(cs.color);
    if (!fgRaw) continue;
    if (fgRaw.a === 0 || cs.webkitTextFillColor === "rgba(0, 0, 0, 0)") {
      gradientText.push({ text: Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").slice(0, 60), cls: (el.className || "").toString().slice(0, 80) });
      continue;
    }
    let gradient = false;
    const layers = [];
    let cur = el;
    let opacity = 1;
    while (cur) {
      const ccs = getComputedStyle(cur);
      opacity *= parseFloat(ccs.opacity) || 1;
      if (ccs.backgroundImage !== "none") gradient = true;
      const c = parse(ccs.backgroundColor);
      if (c && c.a > 0) layers.push(c);
      if (c && c.a >= 0.999) break;
      cur = cur.parentElement;
    }
    let bg = { ...pageBase };
    const stack = layers.filter((l) => l.a < 0.999).reverse();
    for (const l of stack) bg = over(l, bg);
    if (layers.length && layers[layers.length - 1].a >= 0.999) bg = layers[layers.length - 1];
    let fg = fgRaw;
    if (opacity < 0.999) fg = { ...fgRaw, a: fgRaw.a * opacity };
    const composedFg = fg.a >= 0.999 ? fg : over(fg, bg);
    const fs = parseFloat(cs.fontSize);
    const fw = parseInt(cs.fontWeight, 10) || 400;
    const large = fs >= 24 || (fs >= 18.66 && fw >= 700);
    const r = ratio(composedFg, bg);
    const req = large ? 3 : 4.5;
    if (r < req) {
      results.push({
        text: Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").replace(/\s+/g, " ").slice(0, 90),
        ratio: Math.round(r * 100) / 100,
        required: req,
        fg: cs.color,
        bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
        fontSize: cs.fontSize,
        fontWeight: fw,
        large,
        gradientAncestor: gradient,
        el: el.tagName.toLowerCase() + "." + (el.className || "").toString().split(/\s+/).slice(0, 4).join("."),
      });
    }
  }
  const seen = new Set();
  const dedup = [];
  for (const r of results.sort((a, b) => a.ratio - b.ratio)) {
    const k = `${r.text}|${r.fg}|${r.bg}|${r.fontSize}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(r);
  }
  return { violations: dedup.slice(0, 120), totalViolations: results.length, gradientText: gradientText.slice(0, 30), gradientTextCount: gradientText.length };
};

export const FIELD_AUDIT = () => {
  const visible = (el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
  const labelInfo = (el) => {
    const aria = el.getAttribute("aria-label");
    const lb = el.getAttribute("aria-labelledby");
    let lbText = "";
    if (lb) lbText = lb.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ").trim();
    const id = el.id;
    const forLabel = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    const wrap = el.closest("label");
    return {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || "",
      name: (el.getAttribute("name") || "").slice(0, 40),
      ariaLabel: aria,
      ariaLabelledbyText: lbText,
      labelForText: forLabel ? forLabel.innerText.trim().slice(0, 60) : null,
      wrappingLabelText: wrap ? wrap.innerText.trim().slice(0, 50) : null,
      placeholder: el.getAttribute("placeholder"),
      title: el.getAttribute("title"),
      required: el.required,
      programmaticName: aria || lbText || (forLabel ? forLabel.innerText.trim() : "") || (wrap ? wrap.innerText.trim() : "") || null,
    };
  };
  return [...document.querySelectorAll("input,select,textarea")].filter(visible).map(labelInfo);
};