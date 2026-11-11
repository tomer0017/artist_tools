// A tool's own workspace (canvas, controls, its tours and save sheet) is not
// translated yet: it stays English and left to right inside, whatever the
// studio's language, so it looks and behaves exactly as before. Takes no box
// of its own, so layout is unchanged (the studio's rules for tool roots look
// through it via `data-tool-frame`).
export function ToolFrame({ children }: { children: React.ReactNode }) {
  return (
    <div data-tool-frame lang="en" dir="ltr" style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
