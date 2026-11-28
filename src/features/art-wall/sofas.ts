// The sofas Art on Your Wall can show, in one catalog for 2D and 3D. A sofa is
// offered only where it really exists: in 2D when it has a photographed cut-out
// (public/images/art-wall/sofa-<id>.webp), in 3D when it has a model.
//
// Adding a 3D model (for Astra): put the files under public/models/art-wall/
// and add an entry with `model` (a licensed glTF/GLB, in metres, its origin on
// the floor at its centre, its front facing +Z, towards the room). `size` is
// the real sofa in cm; `model.widthM` is the model's own width, so the room
// scales it to `size.w` (times the person's size slider); `model.depthM`
// places its back against the wall and `model.heightM` (its back's top) sets
// where the artwork hangs. `recolor: 'upholstery'`
// lets the colour swatches tint the upholstery (as the current model does);
// 'none' keeps the model's own materials. The id is what projects save.

import type { SofaStyle, WallProject } from './types';

export interface SofaModel {
  url: string;
  /** The model's own width and depth, metres (before scaling). */
  widthM: number;
  depthM: number;
  heightM: number;
  recolor: 'upholstery' | 'none';
  license: string;
}

export interface SofaEntry {
  id: string;
  label: { en: string; he: string };
  /** The real sofa, cm: width, height of the back, seat depth. */
  size: { w: number; back: number; depth: number };
  /** 2D: the photographed cut-out's style (SOFAS in render/room.ts sizes it). */
  photo?: SofaStyle;
  /** 3D: the model. */
  model?: SofaModel;
}

export const SOFA_CATALOG: SofaEntry[] = [
  { id: 'modern', label: { en: 'Modern', he: 'מודרנית' }, size: { w: 224, back: 84, depth: 92 }, photo: 'modern' },
  { id: 'curved', label: { en: 'Curved', he: 'מעוגלת' }, size: { w: 236, back: 80, depth: 98 }, photo: 'curved' },
  { id: 'chesterfield', label: { en: 'Chesterfield', he: 'צ׳סטרפילד' }, size: { w: 214, back: 76, depth: 92 }, photo: 'chesterfield' },
  { id: 'lounge', label: { en: 'Low lounge', he: 'נמוכה' }, size: { w: 242, back: 70, depth: 104 }, photo: 'lounge' },
  {
    id: 'tufted',
    label: { en: 'Classic tufted', he: 'קלאסית מכופתרת' },
    size: { w: 224, back: 88, depth: 95 },
    model: { url: '/models/art-wall/sofa/sofa.gltf', widthM: 1.807, depthM: 1.08, heightM: 0.7095, recolor: 'upholstery', license: 'public/models/art-wall/LICENSES.md' },
  },
];

export const sofas2d = (): SofaEntry[] => SOFA_CATALOG.filter((s) => s.photo);
export const sofas3d = (): SofaEntry[] => SOFA_CATALOG.filter((s) => s.model);

/** The 3D sofa this project shows (its choice, or the first model). */
export function sofa3dOf(project: WallProject): SofaEntry {
  const all = sofas3d();
  return all.find((s) => s.id === project.space.room.sofa3d) ?? all[0];
}
