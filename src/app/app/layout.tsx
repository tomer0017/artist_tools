import StudioClient from '@/components/shell/StudioClient';
import { requireUser } from '@/server/session';

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

// Every /app route shares this layout, so the studio (and the tools it keeps
// alive) stays mounted while the URL moves between Home and the tools. The
// session is verified here on the server before any studio code is sent; the
// pages verify it again on every navigation.
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser('/app');
  return (
    <>
      <StudioClient account={{ name: user.name, email: user.email, image: user.image ?? null }} />
      {children}
    </>
  );
}
