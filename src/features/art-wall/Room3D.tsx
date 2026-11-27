'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Focus, RotateCcw } from 'lucide-react';
import { RoomStudio } from './three/studio';
import type { WallProject } from './types';
import type { ArtSource } from './exporter';

export default function Room3D({ project, art, onExit }: { project: WallProject; art: ArtSource; onExit: () => void }) {
  const t = useTranslations('wallTool.room3D');
  const host = useRef<HTMLDivElement>(null);
  const studio = useRef<RoomStudio | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const latest = useRef({ project, art }); latest.current = { project, art };
  useEffect(() => {
    let instance: RoomStudio | null = null;
    try {
      instance = new RoomStudio(host.current!, latest.current.project, latest.current.art.canvas, setStatus);
      studio.current = instance;
    } catch { setStatus('error'); }
    return () => { instance?.dispose(); studio.current = null; };
  }, []);
  useEffect(() => { studio.current?.update(project, art.canvas); }, [project, art]);
  return <div className="relative h-full w-full" data-room-3d={status}>
    <div ref={host} className="h-full w-full" />
    {status !== 'ready' && <div role="status" className="absolute inset-0 z-20 flex items-center justify-center bg-background/85 p-6 text-center text-sm"><div>{t(status === 'loading' ? 'loading' : 'unavailable')}{status === 'error' && <button onClick={onExit} className="mx-auto mt-3 block rounded-lg bg-primary px-4 py-2 text-primary-foreground">{t('back')}</button>}</div></div>}
    {status === 'ready' && <>
      <div className="absolute bottom-3 end-3 flex gap-1.5">
        <button type="button" onClick={() => studio.current?.inspect()} aria-label={t('inspect')} title={t('inspect')} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/70 text-white"><Focus className="h-5 w-5" /></button>
        <button type="button" onClick={() => studio.current?.reset()} aria-label={t('reset')} title={t('reset')} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/70 text-white"><RotateCcw className="h-4 w-4" /></button>
      </div>
      <p className="pointer-events-none absolute bottom-3 start-3 max-w-[65%] rounded-xl bg-black/65 px-3 py-2 text-[10px] leading-relaxed text-white">{t('gestures')}<span className="hidden md:block">{t('note')}</span></p>
    </>}
  </div>;
}
