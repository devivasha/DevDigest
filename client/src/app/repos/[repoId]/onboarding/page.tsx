/* Route: /repos/:repoId/onboarding — Server Component shell. Thin route
   entry — the interactive view, its sections, styles, constants, helpers and
   i18n are colocated under _components/OnboardingTourView. Distinct from the
   first-run wizard at /onboarding (AC-18). */
import { OnboardingTourView } from "./_components/OnboardingTourView";

export default function OnboardingTourPage() {
  return <OnboardingTourView />;
}
