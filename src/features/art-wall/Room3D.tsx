'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Camera, Focus, Loader2, RotateCcw, Video } from 'lucide-react';
import { RoomStudio, videoTypes } from './three/studio';
import type { PieceOffset, WallProject } from './types';
import type { ArtSource } from './exporter';
import type { PieceArt } from './render/scene';

export interface Room3DProps {
  project: WallProject;
  art: ArtSource;
  /** The other artworks on the wall. */
  others?: PieceArt[];
  onExit: () => void;
  onSelect?: (id: string) => void;
  onMove?: (id: string, offset: PieceOffset) => void;
  /** The photo's long edge, px, and format. */
  photo: { longEdge: number; type: 'image/png' | 'image/jpeg' };
  /** Hands a photo or a film to the save sheet. */
  onMedia: (blob: Blob, type: string, kind: 'photo' | 'video') => Promise<void>;
}

const NO_OTHERS: PieceArt[] = [];

export default function Room3D({ project, art, others = NO_OTHERS, onExit, onSelect, onMove, photo, onMedia }: Room3DProps) {
  const t = useTranslations('wallTool.room3D');
  const host = useRef<HTMLDivElement>(null);
  const studio = useRef<RoomStudio | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState<null | 'photo' | 'video'>(null);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const latest = useRef({ project, art, others, onSelect, onMove });
  latest.current = { project, art, others, onSelect, onMove };
  useEffect(() => {
    let instance: RoomStudio | null = null;
    try {
      const l = latest.current;
      instance = new RoomStudio(host.current!, l.project, l.art.canvas, setStatus, { onSelect: (id) => latest.current.onSelect?.(id), onMove: (id, offset) => latest.current.onMove?.(id, offset) }, l.others);
      studio.current = instance;
    } catch { setStatus('error'); }
    return () => { instance?.dispose(); studio.current = null; };
  }, []);
  useEffect(() => { studio.current?.update(project, art.canvas, others); }, [project, art, others]);

  const takePhoto = async () => {
    const s = studio.current;
    if (!s || busy) return;
    setBusy('photo');
    setNotice(null);
    try {
      await onMedia(await s.capture(photo.longEdge, photo.type), photo.type, 'photo');
    } catch {
      setNotice(t('photoFailed'));
    } finally {
      setBusy(null);
    }
  };
  const recordVideo = async () => {
    const s = studio.current;
    if (!s || busy) return;
    const types = videoTypes();
    if (!types.length) return setNotice(t('videoUnsupported'));
    setBusy('video');
    setNotice(null);
    try {
      const coarse = window.matchMedia?.('(pointer: coarse)').matches;
      // MP4 where the browser really encodes it; otherwise (an empty or failed film) WebM.
      for (const type of types) {
        setProgress(0);
        const blob = await s.record({ type, longEdge: coarse ? 1280 : 1920, onProgress: (p) => setProgress(Math.round(p * 20) / 20) }).catch(() => null);
        if (blob?.size) return void (await onMedia(blob, type.split(';')[0], 'video'));
      }
      throw new Error('no video');
    } catch {
      setNotice(t('videoFailed'));
    } finally {
      setBusy(null);
    }
  };

  const round = 'flex h-11 items-center justify-center gap-2 rounded-full bg-black/70 text-xs font-semibold text-white disabled:opacity-60';
  return <div className="relative h-full w-full" data-room-3d={status}>
    <div ref={host} className="h-full w-full" />
    {status !== 'ready' && <div role="status" className="absolute inset-0 z-20 flex items-center justify-center bg-background/85 p-6 text-center text-sm"><div>{t(status === 'loading' ? 'loading' : 'unavailable')}{status === 'error' && <button onClick={onExit} className="mx-auto mt-3 block rounded-lg bg-primary px-4 py-2 text-primary-foreground">{t('back')}</button>}</div></div>}
    {status === 'ready' && <>
      {busy === 'video' && <div role="status" className="pointer-events-none absolute inset-x-0 top-16 z-10 mx-auto flex w-fit items-center gap-2 rounded-full bg-black/75 px-4 py-2 text-xs font-semibold text-white">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" aria-hidden="true" />{t('recording')}
        <span className="h-1 w-20 overflow-hidden rounded-full bg-white/25" aria-hidden="true"><span className="block h-full bg-white transition-[width]" style={{ width: `${progress * 100}%` }} /></span>
      </div>}
      {notice && <div role="alert" className="absolute inset-x-3 top-16 z-10 mx-auto max-w-sm rounded-xl bg-black/85 px-4 py-3 text-center text-xs leading-relaxed text-white">{notice} <button type="button" onClick={() => setNotice(null)} className="font-semibold underline">{t('dismiss')}</button></div>}
      <div className={`absolute end-3 top-1/2 flex -translate-y-1/2 flex-col items-end gap-2 ${busy === 'video' ? 'invisible' : ''}`}>
        <button type="button" onClick={() => void takePhoto()} disabled={!!busy} aria-label={t('photo')} title={t('photo')} className={`${round} min-w-11 px-3`}>
          {busy === 'photo' ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Camera className="h-5 w-5" aria-hidden="true" />}<span className="hidden md:inline">{t('photo')}</span>
        </button>
        <button type="button" onClick={() => void recordVideo()} disabled={!!busy} aria-label={t('video')} title={t('video')} className={`${round} min-w-11 px-3`}>
          <Video className="h-5 w-5" aria-hidden="true" /><span className="hidden md:inline">{t('video')}</span>
        </button>
      </div>
      <div className={`absolute bottom-3 end-3 flex gap-1.5 ${busy === 'video' ? 'invisible' : ''}`}>
        <button type="button" onClick={() => studio.current?.inspect()} disabled={!!busy} aria-label={t('inspect')} title={t('inspect')} className={`${round} w-11`}><Focus className="h-5 w-5" /></button>
        <button type="button" onClick={() => studio.current?.reset()} disabled={!!busy} aria-label={t('reset')} title={t('reset')} className={`${round} w-11`}><RotateCcw className="h-4 w-4" /></button>
      </div>
      {!busy && <p className="pointer-events-none absolute bottom-3 start-3 max-w-[65%] rounded-xl bg-black/65 px-3 py-2 text-[10px] leading-relaxed text-white">{t('gestures')}<span className="hidden md:block">{t('note')}</span></p>}
    </>}
  </div>;
}
