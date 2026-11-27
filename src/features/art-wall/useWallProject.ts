// The open project of Art on Your Wall: loaded from this browser on entry
// (the one open last), saved back as it changes (with a thumbnail), and the
// images it names decoded into working copies.

import { useCallback, useEffect, useRef, useState } from 'react';
import { cropRatio } from './render/artwork';
import { cropArtwork } from './render/artwork';
import { renderScene } from './render/scene';
import { makeCanvas } from './render/util';
import { renderPhotoScene, type ArtSource } from './exporter';
import { dataUrlBytes, loadBlobImage, thumbOf, workingCopy } from './images';
import {
  blobOf,
  currentId,
  deleteProject as removeProject,
  getImage,
  getProject,
  listImages,
  listProjects,
  newId,
  putImage,
  putProject,
  rememberCurrent,
  type ProjectSummary,
  type StoredImage,
} from './storage';
import { newProject, normalizeProject, type WallProject } from './types';

const SAVE_AFTER_MS = 700;

export function useWallProject(untitled: string) {
  const [project, setProject] = useState<WallProject | null>(null);
  const [artImage, setArtImage] = useState<HTMLCanvasElement | null>(null);
  const [photoImage, setPhotoImage] = useState<HTMLCanvasElement | null>(null);
  const [art, setArt] = useState<ArtSource | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  /** A stored image that could not be read back (re-add it). */
  const [missing, setMissing] = useState<{ art: boolean; photo: boolean }>({ art: false, photo: false });
  /** Images already decoded for these ids (just added): no need to read them back. */
  const decoded = useRef<{ art: string | null; photo: string | null }>({ art: null, photo: null });
  const dirty = useRef(false);
  const lastThumb = useRef<string | null>(null);
  const latest = useRef<WallProject | null>(null);
  latest.current = project;

  // The project open last, or a new one.
  useEffect(() => {
    let alive = true;
    (async () => {
      let p: WallProject | null = null;
      try {
        const id = currentId();
        if (id) p = (await getProject(id))?.project ?? null;
      } catch {
        /* no storage: work without saving */
      }
      if (!alive) return;
      const open = p ?? newProject(newId(), untitled);
      setProject(open);
      rememberCurrent(open.id);
    })();
    return () => {
      alive = false;
    };
    // Only on entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Decode the images the project names.
  const artId = project?.artwork.imageId ?? null;
  const photoId = project?.space.photo.imageId ?? null;
  useEffect(() => {
    let alive = true;
    setMissing((m) => ({ ...m, art: false }));
    if (!artId) {
      setArtImage(null);
      return;
    }
    if (decoded.current.art === artId) return;
    setArtImage(null);
    getImage(artId)
      .then((rec) => (rec ? loadBlobImage(blobOf(rec)) : null))
      .then((img) => {
        if (!alive) return;
        setArtImage(img ? workingCopy(img) : null);
        if (!img) setMissing((m) => ({ ...m, art: true }));
      })
      .catch(() => alive && setMissing((m) => ({ ...m, art: true })));
    return () => {
      alive = false;
    };
  }, [artId]);
  useEffect(() => {
    let alive = true;
    setMissing((m) => ({ ...m, photo: false }));
    if (!photoId) {
      setPhotoImage(null);
      return;
    }
    if (decoded.current.photo === photoId) return;
    setPhotoImage(null);
    getImage(photoId)
      .then((rec) => (rec ? loadBlobImage(blobOf(rec)) : null))
      .then((img) => {
        if (!alive) return;
        setPhotoImage(img ? workingCopy(img) : null);
        if (!img) setMissing((m) => ({ ...m, photo: true }));
      })
      .catch(() => alive && setMissing((m) => ({ ...m, photo: true })));
    return () => {
      alive = false;
    };
  }, [photoId]);

  // The cropped artwork, redrawn shortly after the crop settles.
  const cropKey = project ? JSON.stringify(project.artwork.crop) : '';
  useEffect(() => {
    if (!artImage || !project) {
      setArt(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setArt({ canvas: cropArtwork(artImage, project.artwork.crop), key: `${project.artwork.imageId}|${cropKey}` });
    }, 90);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artImage, cropKey]);

  const update = useCallback((recipe: (p: WallProject) => WallProject) => {
    dirty.current = true;
    setProject((prev) => (prev ? { ...recipe(prev), updatedAt: Date.now() } : prev));
  }, []);

  // Save shortly after each change (once there is an artwork), with a thumbnail of the scene.
  useEffect(() => {
    if (!project || !dirty.current || !project.artwork.imageId) return;
    const timer = window.setTimeout(() => {
      let thumb: string | null = null;
      try {
        if (art) {
          const canvas = makeCanvas(300, 200);
          if (project.space.mode === 'photo' && photoImage && project.space.photo.quad) {
            const c = makeCanvas(300, Math.round((300 * photoImage.height) / photoImage.width));
            renderPhotoScene(c, project, art, photoImage);
            thumb = thumbOf(c, 300);
          } else {
            renderScene(canvas, project, { art: art.canvas, artKey: art.key });
            thumb = thumbOf(canvas, 300);
          }
        }
      } catch {
        thumb = null;
      }
      if (thumb) lastThumb.current = thumb;
      putProject(project, thumb ?? lastThumb.current).catch(() => setFailed(true));
      dirty.current = false;
    }, SAVE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [project, art, photoImage]);

  /** Keep a newly chosen image (exact bytes) and point the project at it. */
  const addImage = useCallback(async (dataUrl: string, kind: StoredImage['kind']): Promise<{ id: string; img: HTMLImageElement } | null> => {
    setBusy(true);
    try {
      const { bytes, type } = dataUrlBytes(dataUrl);
      const img = await loadBlobImage(new Blob([bytes], { type }));
      const id = newId();
      const record: StoredImage = { id, kind, bytes, type, width: img.naturalWidth, height: img.naturalHeight, thumb: thumbOf(img), createdAt: Date.now() };
      // Kept on this device when it can be (a full disk or a blocked storage still lets the work go on).
      await putImage(record).catch(() => undefined);
      return { id, img };
    } catch {
      setFailed(true);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const setArtwork = useCallback(
    async (dataUrl: string) => {
      setFailed(false);
      const added = await addImage(dataUrl, 'artwork');
      if (!added) return;
      const { id, img } = added;
      decoded.current.art = id;
      setArtImage(workingCopy(img));
      update((p) => {
        const crop = { ...p.artwork.crop, aspect: 'free' as const, rotation: 0, x: 0, y: 0, w: 1, h: 1 };
        const ratio = img.naturalWidth / img.naturalHeight;
        return { ...p, artwork: { ...p.artwork, imageId: id, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, crop, heightCm: Math.round((p.artwork.widthCm / ratio) * 10) / 10 } };
      });
    },
    [addImage, update],
  );

  const pickSavedArtwork = useCallback(
    (image: StoredImage) => {
      update((p) => {
        const crop = { ...p.artwork.crop, aspect: 'free' as const, rotation: 0, x: 0, y: 0, w: 1, h: 1 };
        return { ...p, artwork: { ...p.artwork, imageId: image.id, naturalWidth: image.width, naturalHeight: image.height, crop, heightCm: Math.round((p.artwork.widthCm / (image.width / image.height)) * 10) / 10 } };
      });
    },
    [update],
  );

  const setPhoto = useCallback(
    async (dataUrl: string) => {
      setFailed(false);
      const added = await addImage(dataUrl, 'photo');
      if (!added) return;
      decoded.current.photo = added.id;
      setPhotoImage(workingCopy(added.img));
      update((p) => ({ ...p, space: { ...p.space, mode: 'photo', photo: { ...p.space.photo, imageId: added.id, naturalWidth: added.img.naturalWidth, naturalHeight: added.img.naturalHeight, quad: null, calibration: null } } }));
    },
    [addImage, update],
  );

  /** Save the open project now (before listing projects, or leaving it). */
  const saveNow = useCallback(async () => {
    const p = latest.current;
    if (!p || !p.artwork.imageId || !dirty.current) return;
    dirty.current = false;
    await putProject(p, lastThumb.current).catch(() => undefined);
  }, []);
  const flush = useCallback(async () => {
    await saveNow();
    lastThumb.current = null;
  }, [saveNow]);
  // Leaving the tool saves what the last change left unsaved.
  useEffect(() => () => void flush(), [flush]);

  const open = useCallback(
    async (id: string) => {
      await flush();
      const rec = await getProject(id).catch(() => null);
      if (!rec) return;
      dirty.current = false;
      setArt(null);
      setProject(rec.project);
      rememberCurrent(rec.project.id);
    },
    [flush],
  );

  const startNew = useCallback(async () => {
    await flush();
    const p = newProject(newId(), untitled);
    dirty.current = false;
    setArt(null);
    setProject(p);
    rememberCurrent(p.id);
  }, [flush, untitled]);

  const duplicate = useCallback(
    async (name: string, from?: string) => {
      await flush();
      const source = from ? (await getProject(from).catch(() => null))?.project : latest.current;
      if (!source) return null;
      const now = Date.now();
      const copy = normalizeProject({ ...source, id: newId(), name, createdAt: now, updatedAt: now });
      await putProject(copy, null).catch(() => undefined);
      dirty.current = false;
      setArt(null);
      setProject(copy);
      rememberCurrent(copy.id);
      return copy;
    },
    [flush],
  );

  const remove = useCallback(
    async (id: string) => {
      await removeProject(id).catch(() => undefined);
      if (latest.current?.id === id) {
        const p = newProject(newId(), untitled);
        dirty.current = false;
        setArt(null);
        setProject(p);
        rememberCurrent(p.id);
      }
    },
    [untitled],
  );

  const ratio = project && artImage ? cropRatio(artImage.width, artImage.height, project.artwork.crop) : 1;

  return {
    project,
    update,
    artImage,
    photoImage,
    art,
    ratio,
    busy,
    failed,
    missing,
    setArtwork,
    pickSavedArtwork,
    setPhoto,
    open,
    startNew,
    duplicate,
    remove,
    saveNow,
    listProjects: (): Promise<ProjectSummary[]> => listProjects().catch(() => []),
    listArtworks: (): Promise<StoredImage[]> => listImages('artwork').catch(() => []),
  };
}

export type WallState = ReturnType<typeof useWallProject>;
