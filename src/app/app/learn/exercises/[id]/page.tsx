import { redirect } from 'next/navigation';
import { EXERCISE_ID } from '@/lib/learn/model';
import { LearnPage, learnMetadata } from '../../learn-page';

export const metadata = learnMetadata;
// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

// An exercise's own page. Whether it opens is decided by the Learn API when
// the studio asks for it (locked: its locked page; unknown: not found).
export default async function ExercisePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!EXERCISE_ID.test(id)) redirect('/app/learn/curriculum');
  return <LearnPage path={`/app/learn/exercises/${id}`} />;
}
