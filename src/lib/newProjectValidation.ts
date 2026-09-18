export const BUDGET_MAX = 1_000_000_000;
export const WEEKS_MAX = 520;

export interface NewProjectFieldInputs {
  title: string;
  budget: string | number;
  weeks: string | number;
}

export interface NewProjectValidationResult {
  ok: boolean;
  error?: string;
  budget?: number;
  weeks?: number;
}

/**
 * F3: single validation source for the New Project form. The form starts empty
 * (placeholders only), so validation runs on what the user actually typed —
 * including accidental appends like "550000014200000".
 */
export function validateNewProjectFields(inputs: NewProjectFieldInputs): NewProjectValidationResult {
  const title = String(inputs.title ?? "").trim();
  if (!title) return { ok: false, error: "Project title is required." };

  const rawBudget = String(inputs.budget ?? "").trim();
  if (!rawBudget) return { ok: false, error: "Estimated budget is required." };
  const budget = Number(rawBudget);
  if (!Number.isFinite(budget) || budget <= 0) {
    return { ok: false, error: "Estimated budget must be a positive number greater than $0." };
  }
  if (!Number.isInteger(budget)) {
    return { ok: false, error: "Estimated budget must be a whole dollar amount." };
  }
  if (budget > BUDGET_MAX) {
    return {
      ok: false,
      error: `Estimated budget must be $${BUDGET_MAX.toLocaleString()} or less. Check for an accidental extra digit.`,
    };
  }

  const rawWeeks = String(inputs.weeks ?? "").trim();
  if (!rawWeeks) return { ok: false, error: "Duration in weeks is required." };
  const weeks = Number(rawWeeks);
  if (!Number.isFinite(weeks) || weeks <= 0 || weeks > WEEKS_MAX) {
    return { ok: false, error: "Duration must be between 1 and 520 weeks." };
  }

  return { ok: true, budget, weeks: Math.round(weeks) };
}