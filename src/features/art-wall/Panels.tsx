// The four steps' controls: Artwork, Frame, Space (with lighting) and Preview
// & save. Options a plan does not include stay visible with a Pro mark;
// choosing one explains it (onLocked) instead of doing nothing.

import { useEffect, useState } from 'react';
import { Columns2, Copy, ImagePlus, Loader2, Plus, RotateCcw, RotateCw, Ruler, Undo2, X } from 'lucide-react';
import { useTranslations } from 'use-intl';
import ImageUploader from '@/components/common/ImageUploader';
import Slider from '@/components/common/Slider';
import { cropRatio, fitCrop } from './render/artwork';
import { SOFAS } from './render/room';
import { outerCm, quadAngle, quadMeta, quadWidth, rotateQuad, scaleQuad, defaultQuad, fittedQuad, centroid } from './placement';
import type { StoredImage } from './storage';
import type { WallState } from './useWallProject';
import {
  ASPECTS,
  EXPORT_PX,
  FINISHES,
  FRAME_TYPES,
  MAT_COLORS,
  ROOMS,
  SOFA_COLORS,
  SOFA_STYLES,
  WALL_COLORS,
  WALL_TEXTURES,
  aspectRatioOf,
  type AspectPreset,
  type CropSpec,
  type ExportShape,
  type FrameSpec,
  type FrameType,
  type LightTemp,
  type Pt,
  type SofaStyle,
  type SpaceMode,
  type WallProject,
  type WallTexture,
} from './types';
import { Chips, CmField, Section, Swatches, Toggle } from './ui';

export interface Access {
  premium: boolean;
  lighting: boolean;
  photo: boolean;
  compare: boolean;
  hires: boolean;
}

interface PanelProps {
  state: WallState;
  project: WallProject;
  access: Access;
  onLocked: (name: string) => void;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const ASPECT_KEYS: Record<AspectPreset, string> = { free: 'free', square: 'square', circle: 'circle', '4:5': 'r45', '3:4': 'r34', '2:3': 'r23', '16:9': 'r169', custom: 'custom' };

// ── 1. Artwork ──────────────────────────────────────────────────────────────
export function ArtworkPanel({ state, project, onLocked }: PanelProps) {
  const t = useTranslations('wallTool.artwork');
  const img = state.artImage;
  const crop = project.artwork.crop;
  const round = crop.aspect === 'circle';

  const setCrop = (next: CropSpec) =>
    state.update((p) => {
      const ratio = img ? cropRatio(img.width, img.height, next) : 1;
      const r = next.aspect === 'circle';
      return { ...p, artwork: { ...p.artwork, crop: next, heightCm: r ? p.artwork.widthCm : round1(p.artwork.widthCm / ratio) } };
    });
  const setAspect = (aspect: AspectPreset) => {
    if (!img) return;
    const next = { ...crop, aspect };
    setCrop(fitCrop(img.width, img.height, next, aspectRatioOf(next)));
  };
  const rotateBy = (deg: number) => {
    if (!img) return;
    let rotation = crop.rotation + deg;
    if (rotation > 180) rotation -= 360;
    if (rotation < -180) rotation += 360;
    const next = { ...crop, rotation, x: 0, y: 0, w: 1, h: 1 };
    setCrop(fitCrop(img.width, img.height, next, aspectRatioOf(next)));
  };
  const quarter = Math.round(crop.rotation / 90) * 90;
  const fine = crop.rotation - quarter;
  const ratio = img ? cropRatio(img.width, img.height, crop) : 1;

  return (
    <div className="space-y-6">
      <Section title={t('shape')}>
        <Chips<AspectPreset>
          label={t('shape')}
          columns={4}
          options={ASPECTS.map((a) => ({ id: a.id, label: t(`aspects.${ASPECT_KEYS[a.id]}` as 'aspects.free') }))}
          value={crop.aspect}
          onChange={setAspect}
          onLocked={onLocked}
        />
        {crop.aspect === 'custom' && (
          <div className="flex gap-2">
            <CmField id="wall-ratio-w" label={t('customW')} unit="" min={1} max={100} value={crop.custom.w} onChange={(w) => img && setCrop(fitCrop(img.width, img.height, { ...crop, custom: { ...crop.custom, w } }, w / crop.custom.h))} />
            <CmField id="wall-ratio-h" label={t('customH')} unit="" min={1} max={100} value={crop.custom.h} onChange={(h) => img && setCrop(fitCrop(img.width, img.height, { ...crop, custom: { ...crop.custom, h } }, crop.custom.w / h))} />
          </div>
        )}
      </Section>

      <Section title={t('rotate')}>
        <div className="flex gap-2">
          <button type="button" onClick={() => rotateBy(-90)} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-secondary/40 text-sm font-medium hover:bg-secondary">
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> {t('rotateLeft')}
          </button>
          <button type="button" onClick={() => rotateBy(90)} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-secondary/40 text-sm font-medium hover:bg-secondary">
            <RotateCw className="h-4 w-4" aria-hidden="true" /> {t('rotateRight')}
          </button>
        </div>
        <Slider label={t('straighten')} min={-45} max={45} step={0.5} value={fine} readout={`${fine > 0 ? '+' : ''}${round1(fine)}°`} onChange={(v) => img && setCrop({ ...crop, rotation: quarter + v })} onCommit={(v) => img && setCrop(fitCrop(img.width, img.height, { ...crop, rotation: quarter + v }, aspectRatioOf(crop)))} />
        <button type="button" onClick={() => img && setCrop({ ...crop, aspect: 'free', rotation: 0, x: 0, y: 0, w: 1, h: 1 })} className="flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline">
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> {t('reset')}
        </button>
      </Section>

      <Section title={t('size')} hint={t('sizeHint')}>
        {round ? (
          <CmField id="wall-diameter" label={t('diameter')} unit={t('cm')} value={project.artwork.widthCm} onChange={(d) => state.update((p) => ({ ...p, artwork: { ...p.artwork, widthCm: d, heightCm: d } }))} />
        ) : (
          <div className="flex gap-2">
            <CmField id="wall-width" label={t('width')} unit={t('cm')} value={project.artwork.widthCm} onChange={(w) => state.update((p) => ({ ...p, artwork: { ...p.artwork, widthCm: w, heightCm: round1(w / ratio) } }))} />
            <CmField id="wall-height" label={t('height')} unit={t('cm')} value={project.artwork.heightCm} onChange={(h) => state.update((p) => ({ ...p, artwork: { ...p.artwork, heightCm: h, widthCm: round1(h * ratio) } }))} />
          </div>
        )}
      </Section>

      <div className="flex flex-wrap items-center gap-2">
        <ImageUploader compact label={t('replace')} icon={<ImagePlus className="h-4 w-4" />} onImageLoad={(url) => void state.setArtwork(url)} disabled={state.busy} />
      </div>
      <SavedArtworks state={state} />
    </div>
  );
}

export function SavedArtworks({ state }: { state: WallState }) {
  const t = useTranslations('wallTool.artwork');
  const [items, setItems] = useState<StoredImage[]>([]);
  const current = state.project?.artwork.imageId;
  useEffect(() => {
    let alive = true;
    state.listArtworks().then((list) => alive && setItems(list));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  const others = items.filter((i) => i.id !== current).slice(0, 12);
  if (others.length === 0) return null;
  return (
    <Section title={t('saved')}>
      <p className="text-xs text-muted-foreground">{t('savedLead')}</p>
      <ul className="grid grid-cols-4 gap-2">
        {others.map((i) => (
          <li key={i.id}>
            <button type="button" onClick={() => state.pickSavedArtwork(i)} className="block aspect-square w-full overflow-hidden rounded-lg ring-1 ring-border hover:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local thumbnail data URL */}
              <img src={i.thumb} alt="" className="h-full w-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ── 2. Frame ────────────────────────────────────────────────────────────────
const finishBackground = (id: string) => {
  const f = FINISHES.find((x) => x.id === id)!;
  if (f.kind === 'wood') return `repeating-linear-gradient(94deg, ${f.base} 0 5px, ${f.dark}88 5px 5.5px, ${f.base} 6px 11px, ${f.light}aa 11px 11.5px, ${f.base} 12px 17px)`;
  if (f.kind === 'metal') return `linear-gradient(135deg, ${f.light}, ${f.base} 40%, ${f.dark} 70%, ${f.light})`;
  return `linear-gradient(135deg, ${f.light}, ${f.base} 60%, ${f.dark})`;
};

export function FramePanel({ state, project, access, onLocked }: PanelProps) {
  const t = useTranslations('wallTool.frame');
  const tc = useTranslations('wallTool.artwork');
  const frame = project.frame;
  const setFrame = (recipe: (f: FrameSpec) => FrameSpec) => state.update((p) => ({ ...p, frame: recipe(p.frame) }));
  const outer = outerCm(project);
  const round = project.artwork.crop.aspect === 'circle';
  return (
    <div className="space-y-6">
      <Section title={t('type')} hint={t(`typeHints.${frame.type}`)}>
        <Chips<FrameType>
          label={t('type')}
          columns={3}
          options={FRAME_TYPES.map((f) => ({ id: f.id, label: t(`types.${f.id}`), locked: f.pro && !access.premium }))}
          value={frame.type}
          onChange={(type) =>
            setFrame((f) => ({
              ...f,
              type,
              widthCm: type === 'floating' ? Math.min(f.widthCm, 1.6) : type === 'classic' && f.widthCm < 1.5 ? 2.5 : f.widthCm,
              depthCm: type === 'floating' ? Math.max(f.depthCm, 3.5) : f.depthCm,
            }))
          }
          onLocked={onLocked}
        />
      </Section>

      {frame.type !== 'frameless' && (
        <Section title={t('finish')}>
          <Swatches
            label={t('finish')}
            swatches={FINISHES.map((f) => ({ id: f.id, color: f.base, background: finishBackground(f.id), label: t(`finishes.${f.id}`), locked: f.pro && !access.premium }))}
            value={frame.finish}
            onChange={(id) => setFrame((f) => ({ ...f, finish: id as FrameSpec['finish'] }))}
            onLocked={onLocked}
          />
          <p className="text-[13px] font-medium text-foreground">{t(`finishes.${frame.finish}`)}</p>
        </Section>
      )}

      <div className="space-y-2.5">
        {frame.type !== 'frameless' && (
          <Slider label={t('width')} min={frame.type === 'floating' ? 0.6 : 1} max={frame.type === 'floating' ? 3 : 10} step={0.1} value={frame.widthCm} readout={`${round1(frame.widthCm)} ${tc('cm')}`} onChange={(v) => setFrame((f) => ({ ...f, widthCm: v }))} />
        )}
        {frame.type === 'floating' && <Slider label={t('gap')} min={0.3} max={4} step={0.1} value={frame.gapCm} readout={`${round1(frame.gapCm)} ${tc('cm')}`} onChange={(v) => setFrame((f) => ({ ...f, gapCm: v }))} />}
        <Slider label={t('depth')} min={1} max={8} step={0.5} value={frame.depthCm} readout={`${round1(frame.depthCm)} ${tc('cm')}`} onChange={(v) => setFrame((f) => ({ ...f, depthCm: v }))} />
      </div>

      {frame.type === 'classic' && (
        <Section title={t('mat')}>
          <Toggle label={t('mat')} checked={frame.mat.enabled} onChange={(on) => setFrame((f) => ({ ...f, mat: { ...f.mat, enabled: on } }))} />
          {frame.mat.enabled && (
            <>
              <Slider label={t('matWidth')} min={1} max={15} step={0.5} value={frame.mat.widthCm} readout={`${round1(frame.mat.widthCm)} ${tc('cm')}`} onChange={(v) => setFrame((f) => ({ ...f, mat: { ...f.mat, widthCm: v } }))} />
              <Swatches
                label={t('matColor')}
                swatches={MAT_COLORS.map((c) => ({ id: c, color: c, label: c }))}
                value={frame.mat.color}
                onChange={(c) => setFrame((f) => ({ ...f, mat: { ...f.mat, color: c } }))}
                onLocked={onLocked}
                custom={{ label: t('custom') }}
              />
            </>
          )}
        </Section>
      )}

      <p className="rounded-lg bg-secondary/50 px-3 py-2 text-[13px] text-foreground/85">
        {round ? t('outerRound', { d: round1(outer.w) }) : t('outer', { w: round1(outer.w), h: round1(outer.h) })}
      </p>
    </div>
  );
}

// ── 3. Space and light ──────────────────────────────────────────────────────
export function SpacePanel({ state, project, access, onLocked, calibration }: PanelProps & {
  calibration: { points: Pt[] | null; start: () => void; cancel: () => void; apply: (cm: number) => void };
}) {
  const t = useTranslations('wallTool.space');
  const tp = useTranslations('wallTool.photo');
  const space = project.space;
  const setSpace = (recipe: (s: WallProject['space']) => WallProject['space']) => state.update((p) => ({ ...p, space: recipe(p.space) }));
  const modes: { id: SpaceMode; locked: boolean }[] = [
    { id: 'wall', locked: false },
    { id: 'room', locked: !access.premium },
    { id: 'photo', locked: !access.photo },
  ];
  return (
    <div className="space-y-6">
      <Section title={t('mode')}>
        <Chips<SpaceMode> label={t('mode')} columns={3} options={modes.map((m) => ({ id: m.id, label: t(`modes.${m.id}`), locked: m.locked }))} value={space.mode} onChange={(mode) => setSpace((s) => ({ ...s, mode }))} onLocked={onLocked} />
      </Section>

      {space.mode === 'wall' && (
        <>
          <Section title={t('wallColor')}>
            <Swatches label={t('wallColor')} swatches={WALL_COLORS.map((c) => ({ id: c, color: c, label: c }))} value={space.wall.color} onChange={(color) => setSpace((s) => ({ ...s, wall: { ...s.wall, color } }))} onLocked={onLocked} custom={{ label: t('wallColor') }} />
          </Section>
          <Section title={t('texture')}>
            <Chips<WallTexture>
              label={t('texture')}
              columns={3}
              options={WALL_TEXTURES.map((x) => ({ id: x.id, label: t(`textures.${x.id}`), locked: x.pro && !access.premium }))}
              value={space.wall.texture}
              onChange={(texture) => setSpace((s) => ({ ...s, wall: { ...s.wall, texture } }))}
              onLocked={onLocked}
            />
          </Section>
          <Slider label={t('zoom')} min={25} max={80} step={1} value={Math.round(space.zoom * 100)} readout={`${Math.round(space.zoom * 100)}%`} onChange={(v) => setSpace((s) => ({ ...s, zoom: v / 100 }))} />
        </>
      )}

      {space.mode === 'room' && (
        <>
          <Section title={t('room')}>
            <div role="group" aria-label={t('room')} className="grid grid-cols-2 gap-2">
              {ROOMS.map((r) => <button type="button" key={r.id} aria-pressed={space.room.id === r.id} onClick={() => setSpace((s) => ({ ...s, room: { id: r.id, sofaStyle: r.sofa.style, sofaColor: r.sofa.color } }))} className={`overflow-hidden rounded-xl border text-start transition ${space.room.id === r.id ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-white/40'}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- local optimized studio asset */}
                <img src={`/images/art-wall/${r.id}.webp`} alt="" loading="lazy" className="aspect-[3/2] w-full object-cover" />
                <span className="block px-2.5 py-2 text-xs font-medium">{t(`rooms.${r.id}`)}</span>
              </button>)}
            </div>
          </Section>
          <Section title={t('sofa')} hint={t('scaleNote', { w: SOFAS[space.room.sofaStyle].w })}>
            <Chips<SofaStyle> label={t('sofa')} columns={2} options={SOFA_STYLES.map((s) => ({ id: s, label: t(`sofas.${s}`) }))} value={space.room.sofaStyle} onChange={(sofaStyle) => setSpace((s) => ({ ...s, room: { ...s.room, sofaStyle } }))} onLocked={onLocked} />
            <Swatches label={t('sofaColor')} swatches={SOFA_COLORS.map((c) => ({ id: c, color: c, label: c }))} value={space.room.sofaColor} onChange={(sofaColor) => setSpace((s) => ({ ...s, room: { ...s.room, sofaColor } }))} onLocked={onLocked} custom={{ label: t('sofaColor') }} />
          </Section>
          <Slider label={t('aboveSofa')} min={8} max={60} step={1} value={space.aboveSofaCm} readout={`${space.aboveSofaCm} cm`} onChange={(v) => setSpace((s) => ({ ...s, aboveSofaCm: v }))} />
        </>
      )}

      {space.mode === 'photo' && <PhotoControls state={state} project={project} calibration={calibration} />}

      {space.mode === 'photo' && !state.photoImage && <p className="text-xs text-muted-foreground">{tp('addLead')}</p>}
    </div>
  );
}

function PhotoControls({ state, project, calibration }: { state: WallState; project: WallProject; calibration: { points: Pt[] | null; start: () => void; cancel: () => void; apply: (cm: number) => void } }) {
  const t = useTranslations('wallTool.photo');
  const photo = state.photoImage;
  const [cm, setCm] = useState(100);
  const spec = project.space.photo;
  const size = photo ? { w: photo.width, h: photo.height } : null;
  const quad = size ? fittedQuad(project, size) : null;
  const setPhoto = (recipe: (p: WallProject['space']['photo']) => WallProject['space']['photo']) => state.update((p) => ({ ...p, space: { ...p.space, photo: recipe(p.space.photo) } }));
  if (!photo || !size) {
    return (
      <Section title={t('add')}>
        <ImageUploader primary label={t('choose')} icon={<ImagePlus className="h-5 w-5" />} onImageLoad={(url) => void state.setPhoto(url)} disabled={state.busy} />
      </Section>
    );
  }
  const width = quad ? quadWidth(quad, size) : 0;
  const angle = quad ? quadAngle(quad, size) : 0;
  return (
    <>
      <Section title={t('calibrate')} hint={calibration.points ? t('calibrateLead') : spec.calibration ? t('calibrated', { cm: spec.calibration.cm }) : t('notCalibrated')}>
        {calibration.points && calibration.points.length === 2 ? (
          <div className="flex items-end gap-2">
            <CmField id="wall-cal-cm" label={t('calibrateLength')} unit="cm" value={cm} onChange={setCm} />
            <button type="button" onClick={() => calibration.apply(cm)} className="h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
              {t('apply')}
            </button>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {calibration.points ? (
            <button type="button" onClick={calibration.cancel} className="flex h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium">
              <X className="h-4 w-4" aria-hidden="true" /> {t('cancel')}
            </button>
          ) : (
            <button type="button" onClick={calibration.start} className="flex h-10 items-center gap-1.5 rounded-lg border border-border bg-secondary/40 px-3 text-sm font-medium hover:bg-secondary">
              <Ruler className="h-4 w-4" aria-hidden="true" /> {t('calibrate')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setPhoto((ph) => ({ ...ph, quad: defaultQuad(project, size, quad ? centroid(quad) : undefined), ...quadMeta(project) }))}
            className="flex h-10 items-center gap-1.5 rounded-lg border border-border bg-secondary/40 px-3 text-sm font-medium hover:bg-secondary"
          >
            <Undo2 className="h-4 w-4" aria-hidden="true" /> {t('resetPlacement')}
          </button>
        </div>
      </Section>
      {quad && !calibration.points && (
        <div className="space-y-2.5">
          <p className="text-xs leading-relaxed text-muted-foreground">{t('hint')}</p>
          <Slider
            label={t('scale')}
            min={2}
            max={95}
            step={0.5}
            value={Math.round((width / size.w) * 1000) / 10}
            readout={`${Math.round((width / size.w) * 100)}%`}
            onChange={(v) => setPhoto((ph) => (ph.quad ? { ...ph, quad: scaleQuad(fittedQuad(project, size)!, (v / 100) * size.w / Math.max(1, width), size), ...quadMeta(project) } : ph))}
          />
          <Slider label={t('rotate')} min={-30} max={30} step={0.5} value={round1(angle)} readout={`${round1(angle)}°`} onChange={(v) => setPhoto((ph) => (ph.quad ? { ...ph, quad: rotateQuad(fittedQuad(project, size)!, v - angle, size), ...quadMeta(project) } : ph))} />
          <Slider label={t('shadow')} min={0} max={100} step={1} value={spec.shadow} readout={`${spec.shadow}`} onChange={(v) => setPhoto((ph) => ({ ...ph, shadow: v }))} />
          <Slider label={t('match')} min={0} max={100} step={1} value={spec.match} readout={`${spec.match}`} onChange={(v) => setPhoto((ph) => ({ ...ph, match: v }))} />
        </div>
      )}
      <ImageUploader compact label={t('replace')} icon={<ImagePlus className="h-4 w-4" />} onImageLoad={(url) => void state.setPhoto(url)} disabled={state.busy} />
    </>
  );
}

export function LightControls({ state, project, access, onLocked }: PanelProps) {
  const t = useTranslations('wallTool.light');
  const light = project.light;
  const setLight = (recipe: (l: WallProject['light']) => WallProject['light']) => state.update((p) => ({ ...p, light: recipe(p.light) }));
  const te = useTranslations('wallTool.editor');
  if (project.space.mode === 'photo') return <p className="text-sm leading-relaxed text-muted-foreground">{te('photoLight')}</p>;
  return (
    <Section title={t('title')} hint={access.lighting && (light.enabled || light.pictureLight) ? t('note') : undefined}>
      <Toggle label={t('gallery')} checked={access.lighting && light.enabled} locked={!access.lighting} onLocked={onLocked} onChange={(on) => setLight((l) => ({ ...l, enabled: on }))} />
      <Toggle label={t('picture')} checked={access.lighting && light.pictureLight} locked={!access.lighting} onLocked={onLocked} onChange={(on) => setLight((l) => ({ ...l, pictureLight: on }))} />
      {access.lighting && (light.enabled || light.pictureLight) && (
        <>
          <Chips<LightTemp> label={t('temperature')} columns={3} options={(['warm', 'neutral', 'cool'] as const).map((x) => ({ id: x, label: t(`temps.${x}`) }))} value={light.temperature} onChange={(temperature) => setLight((l) => ({ ...l, temperature }))} onLocked={onLocked} />
          <Slider label={t('intensity')} min={0} max={100} step={1} value={light.intensity} readout={`${light.intensity}`} onChange={(v) => setLight((l) => ({ ...l, intensity: v }))} />
        </>
      )}
    </Section>
  );
}

// ── 4. Preview & save ───────────────────────────────────────────────────────
export function ExportPanel({ state, project, access, onLocked, comparing, setComparing, onSave, saving, message }: PanelProps & {
  comparing: boolean;
  setComparing: (on: boolean) => void;
  onSave: () => void;
  saving: boolean;
  message: string | null;
}) {
  const t = useTranslations('wallTool');
  const tf = useTranslations('wallTool.frame');
  const variants = project.variants;
  const [name, setName] = useState(project.name);
  useEffect(() => setName(project.name), [project.id, project.name]);
  const photoMode = project.space.mode === 'photo';
  const out = project.output;
  const setOut = (recipe: (o: WallProject['output']) => WallProject['output']) => state.update((p) => ({ ...p, output: recipe(p.output) }));
  return (
    <div className="space-y-6">
      <Section title={t('compare.title')} hint={access.compare ? t('compare.lead') : undefined}>
        {!access.compare ? (
          <Toggle label={t('compare.title')} checked={false} locked onLocked={onLocked} onChange={() => undefined} />
        ) : (
          <>
            {variants.length > 0 && (
              <ul className="space-y-1.5">
                {variants.map((v, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg border border-border bg-secondary/30 p-1.5 ps-2.5">
                    <span className="h-6 w-6 shrink-0 rounded-full ring-1 ring-black/20" style={{ background: v.type === 'frameless' ? '#888' : finishBackground(v.finish) }} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {t('compare.label', { n: i + 1 })} · {tf(`types.${v.type}`)}
                      {v.type !== 'frameless' ? ` · ${tf(`finishes.${v.finish}`)}` : ''}
                    </span>
                    <button type="button" onClick={() => state.update((p) => ({ ...p, frame: { ...v, mat: { ...v.mat } } }))} className="rounded-md px-2 py-1.5 text-xs font-semibold text-primary hover:bg-secondary">
                      {t('compare.use')}
                    </button>
                    <button type="button" aria-label={`${t('compare.remove')} ${i + 1}`} onClick={() => state.update((p) => ({ ...p, variants: p.variants.filter((_, j) => j !== i) }))} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary">
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={variants.length >= 4}
                onClick={() => state.update((p) => ({ ...p, variants: [...p.variants, { ...p.frame, mat: { ...p.frame.mat } }].slice(0, 4) }))}
                className="flex h-10 items-center gap-1.5 rounded-lg border border-border bg-secondary/40 px-3 text-sm font-medium hover:bg-secondary disabled:opacity-50"
              >
                <Plus className="h-4 w-4" aria-hidden="true" /> {variants.length >= 4 ? t('compare.full') : t('compare.add')}
              </button>
              {variants.length >= 2 && (
                <button type="button" aria-pressed={comparing} onClick={() => setComparing(!comparing)} className={`flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium ${comparing ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-secondary/40 hover:bg-secondary'}`}>
                  <Columns2 className="h-4 w-4" aria-hidden="true" /> {comparing ? t('compare.hide') : t('compare.show')}
                </button>
              )}
            </div>
          </>
        )}
      </Section>

      <Section title={t('output.title')}>
        {!photoMode && (
          <Chips<ExportShape> label={t('output.shape')} columns={3} options={(['landscape', 'square', 'portrait'] as const).map((x) => ({ id: x, label: t(`output.shapes.${x}`) }))} value={out.shape} onChange={(shape) => setOut((o) => ({ ...o, shape }))} onLocked={onLocked} />
        )}
        <Chips<'jpeg' | 'png'> label={t('output.format')} columns={2} options={[{ id: 'jpeg', label: 'JPEG' }, { id: 'png', label: 'PNG' }]} value={out.format} onChange={(format) => setOut((o) => ({ ...o, format }))} onLocked={onLocked} />
        <Chips<'standard' | 'high'>
          label={t('output.size')}
          columns={1}
          options={[
            { id: 'standard', label: t('output.sizes.standard', { px: EXPORT_PX.standard }) },
            { id: 'high', label: t('output.sizes.high', { px: EXPORT_PX.high }), locked: !access.hires },
          ]}
          value={access.hires ? out.size : 'standard'}
          onChange={(size) => setOut((o) => ({ ...o, size }))}
          onLocked={onLocked}
        />
        <button type="button" onClick={onSave} disabled={saving} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60">
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {saving ? t('output.saving') : comparing && variants.length >= 2 ? t('output.saveCompare') : t('output.save')}
        </button>
        {message && <p role="status" className="text-[13px] text-muted-foreground">{message}</p>}
      </Section>

      <Section title={t('output.name')} hint={t('output.savedHere')}>
        <input
          aria-label={t('output.name')}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== project.name && state.update((p) => ({ ...p, name: name.trim() }))}
          className="h-11 w-full rounded-lg border border-border bg-background px-3 text-base text-foreground outline-none focus:ring-2 focus:ring-ring"
        />
        <button type="button" onClick={() => void state.duplicate(t('projects.copy', { name: project.name }))} className="flex h-10 items-center gap-1.5 rounded-lg border border-border bg-secondary/40 px-3 text-sm font-medium hover:bg-secondary">
          <Copy className="h-4 w-4" aria-hidden="true" /> {t('output.duplicate')}
        </button>
      </Section>
    </div>
  );
}

export { finishBackground };
