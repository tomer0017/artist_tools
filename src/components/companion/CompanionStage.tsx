import type { RefObject } from 'react';
import type { ScreenId } from '@/lib/companion/model';
import { useAccount } from '@/components/shell/account';
import { Stage } from './Stage';
import { useCompanionView } from './state';

// The way Home and the Learn home show Sketchy (ADR-0024), loaded only for
// accounts he is shown to: the server's answer for this account first (on,
// open to them, not hidden), then his data, then the stage.

export default function CompanionStage({ screen, containerRef, floorRef, floorSelector }: { screen: ScreenId; containerRef: RefObject<HTMLElement | null>; floorRef?: RefObject<HTMLElement | null>; floorSelector?: string }) {
  const show = useAccount()?.account.companion?.show === true;
  const view = useCompanionView(show);
  if (!show || !view.data || view.data.features.companion !== 'open' || !view.data.settings.enabled) return null;
  return <Stage screen={screen} containerRef={containerRef} floorRef={floorRef} floorSelector={floorSelector} view={view.data} />;
}
