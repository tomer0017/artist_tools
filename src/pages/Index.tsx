import { useEffect } from 'react';
import Header from '@/components/layout/Header';
import { ProjectProvider, useProject } from '@/hooks/useProjectStore';
import MeasureTab from '@/components/measure/MeasureTab';
import ValueTab from '@/components/value/ValueTab';
import ColorTab from '@/components/color/ColorTab';
import GridTab from '@/components/grid/GridTab';

function Workspace() {
  const { activeTab } = useProject();

  // iOS Safari/Chrome: keep an accurate viewport height that accounts for
  // dynamic toolbars and the on-screen keyboard. Avoids 100vh layout jumps
  // after focusing inputs (e.g. reference size) on touch devices.
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

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{ height: 'var(--app-height, 100vh)' }}
    >
      <Header />
      <main className="flex-1 flex min-h-0">
        {activeTab === 'measure' && <MeasureTab />}
        {activeTab === 'value' && <ValueTab />}
        {activeTab === 'color' && <ColorTab />}
        {activeTab === 'grid' && <GridTab />}
      </main>
    </div>
  );
}

export default function Index() {
  return (
    <ProjectProvider>
      <Workspace />
    </ProjectProvider>
  );
}
