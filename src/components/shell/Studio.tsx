'use client';

import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SaveMediaProvider } from '@/components/common/SaveMedia';
import { ProjectProvider, useProject } from '@/hooks/useProjectStore';
import { useIsMobile } from '@/hooks/use-mobile';
import type { TabId, ViewId } from '@/types/project';
import MeasureTab from '@/components/measure/MeasureTab';
import ValueTab from '@/components/value/ValueTab';
import ColorTab from '@/components/color/ColorTab';
import GridTab from '@/components/grid/GridTab';
import HomeScreen from '@/components/shell/HomeScreen';
import ProfileScreen from '@/components/shell/ProfileScreen';
import PlansScreen from '@/components/shell/PlansScreen';
import ToolLocked from '@/components/shell/ToolLocked';
import { ToolIntroHost } from '@/components/shell/ToolIntro';
import { ToolOpenTracker } from '@/components/shell/ToolOpenTracker';
// Small, outside Learn's lazy code: the way back from a tool to the lesson that opened it (ADR-0019).
import ReturnBar from '@/components/learn/ReturnBar';
import { BottomNav, TopNav } from '@/components/shell/AppNav';
import { isTool, pathForView, viewFromPathname } from '@/components/shell/tools';
import { OnboardingProvider, OnboardingHost } from '@/onboarding';
import { useToolAllowed } from '@/components/shell/account';

// Compare Art (with its gifenc dependency) is code-split so it never weighs down
// the initial load of the other workspaces.
const CompareArt = lazy(() => import('@/features/compare-art/CompareArt'));
// Learn (ADR-0018) is loaded only when it is opened: most accounts never see it.
const LearnView = lazy(() => import('@/components/learn/LearnView'));

const queryClient = new QueryClient();

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

// Keeps the URL (/app/measure, /app/study…) and the store's activeTab in step,
// in both directions: navigation links change the URL, while a tool can still
// hand off with setActiveTab (e.g. Measure → "use this color in Color").
function useViewRouting() {
  const pathname = usePathname();
  const router = useRouter();
  const { activeTab, setActiveTab } = useProject();
  const urlView = viewFromPathname(pathname);
  const activeRef = useRef(activeTab);
  activeRef.current = activeTab;
  // A URL-driven change the store hasn't caught up with yet; while set, the
  // store → URL direction must not "correct" the URL back.
  const pending = useRef<ViewId | null>(null);

  useEffect(() => {
    if (urlView === null) {
      router.replace(pathForView('home'));
      return;
    }
    if (urlView === activeRef.current) return;
    pending.current = urlView;
    setActiveTab(urlView);
  }, [urlView, router, setActiveTab]);

  useEffect(() => {
    if (pending.current !== null) {
      if (activeTab === pending.current) pending.current = null;
      return;
    }
    if (urlView !== null && activeTab !== urlView) router.push(pathForView(activeTab));
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
 * history, the colour being explored). A tool the account may no longer use
 * stays hidden the same way (its work kept, nothing usable) and is never
 * mounted if it was not open already.
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
  const t = useTranslations('studio');
  const { activeTab } = useProject();
  const isMobile = useIsMobile();
  const typing = useTypingFocus();
  useAppHeight();
  useViewRouting();
  // The server's latest answer for this account (src/server/entitlements.ts):
  // a tool opens only if its plan includes it; otherwise its place shows why
  // it is locked, however it was reached (a link, the address bar, a reload,
  // a hand-off from another tool, a tab left open while access changed).
  const allowed = useToolAllowed();
  const open = (tool: TabId) => activeTab === tool && allowed(tool);
  const locked = isTool(activeTab) && !allowed(activeTab) ? activeTab : null;

  return (
    <div
      className="flex flex-col overflow-hidden bg-background"
      style={{ height: 'var(--app-height, 100vh)', paddingTop: 'env(safe-area-inset-top)' }}
    >
      <OnboardingHost />
      <ToolIntroHost />
      <ToolOpenTracker />
      {!isMobile && <TopNav />}
      <ReturnBar />
      {/* min-w-0 on every tool root: a flex item otherwise grows to its
          content (e.g. a full-resolution image) and pushes controls offscreen. */}
      <main className="flex min-h-0 min-w-0 flex-1 [&>*]:min-w-0">
        {activeTab === 'home' && <HomeScreen />}
        {activeTab === 'profile' && <ProfileScreen />}
        {activeTab === 'plans' && <PlansScreen />}
        {activeTab === 'learn' && (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{t('loadingLearn')}</div>}>
            <LearnView />
          </Suspense>
        )}
        {/* Measure keeps all of its work in the persisted project store and
            listens for keyboard shortcuts on window, so it mounts only while
            visible rather than being kept alive. Grid is fully persisted too. */}
        {open('measure') && <MeasureTab />}
        {open('grid') && <GridTab />}
        <KeepAlive active={open('value')}><ValueTab /></KeepAlive>
        <KeepAlive active={open('color')}><ColorTab /></KeepAlive>
        <KeepAlive active={open('compare')}>
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                {t('loadingCompare')}
              </div>
            }
          >
            <CompareArt />
          </Suspense>
        </KeepAlive>
        {locked && <ToolLocked key={locked} tool={locked} />}
      </main>
      {isMobile && !typing && <BottomNav />}
    </div>
  );
}

/**
 * The whole studio: Home, every tool, the account and plans pages, with the
 * providers they share. The account (AccountProvider) is provided by the
 * layout around it, so that every page can hand it a fresh copy.
 */
export default function Studio() {
  const t = useTranslations('studio');
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {/* Short notes over the page, such as a lesson's "Marked as done … Undo" (in the page's language and direction). */}
        <Sonner containerAriaLabel={t('notifications')} />
        <SaveMediaProvider>
          <ProjectProvider>
            <OnboardingProvider>
              <Workspace />
            </OnboardingProvider>
          </ProjectProvider>
        </SaveMediaProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
