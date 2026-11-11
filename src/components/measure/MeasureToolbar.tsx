import { useTranslations } from 'use-intl';
import { useProject } from '@/hooks/useProjectStore';
import {
  MousePointer, Crosshair, Ruler, Undo2, Redo2,
  Eye, EyeOff, Maximize, Pipette, Hand,
} from 'lucide-react';
import ImageUploader from '@/components/common/ImageUploader';
import { LINE_COLORS } from '@/types/project';

interface Props {
  onResetView: () => void;
  mobile?: boolean;
}

export default function MeasureToolbar({ onResetView, mobile = false }: Props) {
  const t = useTranslations('measureTool');
  const {
    image, setImage, mode, setMode, lineColor, setLineColor,
    showMeasurements, toggleMeasurements,
    undo, redo, calibration,
    isImageLoading, beginImageUpload, setImageLoadError,
  } = useProject();

  const separatorClass = mobile
    ? 'basis-full h-px bg-border my-1'
    : 'w-px h-5 lg:w-5 lg:h-px bg-border';

  return (
    <div data-onboarding="measure-tools" className={mobile
      ? 'flex flex-wrap items-center gap-1.5 p-3 toolbar-surface border-b border-border shrink-0'
      : 'flex flex-row lg:flex-col items-center gap-1 p-1.5 toolbar-surface border-e border-border lg:w-11 shrink-0 overflow-x-auto lg:overflow-x-visible'}>
      <ImageUploader
        onImageLoad={setImage}
        compact
        disabled={isImageLoading}
        onUploadStart={beginImageUpload}
        onUploadError={(msg) => setImageLoadError(msg)}
      />

      {image && (
        <>
          <div className={separatorClass} />

          <button onClick={() => setMode('select')}
            className={`btn-tool ${mobile ? 'h-10 w-10' : ''} ${mode === 'select' ? 'active' : ''}`} title={t('shared.select')}>
            <MousePointer className="w-4 h-4" />
          </button>

          <button onClick={() => setMode('calibrate')}
            className={`btn-tool ${mobile ? 'h-10 w-10' : ''} ${mode === 'calibrate' ? 'active' : ''}`} title={t('toolbar.calibrate')}>
            <Crosshair className="w-4 h-4" />
          </button>

          <button onClick={() => setMode('measure')}
            className={`btn-tool ${mobile ? 'h-10 w-10' : ''} ${mode === 'measure' ? 'active' : ''} ${!calibration ? 'opacity-40 pointer-events-none' : ''}`}
            title={t('toolbar.measure')}>
            <Ruler className="w-4 h-4" />
          </button>

          <button onClick={() => setMode('pan')}
            className={`btn-tool ${mobile ? 'h-10 w-10' : ''} ${mode === 'pan' ? 'active' : ''}`}
            title={t('toolbar.pan')}>
            <Hand className="w-4 h-4" />
          </button>

          <button onClick={() => setMode('eyedropper')}
            className={`btn-tool ${mobile ? 'h-10 w-10' : ''} ${mode === 'eyedropper' ? 'active' : ''}`}
            title={t('toolbar.colorSampler')}>
            <Pipette className="w-4 h-4" />
          </button>

          <div className={separatorClass} />

          <button onClick={undo} className={`btn-tool ${mobile ? 'h-10 w-10' : ''}`} title={t('shared.undo')}>
            <Undo2 className="w-4 h-4 rtl:-scale-x-100" />
          </button>
          <button onClick={redo} className={`btn-tool ${mobile ? 'h-10 w-10' : ''}`} title={t('shared.redo')}>
            <Redo2 className="w-4 h-4 rtl:-scale-x-100" />
          </button>

          <div className={separatorClass} />

          <button onClick={toggleMeasurements}
            className={`btn-tool ${mobile ? 'h-10 w-10' : ''} ${showMeasurements ? '' : 'opacity-40'}`}
            title={showMeasurements ? t('shared.hideMeasurements') : t('shared.showMeasurements')}>
            {showMeasurements ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button onClick={onResetView} className={`btn-tool ${mobile ? 'h-10 w-10' : ''}`} title={t('toolbar.resetView')}>
            <Maximize className="w-4 h-4" />
          </button>

          <div className={separatorClass} />

          {/* Line color */}
          <div className={mobile ? 'flex flex-wrap gap-1' : 'flex flex-row lg:flex-col gap-0.5'}>
            {LINE_COLORS.map(c => (
              <button key={c} onClick={() => setLineColor(c)}
                className={`${mobile ? 'w-8 h-8' : 'w-5 h-5'} rounded-sm border transition-all ${lineColor === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}