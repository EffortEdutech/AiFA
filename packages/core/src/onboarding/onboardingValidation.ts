/**
 * Pure validation logic for the first-run onboarding flow (Sprint 12,
 * Vol 7_1 Section 4). Kept separate from OnboardingFlow.tsx (which is
 * React Native UI, untestable under Jest the same way every other screen
 * in this codebase is) so this one small rule is unit-tested directly.
 */

/**
 * The Business Profile step only requires a business name to proceed --
 * industry is optional (same optionality `appSettingsRepository.ts`
 * already gives it). A business name of only whitespace does not count,
 * matching `SettingsScreen.tsx`'s own `businessName.trim() || null`
 * convention for what counts as "no name given."
 */
export function canProceedFromProfileStep(businessName: string): boolean {
  return businessName.trim().length > 0;
}
