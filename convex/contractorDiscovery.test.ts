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

test("F8: live-observed junk titles are rejected (class fix)", () => {
  // Names actually ingested by live Firecrawl discovery runs during remediation.
  expect(sanitizeContractorCompanyName("Get Electrical Help in Florida", "")).toBe("");
  expect(sanitizeContractorCompanyName("Tampa Electric on Instagram", "")).toBe("");
  expect(sanitizeContractorCompanyName("Emergency 24/7 Service Hotline", "")).toBe("");
  expect(sanitizeContractorCompanyName("HVAC Contractor Licensing Requirements in Tampa", "")).toBe("");
  expect(sanitizeContractorCompanyName("Commercial AC Repair Tampa", "")).toBe("");
  expect(sanitizeContractorCompanyName("Tampa AC Services, Repair & Installation", "")).toBe("");
  expect(sanitizeContractorCompanyName("Quality Plumbing and Commercial HVAC in Tampa, FL", "")).toBe("");
  expect(looksLikeCompanyName("Get Electrical Help in Florida")).toBe(false);
  expect(looksLikeCompanyName("Tampa Electric on Instagram")).toBe(false);
  expect(looksLikeCompanyName("Emergency 24/7 Service Hotline")).toBe(false);
  expect(looksLikeCompanyName("HVAC Contractor Licensing Requirements in Tampa")).toBe(false);
  expect(looksLikeCompanyName("Commercial AC Repair Tampa")).toBe(false);
  expect(looksLikeCompanyName("Tampa AC Services, Repair & Installation")).toBe(false);
  expect(sanitizeContractorCompanyName("[Florida Fire Protection Contractor I", "")).toBe("");
  expect(sanitizeContractorCompanyName("Kitchen Hood Cleaning", "")).toBe("");
  expect(sanitizeContractorCompanyName("Business Categories", "")).toBe("");
  expect(looksLikeCompanyName("Business Categories")).toBe(false);
  expect(looksLikeCompanyName("[Florida Fire Protection Contractor I")).toBe(false);
  expect(looksLikeCompanyName("Kitchen Hood Cleaning")).toBe(false);
  // Legitimate names with service words still pass.
  expect(looksLikeCompanyName("Emergency Electric, Inc.")).toBe(true);
  expect(looksLikeCompanyName("Austin Emergency Plumbing LLC")).toBe(true);
  expect(looksLikeCompanyName("Tampa Bay Mechanical Contractors, Inc.")).toBe(true);
});