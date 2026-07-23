import { useCallback } from 'react';
import { useProject } from '@/hooks/useProjectStore';
import MeasureIntroModal from './MeasureIntroModal';
import MeasureScaleSuccess from './MeasureScaleSuccess';
import { useMeasureIntro, useScaleSuccess } from './useMeasureIntro';

/**
 * Desktop wiring for the redesigned Measure onboarding. Rendered only on the
 * desktop canvas path (so its hooks never double up with the mobile surface),
 * it shows the Step-1 intro once and the Step-3 success card when a scale is
 * first set. "Draw my reference line" simply switches the canvas into calibrate
 * mode — the on-canvas helper then carries Step 2.
 */
export default function MeasureDesktopOnboarding() {
  const { setMode } = useProject();
  const { open: introOpen, close: closeIntro } = useMeasureIntro();
  const { open: successOpen, sizeLabel, dismiss } = useScaleSuccess();

  const beginReferenceLine = useCallback(() => {
    closeIntro();
    setMode('calibrate');
  }, [closeIntro, setMode]);

  return (
    <>
      <MeasureIntroModal open={introOpen} onStart={beginReferenceLine} onClose={closeIntro} />
      <MeasureScaleSuccess open={successOpen} sizeLabel={sizeLabel} onDone={dismiss} />
    </>
  );
}
