import { redirect } from 'next/navigation';
import { TOOL_SLUGS } from '@/components/shell/tools';

// Each tool is rendered by the studio in ../layout.tsx; this page only decides
// which tool URLs exist. Unknown tools fall back to Home, as they always have.

export function generateStaticParams() {
  return TOOL_SLUGS.map((tool) => ({ tool }));
}

export default async function ToolPage({ params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  if (!TOOL_SLUGS.includes(tool)) redirect('/app');
  return null;
}
