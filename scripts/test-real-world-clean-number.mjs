function cleanNumber(val, fallback = 0) {
  if (typeof val === 'number') return Number.isFinite(val) ? val : fallback;
  if (!val) return fallback;
  if (typeof val !== 'string') return fallback;

  // 1. Normalize unicode spaces & punctuation
  let str = val
    .replace(/[\u00A0\u202F\u200B\u3000]/g, ' ')
    .replace(/[\u2013\u2014]/g, '-') // en-dash and em-dash
    .trim();
  if (!str) return fallback;

  // 2. Check for range e.g. '$1,200,000 - $1,350,000' or '$1.2M to $1.4M' or 'between $1.2M and $1.4M'
  const withoutBetween = str.replace(/^between\s+/i, '');
  const rangeMatch = withoutBetween.match(/^(.+?)\s*(?:(?<=\S)\s*[-–—]\s*(?=\S)|\bto\b|\band\b)\s*(.+)$/i);
  if (rangeMatch) {
    let p1 = rangeMatch[1].trim();
    let p2 = rangeMatch[2].trim();
    if (/\d/.test(p1) && /\d/.test(p2) && !/^[+\-]/.test(p1.trim())) {
      const multRegex = /(k|kilo|thousand|m|mil|million|b|bil|billion)$/i;
      const p2Mult = p2.match(multRegex);
      if (p2Mult && !multRegex.test(p1)) p1 = p1 + p2Mult[1];
      const p2Curr = p2.match(/(USD|CAD|EUR|GBP|AUD|CHF|MXN|NZD|SGD)$/i);
      if (p2Curr && !new RegExp(p2Curr[1] + '$', 'i').test(p1)) {
        p1 = p1 + ' ' + p2Curr[1];
      }
      const v1 = cleanNumber(p1, null);
      const v2 = cleanNumber(p2, null);
      if (v1 !== null && v2 !== null && v1 > 0 && v2 > 0) return Math.round((v1 + v2) / 2);
    }
  }

  // 3. Detect negative / deduct indicators
  const isDeductWord = /\b(?:deduct|deduction|credit|discount|savings|refund|rebate|less)\b/i.test(str);
  let isNegative =
    isDeductWord ||
    (str.startsWith('(') && str.endsWith(')')) ||
    str.startsWith('-') ||
    str.endsWith('-') ||
    /[-]\s*[$€£¥₹]/.test(str) ||
    /[$€£¥₹]\s*[-]/.test(str) ||
    /[-]\s*(?:USD|CAD|EUR|GBP|AUD|CHF|MXN|NZD|SGD)\b/i.test(str) ||
    /\b(?:USD|CAD|EUR|GBP|AUD|CHF|MXN|NZD|SGD)\s*[-]/i.test(str) ||
    /[-]\s*(?:USD|CAD|EUR|GBP|AUD|CHF|MXN|NZD|SGD)$/i.test(str);

  // 4. Strip common conversational / construction estimation prefixes
  str = str
    .replace(/^(?:[~≈*]|approx\.?|est\.?|estimated|budget:?|total:?|sum:?|quote:?|price:?|cost:?|amount:?)\s*/i, '')
    .replace(/^(?:addendum|alternate|option|item|ve|phase)?\s*#?\d*[:\s-]*(?:deduct(?:ion)?|credit|discount|savings|rebate|less):?\s*/i, '')
    .replace(/^(?:deduct(?:ion)?|credit|discount|savings|rebate|less)\s*(?:alternate|option|item|ve|phase)?\s*#?\d*[:\s-]*/i, '')
    .replace(/^(?:addendum|alternate|option|item|ve|phase)\s*#?\d*[:\s-]*/i, '')
    .replace(/^f\.?o\.?b\.?(?:\s*jobsite|\s*site)?:?\s*/i, '')
    .trim();

  // 5. Strip common commercial trailing qualifiers, taxes, and trade notations
  // e.g. "+ tax", "plus 8.25% sales tax", "net 30", "/ LS", "FOB Jobsite", "(taxes excluded)"
  str = str
    .replace(/\s*(?:\+|\/|\bplus\b)?\s*(?:\d+(?:\.\d+)?%?\s*)?(?:sales\s*)?tax(?:es)?(?:\s*(?:extra|excluded|included|exempt|applicable|not\s+included))?/gi, '')
    .replace(/\s*\([^)]*(?:tax|phase|option|addendum|scope)[^)]*\)/gi, '')
    .replace(/\s*(?:\/|\bper\b)?\s*\b(?:lump\s*sum|ls|f\.?o\.?b\.?(?:\s*jobsite|\s*site)?|net\s*\d*|gross|delivered|installed|complete)\b/gi, '')
    .trim();

  // Strip trailing parenthetical notes EXCEPT if whole string is an accounting paren like ($35,000), ($25k), or (USD 50,000)
  const isWrappedInParens = str.startsWith('(') && str.endsWith(')');
  if (isWrappedInParens && /\d/.test(str) && !/\b(?:tax|phase|option|addendum|scope|exempt)\b/i.test(str)) {
    // Keep accounting negative intact
  } else {
    str = str.replace(/\s*\([^)]*\)$/, '').trim();
  }

  // 6. Remove wrapping parens, brackets, and signs
  str = str.replace(/^[(\[]+|[)\]]+$/g, '').replace(/^[-+]|[-+]$/g, '').trim();

  // 7. Strip currency symbols and ISO codes: $, €, £, ¥, ₹, USD, CAD, EUR, GBP, AUD, CHF, MXN, NZD, SGD
  str = str
    .replace(/^(?:[$€£¥₹]|USD|CAD|EUR|GBP|AUD|CHF|MXN|NZD|SGD|\s)+/gi, '')
    .replace(/(?:[$€£¥₹]|USD|CAD|EUR|GBP|AUD|CHF|MXN|NZD|SGD|\s)+$/gi, '')
    .trim();

  // Re-check minus after currency strip (e.g. '$-25,000' -> '-25,000' or '25,000- USD' -> '25,000-')
  if (str.startsWith('-')) {
    isNegative = true;
    str = str.replace(/^-\s*/, '');
  }
  if (str.endsWith('-')) {
    isNegative = true;
    str = str.replace(/\s*-$/, '');
  }

  // 8. Check abbreviated multipliers (M, K, B, million, thousand, etc.)
  const multMatch = str.match(/^([0-9\s.,]+)\s*([kmbt]|mil|million|kilo|thousand|bil|billion)\b/i);
  if (multMatch) {
    let numPart = multMatch[1].trim().replace(/\s+/g, '');
    const unit = multMatch[2].toLowerCase();
    if (numPart.includes(',') && !numPart.includes('.')) {
      numPart = numPart.replace(',', '.');
    } else {
      numPart = numPart.replace(/,/g, '');
    }
    const base = parseFloat(numPart);
    if (Number.isFinite(base)) {
      const multiplier =
        unit.startsWith('k') || unit.startsWith('t')
          ? 1e3
          : unit.startsWith('m')
          ? 1e6
          : 1e9;
      const res = Math.round(base * multiplier);
      return isNegative ? -res : res;
    }
    return fallback;
  }

  // 9. Clean thousand separators and parse standard numbers
  str = str.replace(/\s+/g, '');
  const hasDot = str.includes('.');
  const hasComma = str.includes(',');

  if (hasDot && hasComma) {
    const lastDot = str.lastIndexOf('.');
    const lastComma = str.lastIndexOf(',');
    if (lastComma > lastDot) {
      // European: 1.250.000,50 -> remove dots, convert comma to dot
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // US: 1,250,000.50 -> remove commas
      str = str.replace(/,/g, '');
    }
  } else if (hasComma && !hasDot) {
    const lastComma = str.lastIndexOf(',');
    const digitsAfter = str.length - lastComma - 1;
    const commaCount = (str.match(/,/g) || []).length;
    if (commaCount > 1 || digitsAfter === 3) {
      str = str.replace(/,/g, '');
    } else {
      str = str.replace(',', '.');
    }
  } else if (hasDot && !hasComma) {
    const dotCount = (str.match(/\./g) || []).length;
    if (dotCount > 1) {
      str = str.replace(/\./g, '');
    }
  }

  // 10. Parse primary numeric token
  const numMatch = str.match(/^[-+]?[0-9]+(?:\.[0-9]+)?/);
  if (numMatch) {
    const num = parseFloat(numMatch[0]);
    if (Number.isFinite(num)) {
      const finalVal = Math.round(num * 100) / 100;
      return isNegative ? -finalVal : finalVal;
    }
  }
  return fallback;
}

const tests = [
  ['$1,250,000.00', 1250000],
  ['$ 1.25M', 1250000],
  ['1.25 million', 1250000],
  ['$45k', 45000],
  ['($35,000.00)', -35000],
  ['-$25,000', -25000],
  ['25000-', -25000],
  ['USD 850,000', 850000],
  ['CAD 920,000.50', 920000.5],
  ['CHF 450,000', 450000],
  ['₹ 1,500,000', 1500000],
  ['MXN 2,500,000', 2500000],
  ['$1.2 - $1.4M', 1300000],
  ['between $1.2M and $1.4M', 1300000],
  ['$1,250,000 (Phase 1)', 1250000],
  ['$1,200,000 - $1,400,000', 1300000],
  ['N/A', 0],
  [null, 0],
  [undefined, 0],
  ['', 0],
  // Commercial Real-World Edge Cases:
  ['$1.2M + tax', 1200000],
  ['$850k plus sales tax', 850000],
  ['$1.25M net 30', 1250000],
  ['$950k (taxes excluded)', 950000],
  ['$850,000 plus tax', 850000],
  ['$1,250,000 + 8.25% sales tax', 1250000],
  ['$1,250,000 / LS', 1250000],
  ['$750k FOB Jobsite', 750000],
  ['Deduct: $45,000', -45000],
  ['Credit: $25k', -25000],
  ['Discount: $10,000', -10000],
  ['$-25,000', -25000],
  ['$ -25,000', -25000],
  ['Addendum #2: -$15,000', -15000],
  ['($25k)', -25000],
  ['$ 1.25 M', 1250000],
  ['$850 K', 850000],
  ['USD 1.2M', 1200000],
  ['$1.2M USD', 1200000],
  ['$1,250,000.00 (tax exempt)', 1250000],
  ['Addendum 1 Deduct: $20,000', -20000],
  ['Deduct alternate 2: $15,000', -15000],
  // Additional Real-World Accounting & ISO Edge Cases:
  ['(USD 50,000)', -50000],
  ['(CAD $25,000)', -25000],
  ['(EUR 100,000)', -100000],
  ['(50,000 USD)', -50000],
  ['25,000- USD', -25000],
  ['USD -25,000', -25000],
  ['$850k - $950k USD', 900000],
  ['between 1.1M and 1.3M CAD', 1200000],
  ['Deduct (USD 45,000)', -45000],
  ['-$1.25M USD', -1250000],
];

let failed = 0;
for (const [inp, exp] of tests) {
  const got = cleanNumber(inp);
  const ok = got === exp;
  if (!ok) failed++;
  console.log(String(inp).padEnd(36), '=>', String(got).padEnd(10), 'expected:', String(exp).padEnd(10), ok ? '✓ PASS' : '✗ FAIL');
}
console.log(`\nTotal: ${tests.length}, Passed: ${tests.length - failed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
