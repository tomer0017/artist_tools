import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import {
  type Point, type MeasurementLine, type CalibrationLine, type Layer,
  type ValueSettings, type InteractionMode, type TabId, type ProjectData,
  type SampledColor, type GridSettings,
  DEFAULT_LAYERS, DEFAULT_VALUE_SETTINGS, DEFAULT_GRID_SETTINGS, LAYER_COLORS, genId,
} from '@/types/project';

const STORAGE_KEY = 'painter-studio-project';

interface StoreState {
  activeTab: TabId;
  image: string | null;
  calibration: CalibrationLine | null;
  measurements: MeasurementLine[];
  layers: Layer[];
  activeLayerId: string;
  selectedLineId: string | null;
  mode: InteractionMode;
  lineColor: string;
  showMeasurements: boolean;
  valueSettings: ValueSettings;
  sampledColors: SampledColor[];
  zoom: number;
  panOffset: Point;
  gridSettings: GridSettings;
  // Grid's own working image (see setGridImage / initGridImageFromReference).
  gridImage: string | null;
  gridImageInitialized: boolean;
  isImageLoading: boolean;
  imageLoadError: string | null;
}

interface StoreActions {
  setActiveTab: (tab: TabId) => void;
  setImage: (img: string | null) => void;
  setCalibration: (cal: CalibrationLine | null) => void;
  addMeasurement: (line: MeasurementLine) => void;
  updateMeasurement: (id: string, updates: Partial<MeasurementLine>) => void;
  deleteMeasurement: (id: string) => void;
  setMeasurements: (lines: MeasurementLine[]) => void;
  setSelectedLineId: (id: string | null) => void;
  setMode: (mode: InteractionMode) => void;
  setLineColor: (color: string) => void;
  toggleMeasurements: () => void;
  toggleLayerVisibility: (layerId: string) => void;
  setActiveLayerId: (id: string) => void;
  addLayer: (name: string) => void;
  deleteLayer: (layerId: string) => void;
  setValueSettings: (updates: Partial<ValueSettings>) => void;
  addSampledColor: (color: SampledColor) => void;
  removeSampledColor: (id: string) => void;
  clearSampledColors: () => void;
  setZoom: (zoom: number) => void;
  setPanOffset: (offset: Point) => void;
  undo: () => void;
  redo: () => void;
  clearAllLines: () => void;
  newProject: () => void;
  exportProjectJSON: () => string;
  setGridSettings: (updates: Partial<GridSettings>) => void;
  // Set the Grid's working image directly (Upload / Replace inside Grid). Never
  // touches the main reference image.
  setGridImage: (img: string | null) => void;
  // One-time initialization of the Grid image from the main reference, so Grid
  // never opens empty when a usable reference already exists. No-op once the
  // Grid has its own image.
  initGridImageFromReference: () => void;
  setImageLoaded: () => void;
  setImageLoadError: (error: string | null) => void;
  clearImageLoadError: () => void;
  beginImageUpload: () => void;
}

type Store = StoreState & StoreActions;

const ProjectContext = createContext<Store | null>(null);

function loadFromStorage(): Partial<StoreState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as ProjectData & Partial<StoreState>;
    return {
      image: data.image || null,
      calibration: data.calibration || null,
      measurements: data.measurements || [],
      layers: data.layers || DEFAULT_LAYERS,
      activeLayerId: data.activeLayerId || 'general',
      valueSettings: data.valueSettings || DEFAULT_VALUE_SETTINGS,
      sampledColors: data.sampledColors || [],
      gridSettings: data.gridSettings || { ...DEFAULT_GRID_SETTINGS },
      gridImage: data.gridImage ?? null,
      gridImageInitialized: data.gridImageInitialized ?? false,
    };
  } catch (error) {
    console.error('[useProjectStore] Failed to read project from localStorage:', error);
    return {};
  }
}

function saveToStorage(state: StoreState) {
  try {
    const data: ProjectData = {
      image: state.image,
      calibration: state.calibration,
      measurements: state.measurements,
      layers: state.layers,
      activeLayerId: state.activeLayerId,
      valueSettings: state.valueSettings,
      sampledColors: state.sampledColors,
      gridSettings: state.gridSettings,
      gridImage: state.gridImage,
      gridImageInitialized: state.gridImageInitialized,
      savedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    // storage full or unavailable (e.g. private browsing quota)
    console.error('[useProjectStore] Failed to save project to localStorage:', error);
  }
}

const initialState: StoreState = {
  activeTab: 'measure',
  image: null,
  calibration: null,
  measurements: [],
  layers: [...DEFAULT_LAYERS],
  activeLayerId: 'general',
  selectedLineId: null,
  mode: 'idle',
  lineColor: '#8b5cf6',
  showMeasurements: true,
  valueSettings: { ...DEFAULT_VALUE_SETTINGS },
  sampledColors: [],
  zoom: 1,
  panOffset: { x: 0, y: 0 },
  gridSettings: { ...DEFAULT_GRID_SETTINGS },
  gridImage: null,
  gridImageInitialized: false,
  isImageLoading: false,
  imageLoadError: null,
};

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const saved = useRef(loadFromStorage());

  const [activeTab, setActiveTab] = useState<TabId>(saved.current.activeTab as TabId || 'measure');
  const [image, setImageRaw] = useState<string | null>(saved.current.image || null);
  const [calibration, setCalibration] = useState<CalibrationLine | null>(saved.current.calibration || null);
  const [measurements, setMeasurements] = useState<MeasurementLine[]>(saved.current.measurements || []);
  const [layers, setLayers] = useState<Layer[]>(saved.current.layers || [...DEFAULT_LAYERS]);
  const [activeLayerId, setActiveLayerId] = useState(saved.current.activeLayerId || 'general');
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [mode, setMode] = useState<InteractionMode>(image ? 'measure' : 'idle');
  const [lineColor, setLineColor] = useState('#8b5cf6');
  const [showMeasurements, setShowMeasurements] = useState(true);
  const [valueSettings, setValueSettingsRaw] = useState<ValueSettings>(saved.current.valueSettings || { ...DEFAULT_VALUE_SETTINGS });
  const [sampledColors, setSampledColors] = useState<SampledColor[]>(saved.current.sampledColors || []);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState<Point>({ x: 0, y: 0 });
  const [gridSettings, setGridSettingsRaw] = useState<GridSettings>(saved.current.gridSettings || { ...DEFAULT_GRID_SETTINGS });
  const [gridImage, setGridImageRaw] = useState<string | null>(saved.current.gridImage ?? null);
  const [gridImageInitialized, setGridImageInitialized] = useState<boolean>(saved.current.gridImageInitialized ?? false);
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [imageLoadError, setImageLoadError] = useState<string | null>(null);

  // Undo/redo stacks
  const undoStack = useRef<MeasurementLine[][]>([]);
  const redoStack = useRef<MeasurementLine[][]>([]);

  // Auto-save
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveToStorage({
        activeTab, image, calibration, measurements, layers,
        activeLayerId, selectedLineId, mode, lineColor,
        showMeasurements, valueSettings, sampledColors, zoom, panOffset, gridSettings,
        gridImage, gridImageInitialized,
        isImageLoading, imageLoadError,
      });
    }, 300);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [image, calibration, measurements, layers, activeLayerId, valueSettings, sampledColors, gridSettings, gridImage, gridImageInitialized, isImageLoading, imageLoadError]);

  const pushUndo = useCallback(() => {
    undoStack.current.push([...measurements]);
    redoStack.current = [];
  }, [measurements]);

  const setImage = useCallback((img: string | null) => {
    setImageRaw(img);
    setIsImageLoading(!!img);
    setImageLoadError(null);
    if (img) setMode('calibrate');
    else setMode('idle');
  }, []);

  const setImageLoaded = useCallback(() => setIsImageLoading(false), []);
  const clearImageLoadError = useCallback(() => {
    setImageLoadError(null);
    setIsImageLoading(false);
  }, []);
  // Called synchronously from the file picker — before FileReader/decoding —
  // so the loader appears instantly after the user selects a file.
  const beginImageUpload = useCallback(() => {
    setImageLoadError(null);
    setIsImageLoading(true);
  }, []);

  const addMeasurement = useCallback((line: MeasurementLine) => {
    pushUndo();
    setMeasurements(prev => [...prev, line]);
  }, [pushUndo]);

  const updateMeasurement = useCallback((id: string, updates: Partial<MeasurementLine>) => {
    setMeasurements(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  }, []);

  const deleteMeasurement = useCallback((id: string) => {
    pushUndo();
    setMeasurements(prev => prev.filter(m => m.id !== id));
    setSelectedLineId(null);
  }, [pushUndo]);

  const toggleMeasurements = useCallback(() => setShowMeasurements(v => !v), []);

  const toggleLayerVisibility = useCallback((layerId: string) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, visible: !l.visible } : l));
  }, []);

  const addLayer = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = genId();
    // Cycle through the shared palette by position so new layers get distinct,
    // on-brand colors without inventing a new palette.
    setLayers(prev => [...prev, {
      id, name: trimmed, visible: true,
      color: LAYER_COLORS[prev.length % LAYER_COLORS.length],
    }]);
    setActiveLayerId(id);
  }, []);

  const deleteLayer = useCallback((layerId: string) => {
    // Never delete the last remaining layer (UI hides the control too).
    if (layers.length <= 1) {
      console.warn('[useProjectStore] Refused to delete the last remaining layer:', layerId);
      return;
    }
    const remaining = layers.filter(l => l.id !== layerId);
    // Move any lines on the deleted layer to a fallback (prefer the general
    // layer, else the first remaining one) instead of dropping user data.
    const fallback = remaining.find(l => l.id === 'general') ?? remaining[0];
    setMeasurements(prev => prev.map(m => m.layerId === layerId ? { ...m, layerId: fallback.id } : m));
    setLayers(remaining);
    if (activeLayerId === layerId) setActiveLayerId(fallback.id);
  }, [layers, activeLayerId]);

  const setValueSettings = useCallback((updates: Partial<ValueSettings>) => {
    setValueSettingsRaw(prev => ({ ...prev, ...updates }));
  }, []);

  const addSampledColor = useCallback((color: SampledColor) => {
    setSampledColors(prev => {
      if (prev.some(c => c.hex === color.hex)) return prev;
      return [...prev, color];
    });
  }, []);

  const removeSampledColor = useCallback((id: string) => {
    setSampledColors(prev => prev.filter(c => c.id !== id));
  }, []);

  const clearSampledColors = useCallback(() => {
    setSampledColors([]);
  }, []);

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    redoStack.current.push([...measurements]);
    setMeasurements(undoStack.current.pop()!);
  }, [measurements]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    undoStack.current.push([...measurements]);
    setMeasurements(redoStack.current.pop()!);
  }, [measurements]);

  const clearAllLines = useCallback(() => {
    pushUndo();
    setMeasurements([]);
    setCalibration(null);
    setSelectedLineId(null);
    setMode('calibrate');
  }, [pushUndo]);

  const newProject = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    setImageRaw(null);
    setCalibration(null);
    setMeasurements([]);
    setLayers([...DEFAULT_LAYERS]);
    setActiveLayerId('general');
    setSelectedLineId(null);
    setMode('idle');
    setValueSettingsRaw({ ...DEFAULT_VALUE_SETTINGS });
    setSampledColors([]);
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
    setGridSettingsRaw({ ...DEFAULT_GRID_SETTINGS });
    setGridImageRaw(null);
    setGridImageInitialized(false);
    setIsImageLoading(false);
    setImageLoadError(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('[useProjectStore] Failed to clear project from localStorage:', error);
    }
  }, []);

  const exportProjectJSON = useCallback(() => {
    const data: ProjectData = {
      image, calibration, measurements, layers,
      activeLayerId, valueSettings, sampledColors, gridSettings, savedAt: Date.now(),
    };
    return JSON.stringify(data, null, 2);
  }, [image, calibration, measurements, layers, activeLayerId, valueSettings, sampledColors, gridSettings]);

  const setGridSettings = useCallback((updates: Partial<GridSettings>) => {
    setGridSettingsRaw(prev => ({ ...prev, ...updates }));
  }, []);

  // Grid owns its own image. Setting it (Upload / Replace inside Grid) marks the
  // Grid document as initialized so it is never later overwritten by the main
  // reference — and it deliberately does NOT touch the main `image`.
  const setGridImage = useCallback((img: string | null) => {
    setGridImageRaw(img);
    setGridImageInitialized(true);
  }, []);

  // Copy the main reference into Grid exactly once, so Grid opens ready when a
  // reference already exists. After that the two documents are fully decoupled.
  const initGridImageFromReference = useCallback(() => {
    if (gridImageInitialized) return;
    if (!image) return; // nothing to seed yet — a later entry can still init
    setGridImageRaw(image);
    setGridImageInitialized(true);
  }, [gridImageInitialized, image]);

  const store: Store = {
    activeTab, setActiveTab,
    image, setImage,
    calibration, setCalibration,
    measurements, setMeasurements,
    layers, activeLayerId, setActiveLayerId,
    addLayer, deleteLayer,
    selectedLineId, setSelectedLineId,
    mode, setMode,
    lineColor, setLineColor,
    showMeasurements, toggleMeasurements,
    toggleLayerVisibility,
    valueSettings, setValueSettings,
    sampledColors, addSampledColor, removeSampledColor, clearSampledColors,
    zoom, setZoom,
    panOffset, setPanOffset,
    addMeasurement, updateMeasurement, deleteMeasurement,
    undo, redo,
    clearAllLines, newProject, exportProjectJSON,
    gridSettings, setGridSettings,
    gridImage, gridImageInitialized, setGridImage, initGridImageFromReference,
    isImageLoading, setImageLoaded,
    imageLoadError, setImageLoadError, clearImageLoadError,
    beginImageUpload,
  };

  return <ProjectContext.Provider value={store}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be inside ProjectProvider');
  return ctx;
}