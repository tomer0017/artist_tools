import * as React from "react";
import { useIsMobile } from "./use-mobile";

/**
 * Returns true when the device should use the mobile/touch Measure UX:
 * - small viewport (existing mobile breakpoint), OR
 * - touch-first device (iPad/tablet) with coarse pointer / no hover / touch points.
 * Desktop/laptop with a mouse keeps the desktop layout, even if resized small
 * the existing mobile breakpoint still triggers (responsive mode unchanged).
 */
export function useIsTouchOrMobile() {
  const isMobile = useIsMobile();
  const [isTouch, setIsTouch] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const coarse = window.matchMedia("(pointer: coarse)");
    const noHover = window.matchMedia("(hover: none)");
    const evaluate = () => {
      const maxTouch = navigator.maxTouchPoints ?? 0;
      setIsTouch((coarse.matches && noHover.matches) || maxTouch > 1);
    };
    evaluate();
    coarse.addEventListener("change", evaluate);
    noHover.addEventListener("change", evaluate);
    return () => {
      coarse.removeEventListener("change", evaluate);
      noHover.removeEventListener("change", evaluate);
    };
  }, []);

  return isMobile || isTouch;
}