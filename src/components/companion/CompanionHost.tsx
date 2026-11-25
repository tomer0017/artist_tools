import { useEffect } from 'react';
import { useProject } from '@/hooks/useProjectStore';
import { isTool } from '@/components/shell/tools';
import { noteToolUsed } from './state';

// Remember useful tool context; the sole character lives in Home's hero.
export default function CompanionHost() {
  const { activeTab } = useProject();
  useEffect(() => {
    if (isTool(activeTab)) noteToolUsed(activeTab);
  }, [activeTab]);
  return null;
}
