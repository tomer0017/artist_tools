// Guided Onboarding System — a shared framework that teaches each tool in under
// a minute by showing the outcome first, then a short spotlight tour. New tools
// only register content in onboardingConfig; the engine here is reused as-is.
export { OnboardingProvider } from './OnboardingProvider';
export { default as OnboardingHost } from './OnboardingHost';
export { default as HelpButton } from './HelpButton';
export { useOnboarding } from './onboardingContext';
export { ONBOARDING } from './onboardingConfig';
export { hasSeenOnboarding, markOnboardingSeen, resetOnboarding } from './onboardingStorage';
export type { OnboardingConfig, TourStep, PreviewFrame, ToolId } from './onboardingTypes';
