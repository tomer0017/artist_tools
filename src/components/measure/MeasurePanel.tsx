import { useState, useCallback } from 'react';
import { useProject } from '@/hooks/useProjectStore';
import { distanceBetween } from '@/types/project';
import {
  Trash2, Download, FileJson, FilePlus, Eye, EyeOff,
  ChevronDown, ChevronRight, Pencil,
} from 'lucide-react';

export default function MeasurePanel() {
  const {
    measurements, updateMeasurement, deleteMeasurement, selectedLineId, setSelectedLineId,
    layers, activeLayerId, setActiveLayerId, toggleLayerVisibility,
    calibration, clearAllLines, newProject, exportProjectJSON, image,
  } = useProject();

  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [labelValue, setLabelValue] = useState('');
  const [layersOpen, setLayersOpen] = useState(true);
  const [linesOpen, setLinesOpen] = useState(true);

  const getRealSize = useCallback((line: typeof measurements[0]) => {
    if (!calibration) return '—';
    const calDist = distanceBetween(calibration.start, calibration.end);
    if (calDist === 0) return '—';
    const scale = calibration.realWorldSize / calDist;
    return (distanceBetween(line.start, line.end) * scale).toFixed(1) + ' ' + calibration.unit;
  }, [calibration]);

  const startEditLabel = (line: typeof measurements[0]) => {
    setEditingLabel(line.id);
    setLabelValue(line.label);
  };

  const commitLabel = () => {
    if (editingLabel) {
      updateMeasurement(editingLabel, { label: labelValue });
      setEditingLabel(null);
    }
  };

  const handleExportPNG = useCallback(() => {
    if (!image) return;
    const canvas = document.createElement('canvas');
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      // Draw lines
      measurements.forEach(line => {
        ctx.beginPath();
        ctx.moveTo(line.start.x, line.start.y);
        ctx.lineTo(line.end.x, line.end.y);
        ctx.strokeStyle = line.color;
        ctx.lineWidth = 2;
        ctx.stroke();
        // Label
        const mx = (line.start.x + line.end.x) / 2;
        const my = (line.start.y + line.end.y) / 2;
        ctx.font = '14px sans-serif';
        ctx.fillStyle = line.color;
        ctx.textAlign = 'center';
        ctx.fillText(line.label || getRealSize(line), mx, my - 8);
      });
      const link = document.createElement('a');
      link.download = 'studio-companion-export.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    img.src = image;
  }, [image, measurements, getRealSize]);

  const handleExportJSON = useCallback(() => {
    const json = exportProjectJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = 'studio-companion-project.json';
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }, [exportProjectJSON]);

  const handleNew = () => {
    if (confirmNew) { newProject(); setConfirmNew(false); }
    else setConfirmNew(true);
  };

  const handleClear = () => {
    if (confirmClear) { clearAllLines(); setConfirmClear(false); }
    else setConfirmClear(true);
  };

  return (
    <div className="w-full lg:w-56 panel-surface border-t lg:border-t-0 lg:border-l border-border overflow-y-auto p-3 space-y-3 text-xs shrink-0 max-h-60 lg:max-h-none">
      {/* Layers */}
      <section>
        <button onClick={() => setLayersOpen(!layersOpen)}
          className="flex items-center gap-1 text-muted-foreground font-medium uppercase tracking-wider mb-1.5 w-full">
          {layersOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Layers
        </button>
        {layersOpen && (
          <div className="space-y-0.5">
            {layers.map(layer => (
              <div key={layer.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${activeLayerId === layer.id ? 'bg-secondary' : 'hover:bg-secondary/50'}`}
                onClick={() => setActiveLayerId(layer.id)}>
                <button onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
                  className="text-muted-foreground hover:text-foreground">
                  {layer.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                </button>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: layer.color }} />
                <span className={`truncate ${activeLayerId === layer.id ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {layer.name}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Lines list */}
      <section>
        <button onClick={() => setLinesOpen(!linesOpen)}
          className="flex items-center gap-1 text-muted-foreground font-medium uppercase tracking-wider mb-1.5 w-full">
          {linesOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Lines ({measurements.length})
        </button>
        {linesOpen && (
          <div className="space-y-0.5 max-h-40 overflow-y-auto">
            {measurements.length === 0 && (
              <p className="text-muted-foreground italic px-2">No measurements yet</p>
            )}
            {measurements.map(line => (
              <div key={line.id}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer transition-colors group ${selectedLineId === line.id ? 'bg-secondary' : 'hover:bg-secondary/50'}`}
                onClick={() => setSelectedLineId(line.id)}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: line.color }} />
                {editingLabel === line.id ? (
                  <input value={labelValue} onChange={(e) => setLabelValue(e.target.value)}
                    onBlur={commitLabel} onKeyDown={(e) => e.key === 'Enter' && commitLabel()}
                    className="flex-1 bg-secondary px-1 py-0.5 text-foreground rounded text-xs focus:outline-none"
                    autoFocus />
                ) : (
                  <span className="flex-1 truncate text-muted-foreground">
                    {line.label || getRealSize(line)}
                  </span>
                )}
                <button onClick={(e) => { e.stopPropagation(); startEditLabel(line); }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground">
                  <Pencil className="w-3 h-3" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); deleteMeasurement(line.id); }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Actions */}
      <section className="space-y-1.5 pt-2 border-t border-border">
        <button onClick={handleExportPNG}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors">
          <Download className="w-3.5 h-3.5" /> Export PNG
        </button>
        <button onClick={handleExportJSON}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors">
          <FileJson className="w-3.5 h-3.5" /> Export JSON
        </button>
        <button onClick={handleClear}
          className={`flex items-center gap-2 w-full px-2 py-1.5 rounded transition-colors ${confirmClear ? 'text-destructive bg-destructive/10' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}`}
          onBlur={() => setConfirmClear(false)}>
          <Trash2 className="w-3.5 h-3.5" /> {confirmClear ? 'Confirm clear?' : 'Clear all lines'}
        </button>
        <button onClick={handleNew}
          className={`flex items-center gap-2 w-full px-2 py-1.5 rounded transition-colors ${confirmNew ? 'text-destructive bg-destructive/10' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}`}
          onBlur={() => setConfirmNew(false)}>
          <FilePlus className="w-3.5 h-3.5" /> {confirmNew ? 'Confirm new?' : 'New project'}
        </button>
      </section>
    </div>
  );
}
