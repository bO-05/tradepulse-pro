import { expect, test } from "vitest";
import { BUDGET_MAX, validateNewProjectFields } from "./lib/newProjectValidation.ts";

test("F3: typed values pass validation exactly as typed", () => {
  const res = validateNewProjectFields({ title: "Dallas Logistics Hub", budget: "14200000", weeks: "78" });
  expect(res.ok).toBe(true);
  expect(res.budget).toBe(14_200_000);
  expect(res.weeks).toBe(78);
});

test("F3: the audit's accidental budget append (typing over a prefill) is rejected", () => {
  const res = validateNewProjectFields({ title: "Append Case", budget: "550000014200000", weeks: "52" });
  expect(res.ok).toBe(false);
  expect(res.error).toContain("extra digit");
});

test("F3: empty and invalid fields produce visible-message errors", () => {
  expect(validateNewProjectFields({ title: "   ", budget: "100", weeks: "52" }).error).toContain("title");
  expect(validateNewProjectFields({ title: "T", budget: "", weeks: "52" }).error).toContain("budget is required");
  expect(validateNewProjectFields({ title: "T", budget: "0", weeks: "52" }).error).toContain("positive");
  expect(validateNewProjectFields({ title: "T", budget: "100", weeks: "0" }).error).toContain("1 and 520");
  expect(validateNewProjectFields({ title: "T", budget: "100", weeks: "521" }).error).toContain("1 and 520");
});

test("F3: the budget ceiling is explicit and enforced", () => {
  expect(validateNewProjectFields({ title: "T", budget: String(BUDGET_MAX), weeks: "52" }).ok).toBe(true);
  expect(validateNewProjectFields({ title: "T", budget: String(BUDGET_MAX + 1), weeks: "52" }).ok).toBe(false);
});