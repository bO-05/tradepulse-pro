import { expect, test } from "vitest";
import { looksLikeCompanyName, nameMatchesDomain, sanitizeContractorCompanyName } from "./contractorDiscovery";

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

// A6-27: discovery must never import government/registry/directory pages.
test("A6-27: government and directory page titles are rejected", () => {
  expect(looksLikeCompanyName("Electrical Permits")).toBe(false);
  expect(looksLikeCompanyName("Individual and contractor licenses")).toBe(false);
  expect(looksLikeCompanyName("Title 26 Electrical Regulations")).toBe(false);
  expect(looksLikeCompanyName("Contractor Directory")).toBe(false);
  expect(sanitizeContractorCompanyName("Electrical Permits", "")).toBe("");
  expect(sanitizeContractorCompanyName("Title 26 Electrical Regulations", "")).toBe("");
  // A licensed company that happens to include "code" in its legal name still passes.
  expect(looksLikeCompanyName("Code Electric, Inc.")).toBe(true);
});

// A6-27: name <-> domain agreement, using the exact audited cross-contamination cases.
test("A6-27: a contractor record must agree with the domain it cites", () => {
  expect(nameMatchesDomain("Rosendin Electric, Inc.", "https://www.rosendin.com/")).toBe(true);
  expect(nameMatchesDomain("Heinz Mechanical", "https://heinz-mech.com/portfolio/")).toBe(true);
  expect(nameMatchesDomain("TDIndustries, Inc.", "https://www.tdindustries.com")).toBe(true);
  expect(nameMatchesDomain("FSG", "https://fsg.com/locations")).toBe(true);
  // Audited failures: the cited page belongs to a different entity.
  expect(nameMatchesDomain("Willamette Mechanical Systems Inc.", "https://www.tdindustries.com")).toBe(false);
  expect(nameMatchesDomain("Pacific Electrical Contractors LLC", "https://aandj-electric.com")).toBe(false);
  expect(nameMatchesDomain("New HVAC Design / Build", "https://heinz-mech.com/design-build-portland-or/")).toBe(false);
  expect(nameMatchesDomain("Vancouver & Portland HVAC Contractors", "https://directmechanical.com")).toBe(false);
  expect(nameMatchesDomain("Contractor Directory", "https://www.ibew48.com/contractor-directory/")).toBe(false);
  // No URL at all cannot be attributed.
  expect(nameMatchesDomain("Rosendin Electric, Inc.", "")).toBe(false);
});