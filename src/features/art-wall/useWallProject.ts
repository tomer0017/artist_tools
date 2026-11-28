// The open project of Art on Your Wall: loaded from this browser on entry
// (the one open last), saved back as it changes (with a thumbnail), and the
// images it names decoded into working copies.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cropRatio } from './render/artwork';
import { cropArtwork } from './render/artwork';
import { renderScene, type PieceArt } from './render/scene';
import { frameGeometry } from './render/frame';
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
import { MAX_PIECES, isRound, newProject, nextPieceId, normalizeProject, piecesOf, selectPiece, type ArtworkSpec, type Piece, type PieceOffset, type WallProject } from './types';

const SAVE_AFTER_MS = 700;

const cropKeyOf = (a: ArtworkSpec) => `${a.imageId}|${JSON.stringify(a.crop)}`;

/** A framed piece's outer width, cm. */
function outerWidth(artwork: ArtworkSpec, frame: Piece['frame']): number {
  const round = isRound(artwork);
  return frameGeometry(artwork.widthCm, round ? artwork.widthCm : artwork.heightCm, frame).outerW;
}

/** Where a new piece goes: beside the others (right, or left when the right is full), cm. */
function besideOffset(p: WallProject, width: number): PieceOffset {
  const all = piecesOf(p).map((x) => ({ x: x.offset.x, w: outerWidth(x.artwork, x.frame) }));
  const right = Math.max(...all.map((q) => q.x + q.w / 2));
  const left = Math.min(...all.map((q) => q.x - q.w / 2));
  const gap = 14;
  return right + gap + width <= 200 ? { x: right + gap + width / 2, y: 0 } : { x: left - gap - width / 2, y: 0 };
}

/** The pieces moved together so the group is centred (over the sofa, in a room). */
function centred(p: WallProject): WallProject {
  const all = piecesOf(p).map((x) => ({ x: x.offset.x, w: outerWidth(x.artwork, x.frame) }));
  const mid = (Math.min(...all.map((q) => q.x - q.w / 2)) + Math.max(...all.map((q) => q.x + q.w / 2))) / 2;
  const shift = (o: PieceOffset): PieceOffset => ({ x: Math.round((o.x - mid) * 10) / 10, y: o.y });
  return { ...p, offset: shift(p.offset ?? { x: 0, y: 0 }), others: (p.others ?? []).map((o) => ({ ...o, offset: shift(o.offset) })) };
}

export function useWallProject(untitled: string) {
  const [project, setProject] = useState<WallProject | null>(null);
  const [artImage, setArtImage] = useState<HTMLCanvasElement | null>(null);
  const [photoImage, setPhotoImage] = useState<HTMLCanvasElement | null>(null);
  const [art, setArt] = useState<ArtSource | null>(null);
  const artRef = useRef<ArtSource | null>(null);
  artRef.current = art;
  /** The other pieces' cropped artworks, by image and crop. */
  const [crops, setCrops] = useState<Map<string, HTMLCanvasElement>>(() => new Map());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  /** A stored image that could not be read back (re-add it). */
  const [missing, setMissing] = useState<{ art: boolean; photo: boolean }>({ art: false, photo: false });
  /** Images already decoded for these ids (just added): no need to read them back. */
  const decoded = useRef<{ art: string | null; photo: string | null }>({ art: null, photo: null });
  /** Working copies of the artworks already decoded, by image id (switching pieces is instant). */
  const sources = useRef(new Map<string, HTMLCanvasElement>());
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
    const known = sources.current.get(artId);
    if (known) {
      setArtImage(known);
      return;
    }
    setArtImage(null);
    getImage(artId)
      .then((rec) => (rec ? loadBlobImage(blobOf(rec)) : null))
      .then((img) => {
        if (!alive) return;
        const copy = img ? workingCopy(img) : null;
        if (copy) sources.current.set(artId, copy);
        setArtImage(copy);
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
            renderScene(canvas, project, { art: art.canvas, artKey: art.key, others: otherArtsRef.current });
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

  // ── more artworks on the wall ────────────────────────────────────────────
  const othersKey = JSON.stringify((project?.others ?? []).map((o) => cropKeyOf(o.artwork)));
  useEffect(() => {
    const wanted = (latest.current?.others ?? []).map((o) => o.artwork).filter((a) => a.imageId);
    const keys = new Set(wanted.map(cropKeyOf));
    const missing = wanted.filter((a) => !crops.has(cropKeyOf(a)));
    if (!missing.length) {
      if ([...crops.keys()].some((k) => !keys.has(k))) setCrops(new Map([...crops].filter(([k]) => keys.has(k))));
      return;
    }
    let alive = true;
    (async () => {
      const next = new Map([...crops].filter(([k]) => keys.has(k)));
      for (const a of missing) {
        let source: HTMLCanvasElement | null = sources.current.get(a.imageId!) ?? (a.imageId === latest.current?.artwork.imageId ? artImage : null);
        if (!source) {
          const rec = await getImage(a.imageId!).catch(() => null);
          const img = rec ? await loadBlobImage(blobOf(rec)).catch(() => null) : null;
          if (!img) continue;
          source = workingCopy(img);
        }
        sources.current.set(a.imageId!, source);
        next.set(cropKeyOf(a), cropArtwork(source, a.crop, 2400));
      }
      if (alive) setCrops(next);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [othersKey]);
  const otherArts: PieceArt[] = useMemo(
    () => (project?.others ?? []).flatMap((o) => {
      const canvas = crops.get(cropKeyOf(o.artwork));
      return canvas ? [{ piece: o, art: canvas, artKey: cropKeyOf(o.artwork) }] : [];
    }),
    [project?.others, crops],
  );
  const otherArtsRef = useRef<PieceArt[]>([]);
  otherArtsRef.current = otherArts;

  /** The piece being edited hands its crop over before it becomes one of the others (no flicker). */
  const keepActiveCrop = useCallback(() => {
    const p = latest.current;
    const a = artRef.current;
    if (p && a) setCrops((m) => new Map(m).set(cropKeyOf(p.artwork), a.canvas));
  }, []);

  const select = useCallback(
    (id: string) => {
      const p = latest.current;
      if (!p || id === (p.pieceId ?? 'p1')) return;
      keepActiveCrop();
      if (artImage && p.artwork.imageId) sources.current.set(p.artwork.imageId, artImage);
      // Its crop is already drawn: shown at once, while the full one is redrawn.
      const next = p.others?.find((o) => o.id === id);
      const ready = next && crops.get(cropKeyOf(next.artwork));
      if (next && ready) setArt({ canvas: ready, key: cropKeyOf(next.artwork) });
      update((q) => selectPiece(q, id));
    },
    [artImage, crops, keepActiveCrop, update],
  );

  const movePiece = useCallback(
    (id: string, offset: PieceOffset) =>
      update((p) => (id === (p.pieceId ?? 'p1') ? { ...p, offset } : { ...p, others: (p.others ?? []).map((o) => (o.id === id ? { ...o, offset } : o)) })),
    [update],
  );

  const addPiece = useCallback(
    async (dataUrl: string) => {
      const p0 = latest.current;
      if (!p0 || piecesOf(p0).length >= MAX_PIECES) return;
      const added = await addImage(dataUrl, 'artwork');
      if (!added) return;
      const { id: imageId, img } = added;
      keepActiveCrop();
      if (artImage && p0.artwork.imageId) sources.current.set(p0.artwork.imageId, artImage);
      decoded.current.art = imageId;
      const copy = workingCopy(img);
      sources.current.set(imageId, copy);
      setArtImage(copy);
      update((p) => {
        if (piecesOf(p).length >= MAX_PIECES) return p;
        const widthCm = Math.min(p.artwork.widthCm, 60);
        const heightCm = Math.round((widthCm / (img.naturalWidth / img.naturalHeight)) * 10) / 10;
        const artwork: ArtworkSpec = { ...p.artwork, imageId, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, crop: { ...p.artwork.crop, aspect: 'free', rotation: 0, x: 0, y: 0, w: 1, h: 1 }, widthCm, heightCm };
        const frame = { ...p.frame, mat: { ...p.frame.mat } };
        const current: Piece = { id: p.pieceId ?? 'p1', artwork: p.artwork, frame: p.frame, offset: p.offset ?? { x: 0, y: 0 } };
        return centred({ ...p, pieceId: nextPieceId(p), artwork, frame, offset: besideOffset(p, outerWidth(artwork, frame)), others: [...(p.others ?? []), current] });
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [artImage, keepActiveCrop, update],
  );

  const duplicatePiece = useCallback(() => {
    const p0 = latest.current;
    if (!p0 || piecesOf(p0).length >= MAX_PIECES) return;
    keepActiveCrop();
    update((p) => {
      if (piecesOf(p).length >= MAX_PIECES) return p;
      const current: Piece = { id: p.pieceId ?? 'p1', artwork: p.artwork, frame: p.frame, offset: p.offset ?? { x: 0, y: 0 } };
      return centred({ ...p, pieceId: nextPieceId(p), frame: { ...p.frame, mat: { ...p.frame.mat } }, offset: besideOffset(p, outerWidth(p.artwork, p.frame)), others: [...(p.others ?? []), current] });
    });
  }, [keepActiveCrop, update]);

  const removePiece = useCallback(
    (id: string) =>
      update((p) => {
        if (piecesOf(p).length <= 1) return p;
        if (id !== (p.pieceId ?? 'p1')) return { ...p, others: (p.others ?? []).filter((o) => o.id !== id) };
        const swapped = selectPiece(p, (p.others ?? [])[0].id);
        return { ...swapped, others: (swapped.others ?? []).filter((o) => o.id !== id) };
      }),
    [update],
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
    otherArts,
    select,
    movePiece,
    addPiece,
    duplicatePiece,
    removePiece,
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
