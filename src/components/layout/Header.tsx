import { useProject } from '@/hooks/useProjectStore';
import { Ruler, Palette, Sun, Grid3X3, Layers2 } from 'lucide-react';
import type { TabId } from '@/types/project';
import { HelpButton } from '@/onboarding';
import { MeasureHelpButton } from '@/components/measure/onboarding';

const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'measure', label: 'Measure', icon: <Ruler className="w-4 h-4" /> },
  { id: 'value', label: 'Value', icon: <Sun className="w-4 h-4" /> },
  { id: 'color', label: 'Color', icon: <Palette className="w-4 h-4" /> },
  { id: 'grid', label: 'Grid', icon: <Grid3X3 className="w-4 h-4" /> },
  { id: 'compare', label: 'Compare', icon: <Layers2 className="w-4 h-4" /> },
];

export default function Header() {
  const { activeTab, setActiveTab } = useProject();

  return (
    <header className="flex items-center justify-between px-4 h-12 border-b border-border toolbar-surface shrink-0">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold tracking-wide text-foreground">
          <span className="text-primary">●</span> Studio Companion
        </h1>
      </div>
      <nav className="flex items-center gap-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`tab-button flex items-center gap-1.5 ${activeTab === tab.id ? 'active' : ''}`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
        {/* Context-aware replay: teaches whichever tool is open, in under a minute.
            Measure has its own workflow-driven onboarding, so it replays through
            its dedicated button; every other tool uses the generic tour. */}
        {activeTab === 'measure'
          ? <MeasureHelpButton className="ml-1" />
          : <HelpButton toolId={activeTab} className="ml-1" />}
      </nav>
    </header>
  );
}
