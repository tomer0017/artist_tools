import type { WallProject } from '../types';

const images = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<void>>();
export const assetUrl = (id: string) => `/images/art-wall/${id}.webp`;
export const roomImage = (id: string) => images.get(id);
/** Same-origin, decoded assets shared by preview and export. Failed loads can be retried. */
export async function loadRoomAssets(project: WallProject): Promise<void> {
  if (project.space.mode !== 'room') return;
  await Promise.all([project.space.room.id, `sofa-${project.space.room.sofaStyle}`].map((id) => {
    if (images.has(id)) return Promise.resolve();
    if (pending.has(id)) return pending.get(id)!;
    const job = new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => { images.set(id, img); pending.delete(id); resolve(); };
      img.onerror = () => { pending.delete(id); reject(new Error(`Room asset unavailable: ${id}`)); };
      img.src = assetUrl(id);
    });
    pending.set(id, job);
    return job;
  }));
}
