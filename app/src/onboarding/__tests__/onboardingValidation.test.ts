import { canProceedFromProfileStep } from "@aifa/core/onboarding/onboardingValidation";

describe("canProceedFromProfileStep", () => {
  test("true for a non-empty business name", () => {
    expect(canProceedFromProfileStep("ABC Trading")).toBe(true);
  });

  test("false for an empty string", () => {
    expect(canProceedFromProfileStep("")).toBe(false);
  });

  test("false for whitespace-only input", () => {
    expect(canProceedFromProfileStep("   ")).toBe(false);
  });

  test("true for a name with surrounding whitespace", () => {
    expect(canProceedFromProfileStep("  ABC Trading  ")).toBe(true);
  });
});
