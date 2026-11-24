import { useEffect } from 'react';
import { useProject } from '@/hooks/useProjectStore';
import { isTool } from '@/components/shell/tools';
import { useAccount } from '@/components/shell/account';
import { Celebration } from './Celebration';
import { noteToolUsed, useCompanionView } from './state';

// Sketchy across the studio (ADR-0024), outside his stages: he remembers the
// tool used last (for suggestions "right after this tool"), and celebrates a
// save or a completion in the corner on screens without a stage. Mounted
// once by the studio, loaded after it, and asks nothing of the server unless
// he is shown to this account.

export default function CompanionHost() {
  const { activeTab } = useProject();
  const show = useAccount()?.account.companion?.show === true;
  const view = useCompanionView(show);
  useEffect(() => {
    if (isTool(activeTab)) noteToolUsed(activeTab);
  }, [activeTab]);
  const data = view.data;
  const enabled = show && !!data && data.features.companion === 'open' && data.settings.enabled && data.settings.celebrate && activeTab !== 'home';
  return <Celebration enabled={enabled} celebrate={data?.settings.animations.celebrate !== false} jump={data?.settings.animations.jump !== false} />;
}
