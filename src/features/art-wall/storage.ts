// Art on Your Wall keeps its projects in this browser (IndexedDB), like every
// tool keeps its work on the device: the original image files exactly as they
// were chosen, and each project's settings with a small thumbnail. Nothing is
// uploaded. Clearing the device (sign-out on a shared device) deletes it all
// (src/lib/device-data.ts).

import { WALL_DB_NAME, WALL_STORAGE_PREFIX } from './storageKeys';
import { normalizeProject, type WallProject } from './types';

const DB_VERSION = 1;
const IMAGES = 'images';
const PROJECTS = 'projects';
/** The project open last, to reopen it. */
export const CURRENT_KEY = `${WALL_STORAGE_PREFIX}current`;

export interface StoredImage {
  id: string;
  kind: 'artwork' | 'photo';
  /**
   * The original file's bytes, unchanged, and its type. Kept as an ArrayBuffer:
   * Safari cannot store a Blob in IndexedDB in a private window.
   */
  bytes: ArrayBuffer;
  type: string;
  width: number;
  height: number;
  /** A small JPEG data URL for lists. */
  thumb: string;
  createdAt: number;
}

interface StoredProject {
  id: string;
  project: WallProject;
  thumb: string | null;
  updatedAt: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  thumb: string | null;
}

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

let opening: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const request = indexedDB.open(WALL_DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const d = request.result;
      if (!d.objectStoreNames.contains(IMAGES)) d.createObjectStore(IMAGES, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(PROJECTS)) d.createObjectStore(PROJECTS, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const d = request.result;
      // Another tab deleting the database (a sign-out that clears the device) closes this one.
      d.onversionchange = () => {
        d.close();
        opening = null;
      };
      resolve(d);
    };
    request.onerror = () => {
      opening = null;
      reject(request.error ?? new Error('IndexedDB open failed'));
    };
  });
  return opening;
}

function run<T>(store: string, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const request = work(tx.objectStore(store));
        tx.oncomplete = () => resolve(request ? request.result : undefined);
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      }),
  );
}

export const putImage = (image: StoredImage) => run(IMAGES, 'readwrite', (s) => s.put(image)).then(() => undefined);
export const getImage = (id: string) => run<StoredImage>(IMAGES, 'readonly', (s) => s.get(id)).then((r) => r ?? null);

/** The stored original as a Blob, to decode. */
export const blobOf = (image: StoredImage): Blob => new Blob([image.bytes], { type: image.type });
export async function listImages(kind: StoredImage['kind']): Promise<StoredImage[]> {
  const all = ((await run<StoredImage[]>(IMAGES, 'readonly', (s) => s.getAll())) ?? []) as StoredImage[];
  return all.filter((i) => i.kind === kind).sort((a, b) => b.createdAt - a.createdAt);
}

export async function putProject(project: WallProject, thumb: string | null): Promise<void> {
  const record: StoredProject = { id: project.id, project, thumb, updatedAt: project.updatedAt };
  await run(PROJECTS, 'readwrite', (s) => s.put(record));
}

export async function getProject(id: string): Promise<{ project: WallProject; thumb: string | null } | null> {
  const record = await run<StoredProject>(PROJECTS, 'readonly', (s) => s.get(id));
  return record ? { project: normalizeProject({ ...record.project, id: record.id }), thumb: record.thumb } : null;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = ((await run<StoredProject[]>(PROJECTS, 'readonly', (s) => s.getAll())) ?? []) as StoredProject[];
  return all.map((r) => ({ id: r.id, name: r.project.name, updatedAt: r.updatedAt, thumb: r.thumb })).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Delete a project, and the images no other project uses. */
export async function deleteProject(id: string): Promise<void> {
  const all = ((await run<StoredProject[]>(PROJECTS, 'readonly', (s) => s.getAll())) ?? []) as StoredProject[];
  const gone = all.find((r) => r.id === id);
  await run(PROJECTS, 'readwrite', (s) => s.delete(id));
  if (!gone) return;
  const imagesOf = (p: WallProject) => [p.artwork.imageId, p.space.photo.imageId, ...(p.others ?? []).map((o) => o.artwork.imageId)];
  const used = new Set(all.filter((r) => r.id !== id).flatMap((r) => imagesOf(r.project)));
  for (const imageId of imagesOf(gone.project)) {
    if (imageId && !used.has(imageId)) await run(IMAGES, 'readwrite', (s) => s.delete(imageId));
  }
}

export function rememberCurrent(id: string | null): void {
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id);
    else localStorage.removeItem(CURRENT_KEY);
  } catch {
    /* private mode: nothing to remember */
  }
}

export function currentId(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}
