import { LearnPage, learnMetadata } from './learn-page';

export const metadata = learnMetadata;
// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

export default function LearnHomePage() {
  return <LearnPage path="/app/learn" />;
}
