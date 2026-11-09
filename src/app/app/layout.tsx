import StudioClient from '@/components/shell/StudioClient';

// Every /app route shares this layout, so the studio (and the tools it keeps
// alive) stays mounted while the URL moves between Home and the tools. The
// pages themselves render nothing: the studio reads the active tool from the URL.
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StudioClient />
      {children}
    </>
  );
}
