import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ProjectProvider, useProject } from '@/hooks/useProjectStore';
import { useIsMobile } from '@/hooks/use-mobile';
import type { ViewId } from '@/types/project';
import MeasureTab from '@/components/measure/MeasureTab';
import ValueTab from '@/components/value/ValueTab';
import ColorTab from '@/components/color/ColorTab';
import GridTab from '@/components/grid/GridTab';
import HomeScreen from '@/components/shell/HomeScreen';
import { BottomNav, TopNav } from '@/components/shell/AppNav';
import { pathForView, viewFromPath } from '@/components/shell/tools';
import { OnboardingProvider, OnboardingHost } from '@/onboarding';

// Compare Art (with its gifenc dependency) is code-split so it never weighs down
// the initial load of the other workspaces.
const CompareArt = lazy(() => import('@/features/compare-art/CompareArt'));

// iOS Safari/Chrome: keep an accurate viewport height that accounts for
// dynamic toolbars and the on-screen keyboard. Avoids 100vh layout jumps
// after focusing inputs (e.g. reference size) on touch devices.
function useAppHeight() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const setAppHeight = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${h}px`);
    };
    setAppHeight();
    const vv = window.visualViewport;
    window.addEventListener('resize', setAppHeight);
    window.addEventListener('orientationchange', setAppHeight);
    vv?.addEventListener('resize', setAppHeight);
    vv?.addEventListener('scroll', setAppHeight);
    return () => {
      window.removeEventListener('resize', setAppHeight);
      window.removeEventListener('orientationchange', setAppHeight);
      vv?.removeEventListener('resize', setAppHeight);
      vv?.removeEventListener('scroll', setAppHeight);
    };
  }, []);
}

// Keeps the URL (#/measure, #/study…) and the store's activeTab in step, in
// both directions: navigation links change the URL, while a tool can still
// hand off with setActiveTab (e.g. Measure → "use this color in Color").
function useViewRouting() {
  const { view: segment } = useParams();
  const navigate = useNavigate();
  const { activeTab, setActiveTab } = useProject();
  const urlView = viewFromPath(segment);
  const activeRef = useRef(activeTab);
  activeRef.current = activeTab;
  // A URL-driven change the store hasn't caught up with yet; while set, the
  // store → URL direction must not "correct" the URL back.
  const pending = useRef<ViewId | null>(null);

  useEffect(() => {
    if (urlView === null) {
      navigate('/', { replace: true });
      return;
    }
    if (urlView === activeRef.current) return;
    pending.current = urlView;
    setActiveTab(urlView);
  }, [urlView, navigate, setActiveTab]);

  useEffect(() => {
    if (pending.current !== null) {
      if (activeTab === pending.current) pending.current = null;
      return;
    }
    if (urlView !== null && activeTab !== urlView) navigate(pathForView(activeTab));
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps
}

// The on-screen keyboard already takes half a phone screen; the bottom nav
// should give way while the artist is typing (e.g. a scale length).
function useTypingFocus() {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const isTextField = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
      if (el.tagName !== 'INPUT') return false;
      const type = (el as HTMLInputElement).type;
      return !['range', 'checkbox', 'radio', 'button', 'submit', 'file', 'color'].includes(type);
    };
    const onIn = (e: FocusEvent) => setTyping(isTextField(e.target));
    const onOut = () => setTyping(false);
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);
  return typing;
}

/**
 * Mounts a tool the first time it is opened and then keeps it alive while
 * hidden, so switching tools never throws away in-memory work (a Study image
 * loaded just for that tool, Compare's full-resolution images and undo
 * history, the colour being explored).
 */
function KeepAlive({ active, children }: { active: boolean; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(active);
  useEffect(() => {
    if (active) setMounted(true);
  }, [active]);
  if (!mounted && !active) return null;
  return (
    <div className={active ? 'flex min-h-0 min-w-0 flex-1 [&>*]:min-w-0' : 'hidden'} aria-hidden={!active || undefined}>
      {children}
    </div>
  );
}

function Workspace() {
  const { activeTab } = useProject();
  const isMobile = useIsMobile();
  const typing = useTypingFocus();
  useAppHeight();
  useViewRouting();

  return (
    <div
      className="flex flex-col overflow-hidden bg-background"
      style={{ height: 'var(--app-height, 100vh)', paddingTop: 'env(safe-area-inset-top)' }}
    >
      <OnboardingHost />
      {!isMobile && <TopNav />}
      {/* min-w-0 on every tool root: a flex item otherwise grows to its
          content (e.g. a full-resolution image) and pushes controls offscreen. */}
      <main className="flex min-h-0 min-w-0 flex-1 [&>*]:min-w-0">
        {activeTab === 'home' && <HomeScreen />}
        {/* Measure keeps all of its work in the persisted project store and
            listens for keyboard shortcuts on window, so it mounts only while
            visible rather than being kept alive. Grid is fully persisted too. */}
        {activeTab === 'measure' && <MeasureTab />}
        {activeTab === 'grid' && <GridTab />}
        <KeepAlive active={activeTab === 'value'}><ValueTab /></KeepAlive>
        <KeepAlive active={activeTab === 'color'}><ColorTab /></KeepAlive>
        <KeepAlive active={activeTab === 'compare'}>
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                Loading Compare…
              </div>
            }
          >
            <CompareArt />
          </Suspense>
        </KeepAlive>
      </main>
      {isMobile && !typing && <BottomNav />}
    </div>
  );
}

export default function Index() {
  return (
    <ProjectProvider>
      <OnboardingProvider>
        <Workspace />
      </OnboardingProvider>
    </ProjectProvider>
  );
}
