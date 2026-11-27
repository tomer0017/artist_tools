// Art on Your Wall (הציור שלך על הקיר): Artwork → Frame → Space → Preview &
// save. The artist's own image is cropped and framed, never redrawn; scenes
// are composed in this browser at real scale, and saved like every export of
// the studio (src/components/common/SaveMedia.tsx: the server authorizes the
// tool, the image and every Pro option it was made with).

import { useEffect, useMemo, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowLeft, ArrowRight, Copy, FolderOpen, Loader2, Plus, Trash2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'use-intl';
import ImageUploader from '@/components/common/ImageUploader';
import { useSaveMedia } from '@/components/common/SaveMedia';
import ToolHeader, { HeaderIconButton, StepIndicator } from '@/components/shell/ToolHeader';
import { useHasFeature } from '@/components/shell/account';
import type { UseFeatureId } from '@/lib/plans';
import { exportImage } from './exporter';
import { quadMeta, defaultQuad, fittedQuad, centroid } from './placement';
import { ArtworkPanel, ExportPanel, FramePanel, SavedArtworks, SpacePanel, type Access } from './Panels';
import { CompareGrid, PhotoStage, ScenePreview } from './Stage';
import { CropEditor } from './CropEditor';
import type { ProjectSummary } from './storage';
import { EXPORT_PX, WALL_FEATURES, WALL_TEXTURES, finishOf, type FrameSpec, type Pt, type WallProject } from './types';
import { cropRatio } from './render/artwork';
import { ProHint } from './ui';
import { useWallProject, type WallState } from './useWallProject';

const STEPS = ['artwork', 'frame', 'space', 'export'] as const;

const premiumFrame = (f: FrameSpec) => f.type === 'floating' || (f.type !== 'frameless' && finishOf(f.finish).pro);

/** The project as this plan can show and save it: any Pro option it lacks gives way to a free one. */
function withinPlan(p: WallProject, a: Access): WallProject {
  const frame = (f: FrameSpec): FrameSpec => (a.premium ? f : { ...f, type: f.type === 'floating' ? 'classic' : f.type, finish: finishOf(f.finish).pro ? 'black' : f.finish });
  let q: WallProject = { ...p, frame: frame(p.frame), variants: p.variants.map(frame) };
  if ((q.space.mode === 'room' && !a.premium) || (q.space.mode === 'photo' && !a.photo)) q = { ...q, space: { ...q.space, mode: 'wall' } };
  if (!a.premium && WALL_TEXTURES.find((x) => x.id === q.space.wall.texture)?.pro) q = { ...q, space: { ...q.space, wall: { ...q.space.wall, texture: 'plaster' } } };
  if (!a.lighting) q = { ...q, light: { ...q.light, enabled: false, pictureLight: false } };
  if (!a.hires) q = { ...q, output: { ...q.output, size: 'standard' } };
  return q;
}

/** What a saved image is authorized with, beyond the image itself. */
function featuresOf(p: WallProject, compared: FrameSpec[] | null): UseFeatureId[] {
  const used: UseFeatureId[] = [];
  const frames = compared ?? [p.frame];
  if (p.output.size === 'high') used.push('export.wall_hires');
  if (p.space.mode === 'room' || frames.some(premiumFrame) || (p.space.mode === 'wall' && WALL_TEXTURES.find((x) => x.id === p.space.wall.texture)?.pro)) used.push('wall.premium');
  if (p.space.mode !== 'photo' && (p.light.enabled || p.light.pictureLight)) used.push('wall.lighting');
  if (p.space.mode === 'photo') used.push('wall.my_room');
  if (compared) used.push('wall.compare');
  return used;
}

function Busy({ text }: { text?: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center gap-2 text-sm text-white/70">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      {text}
    </div>
  );
}

export default function ArtWall() {
  const t = useTranslations('wallTool');
  const state = useWallProject(t('projects.untitled'));
  const { save } = useSaveMedia();
  const access: Access = {
    premium: useHasFeature(WALL_FEATURES.premium),
    lighting: useHasFeature(WALL_FEATURES.lighting),
    photo: useHasFeature(WALL_FEATURES.photo),
    compare: useHasFeature(WALL_FEATURES.compare),
    hires: useHasFeature(WALL_FEATURES.hires),
  };
  const [step, setStep] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [calPoints, setCalPoints] = useState<Pt[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const project = state.project;
  const accessKey = `${access.premium}${access.lighting}${access.photo}${access.compare}${access.hires}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shown = useMemo(() => (project ? withinPlan(project, access) : null), [project, accessKey]);
  const hasArt = !!project?.artwork.imageId;
  const stepId = STEPS[step];
  const compareOn = comparing && access.compare && !!shown && shown.variants.length >= 2;
  const labels = (shown?.variants ?? []).map((_, i) => t('compare.label', { n: i + 1 }));

  const onLocked = (name: string) => setHint(name);
  const go = (next: number) => {
    setHint(null);
    setCalPoints(null);
    setStep(Math.max(0, Math.min(STEPS.length - 1, next)));
  };

  const calibration = {
    points: calPoints,
    start: () => setCalPoints([]),
    cancel: () => setCalPoints(null),
    apply: (cm: number) => {
      const photo = state.photoImage;
      if (!calPoints || calPoints.length < 2 || !photo || !project) return;
      const size = { w: photo.width, h: photo.height };
      state.update((p) => {
        const withCal: WallProject = { ...p, space: { ...p.space, photo: { ...p.space.photo, calibration: { a: calPoints[0], b: calPoints[1], cm } } } };
        const current = fittedQuad(withCal, size);
        return { ...withCal, space: { ...withCal.space, photo: { ...withCal.space.photo, quad: defaultQuad(withCal, size, current ? centroid(current) : undefined), ...quadMeta(withCal) } } };
      });
      setCalPoints(null);
    },
  };

  const onSave = async () => {
    if (!shown || !state.art) return;
    setSaving(true);
    setMessage(null);
    try {
      const compared = compareOn ? shown.variants : null;
      const blob = await exportImage({ project: shown, art: state.art, photo: state.photoImage, long: EXPORT_PX[shown.output.size], compare: compared, labels });
      const ext = shown.output.format === 'png' ? 'png' : 'jpg';
      await save({ blob, filename: `sketchyartlab-wall-${Date.now()}.${ext}`, mime: shown.output.format === 'png' ? 'image/png' : 'image/jpeg', title: t('imageTitle'), tool: 'wall', features: featuresOf(shown, compared) });
    } catch {
      setMessage(t('output.failed'));
    } finally {
      setSaving(false);
    }
  };

  // ── the stage ────────────────────────────────────────────────────────────
  let stage: React.ReactNode;
  if (!project || !shown) stage = <Busy />;
  else if (!hasArt || state.missing.art) stage = <EmptyArtwork state={state} />;
  else if (!state.artImage) stage = <Busy text={t('artwork.loading')} />;
  else if (step === 0)
    stage = (
      <CropEditor
        image={state.artImage}
        crop={project.artwork.crop}
        label={t('artwork.cropBox')}
        hint={t('artwork.dragHint')}
        onChange={(crop) =>
          state.update((p) => {
            const img = state.artImage!;
            const ratio = cropRatio(img.width, img.height, crop);
            const round = crop.aspect === 'circle';
            return { ...p, artwork: { ...p.artwork, crop, heightCm: round ? p.artwork.widthCm : Math.round((p.artwork.widthCm / ratio) * 10) / 10 } };
          })
        }
      />
    );
  else if (!state.art) stage = <Busy />;
  else if (step === 2 && shown.space.mode === 'photo' && (!project.space.photo.imageId || state.missing.photo)) stage = <EmptyPhoto state={state} />;
  else if (step === 2 && shown.space.mode === 'photo' && !state.photoImage) stage = <Busy />;
  else if (step === 2 && shown.space.mode === 'photo' && state.photoImage)
    stage = (
      <PhotoStage
        project={shown}
        art={state.art}
        photo={state.photoImage}
        update={state.update}
        calibrating={calPoints}
        onCalPoint={(p) => setCalPoints((pts) => (pts && pts.length < 2 ? [...pts, p] : pts))}
        labels={{ label: t('preview.label'), hint: t('photo.hint'), corner: (n) => t('photo.corner', { n }), tap: calPoints && calPoints.length === 0 ? t('photo.tapFirst') : calPoints && calPoints.length === 1 ? t('photo.tapSecond') : t('photo.calibrateLead') }}
      />
    );
  else if (step === 3 && compareOn)
    stage = <CompareGrid project={shown} art={state.art} photo={state.photoImage} frames={shown.variants} labels={labels} label={t('preview.label')} onUse={(i) => state.update((p) => ({ ...p, frame: { ...p.variants[i], mat: { ...p.variants[i].mat } } }))} />;
  else stage = <ScenePreview project={shown} art={state.art} photo={state.photoImage} label={t('preview.label')} />;

  // ── the panel ────────────────────────────────────────────────────────────
  let panel: React.ReactNode = null;
  if (project && shown && hasArt && !state.missing.art) {
    const props = { state, project, access, onLocked };
    panel =
      step === 0 ? (
        <ArtworkPanel {...props} />
      ) : step === 1 ? (
        <FramePanel {...props} />
      ) : step === 2 ? (
        <SpacePanel {...props} calibration={calibration} />
      ) : (
        <ExportPanel {...props} comparing={compareOn} setComparing={setComparing} onSave={() => void onSave()} saving={saving} message={message} />
      );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <ToolHeader
        tool="wall"
        task={t(`task.${stepId}`)}
        actions={
          <HeaderIconButton label={t('projects.button')} onClick={() => setProjectsOpen(true)}>
            <FolderOpen className="h-5 w-5" />
          </HeaderIconButton>
        }
      />
      <StepIndicator steps={STEPS.map((s) => t(`steps.${s}`))} current={step} canSelect={(i) => i === 0 || hasArt} onSelect={go} />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <section aria-label={t('preview.label')} className="relative min-h-[46%] min-w-0 flex-1 bg-[#0e0e10] md:min-h-0">
          {stage}
        </section>
        {panel && (
          <aside className="flex max-h-[54%] min-h-0 flex-col border-t border-border bg-card md:max-h-none md:w-[360px] md:border-s md:border-t-0 lg:w-[390px]">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{panel}</div>
            {hint && (
              <div className="border-t border-border p-3">
                <ProHint name={hint} onClose={() => setHint(null)} />
              </div>
            )}
            <div className="flex gap-2 border-t border-border p-3">
              {step > 0 && (
                <button type="button" onClick={() => go(step - 1)} className="flex h-11 items-center gap-1.5 rounded-xl border border-border px-4 text-sm font-semibold text-foreground hover:bg-secondary">
                  <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /> {t('back')}
                </button>
              )}
              {step < STEPS.length - 1 && (
                <button type="button" onClick={() => go(step + 1)} className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90">
                  {t('next')}: {t(`steps.${STEPS[step + 1]}`)} <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                </button>
              )}
            </div>
          </aside>
        )}
      </div>
      <ProjectsDialog open={projectsOpen} onOpenChange={setProjectsOpen} state={state} onOpened={() => go(state.project?.artwork.imageId ? step : 0)} />
    </div>
  );
}

function EmptyArtwork({ state }: { state: WallState }) {
  const t = useTranslations('wallTool.artwork');
  return (
    <div className="flex h-full w-full items-center justify-center overflow-y-auto p-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-5 shadow-xl">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('add')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('addLead')}</p>
        </div>
        {state.busy ? <Busy text={t('loading')} /> : <ImageUploader onImageLoad={(url) => void state.setArtwork(url)} />}
        {(state.failed || state.missing.art) && <p role="alert" className="text-sm text-destructive">{t('failed')}</p>}
        <SavedArtworks state={state} />
      </div>
    </div>
  );
}

function EmptyPhoto({ state }: { state: WallState }) {
  const t = useTranslations('wallTool.photo');
  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-5 shadow-xl">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('add')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('addLead')}</p>
        </div>
        {state.busy ? <Busy /> : <ImageUploader primary label={t('choose')} onImageLoad={(url) => void state.setPhoto(url)} />}
      </div>
    </div>
  );
}

function ProjectsDialog({ open, onOpenChange, state, onOpened }: { open: boolean; onOpenChange: (open: boolean) => void; state: WallState; onOpened: () => void }) {
  const t = useTranslations('wallTool.projects');
  const locale = useLocale();
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const refresh = () => state.saveNow().then(() => state.listProjects()).then(setItems);
  // Read the list each time it opens (Radix reports only the changes it makes itself).
  useEffect(() => {
    if (!open) return;
    setConfirm(null);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const close = () => onOpenChange(false);
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <DialogPrimitive.Content className="fixed inset-x-3 bottom-3 top-14 z-50 mx-auto flex max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl focus:outline-none md:inset-y-16">
          <div className="flex items-start gap-3 border-b border-border p-4">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-lg font-semibold text-foreground">{t('title')}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 text-[13px] text-muted-foreground">{t('lead')}</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close aria-label={t('close')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary">
              <X className="h-5 w-5" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <div className="border-b border-border p-3">
            <button
              type="button"
              onClick={async () => {
                await state.startNew();
                close();
                onOpened();
              }}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> {t('new')}
            </button>
          </div>
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {items === null && <Busy />}
            {items?.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">{t('empty')}</li>}
            {items?.map((item) => (
              <li key={item.id} className="rounded-xl border border-border bg-secondary/30 p-2">
                <div className="flex items-center gap-3">
                  <div className="h-14 w-20 shrink-0 overflow-hidden rounded-md bg-black/40">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a local thumbnail data URL */}
                    {item.thumb && <img src={item.thumb} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.id === state.project?.id ? t('current') : date.format(item.updatedAt)}</p>
                  </div>
                </div>
                {confirm === item.id ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 text-[13px] text-foreground">{t('confirmDelete', { name: item.name })}</p>
                    <button
                      type="button"
                      onClick={async () => {
                        await state.remove(item.id);
                        setConfirm(null);
                        void refresh();
                      }}
                      className="h-9 rounded-lg bg-destructive px-3 text-xs font-semibold text-destructive-foreground"
                    >
                      {t('delete')}
                    </button>
                    <button type="button" onClick={() => setConfirm(null)} className="h-9 rounded-lg border border-border px-3 text-xs font-semibold">
                      {t('cancel')}
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 flex gap-1.5">
                    <button
                      type="button"
                      onClick={async () => {
                        await state.open(item.id);
                        close();
                        onOpened();
                      }}
                      className="h-9 flex-1 rounded-lg bg-primary/15 text-xs font-semibold text-primary hover:bg-primary/25"
                    >
                      {t('open')}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await state.duplicate(t('copy', { name: item.name }), item.id);
                        close();
                        onOpened();
                      }}
                      className="flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-secondary"
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {t('duplicate')}
                    </button>
                    <button type="button" aria-label={`${t('delete')}: ${item.name}`} onClick={() => setConfirm(item.id)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-secondary">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

