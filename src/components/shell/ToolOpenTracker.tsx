import { useEffect, useRef } from 'react';
import { useProject } from '@/hooks/useProjectStore';
import { isTool } from './tools';

// Tells the server which tools are used (once per tool per page load; the
// server counts each tool once per account and day). Only the tool's id is
// sent: nothing about the artwork or what was done with it.

export function ToolOpenTracker() {
  const { activeTab } = useProject();
  const sent = useRef(new Set<string>());
  useEffect(() => {
    if (!isTool(activeTab) || sent.current.has(activeTab)) return;
    sent.current.add(activeTab);
    void fetch('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'tool_open', tool: activeTab }),
      credentials: 'same-origin',
    })
      // Read the (tiny) reply: a response left unread keeps the request open in the browser.
      .then((response) => response.text())
      .catch(() => undefined);
  }, [activeTab]);
  return null;
}
