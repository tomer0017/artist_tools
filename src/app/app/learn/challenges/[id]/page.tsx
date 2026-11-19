import { redirect } from 'next/navigation';
import { CHALLENGE_ID } from '@/lib/learn/model';
import { LearnPage, learnMetadata } from '../../learn-page';

export const metadata = learnMetadata;
// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

// A challenge's own page. Whether it opens is decided by the Learn API when
// the studio asks for it (locked: its locked page; unknown: not found).
export default async function ChallengePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!CHALLENGE_ID.test(id)) redirect('/app/learn/challenges');
  return <LearnPage path={`/app/learn/challenges/${id}`} />;
}
