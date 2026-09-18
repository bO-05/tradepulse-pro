import { expect, test } from "vitest";
import { looksLikeCompanyName, sanitizeContractorCompanyName } from "./contractorDiscovery";

test("F8: mid-sentence SEO fragments are rejected, not stored as company names", () => {
  // The exact audit example, produced by stripping the brand suffix at the first hyphen.
  expect(sanitizeContractorCompanyName("Commercial Electricians, Industrial, and High-Voltage Contractors in Austin, TX - FSG", "")).toBe("");
  expect(looksLikeCompanyName("Commercial Electricians, Industrial, and High")).toBe(false);
  expect(sanitizeContractorCompanyName("Commercial Electricians, Industrial, and High", "")).toBe("");
});

test("F8: dangling conjunction fragments are rejected", () => {
  expect(looksLikeCompanyName("Premier Mechanical Services and")).toBe(false);
  expect(sanitizeContractorCompanyName("Best Plumbing Contractors in Dallas, TX for", "")).toBe("");
});

test("F8: real company names still pass", () => {
  expect(sanitizeContractorCompanyName("Rosendin Electric, Inc.", "x")).toBe("Rosendin Electric, Inc.");
  expect(sanitizeContractorCompanyName("Smith, Jones & Associates", "x")).toBe("Smith, Jones & Associates");
  expect(sanitizeContractorCompanyName("Clarke Kent Plumbing", "x")).toBe("Clarke Kent Plumbing");
  expect(looksLikeCompanyName("Clarke Kent Plumbing")).toBe(true);
  expect(looksLikeCompanyName("TDIndustries, Inc.")).toBe(true);
});

test("F8: existing spam prefixes and length limits still apply", () => {
  expect(sanitizeContractorCompanyName("Top 10 Electrical Contractors in Texas", "fallback")).toBe("fallback");
  expect(sanitizeContractorCompanyName("Find plumbers near me", "fallback")).toBe("fallback");
  expect(sanitizeContractorCompanyName("", "fallback")).toBe("fallback");
});