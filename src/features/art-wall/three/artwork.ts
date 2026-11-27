import * as THREE from 'three';
import { finishOf, isRound, type WallProject } from '../types';
import { frameGeometry } from '../render/frame';

/** All dimensions are metres. Rings are extrusions with real holes, never alpha masks. */
function outline(w: number, h: number, round: boolean): THREE.Shape {
  const shape = new THREE.Shape();
  if (round) shape.absarc(0, 0, w / 2, 0, Math.PI * 2, false);
  else { shape.moveTo(-w / 2, -h / 2); shape.lineTo(w / 2, -h / 2); shape.lineTo(w / 2, h / 2); shape.lineTo(-w / 2, h / 2); shape.closePath(); }
  return shape;
}
function ring(w: number, h: number, innerW: number, innerH: number, depth: number, round: boolean, material: THREE.Material) {
  const shape = outline(w, h, round);
  const hole = new THREE.Path();
  if (round) hole.absarc(0, 0, innerW / 2, 0, Math.PI * 2, true);
  else { hole.moveTo(-innerW / 2, -innerH / 2); hole.lineTo(-innerW / 2, innerH / 2); hole.lineTo(innerW / 2, innerH / 2); hole.lineTo(innerW / 2, -innerH / 2); hole.closePath(); }
  shape.holes.push(hole);
  const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .0008, bevelThickness: .0008, curveSegments: 64 }), material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
export function buildArtwork(project: WallProject, texture: THREE.Texture, wood: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  const f = project.frame, round = isRound(project.artwork);
  const aw = project.artwork.widthCm / 100, ah = (round ? project.artwork.widthCm : project.artwork.heightCm) / 100;
  const g = frameGeometry(aw * 100, ah * 100, f);
  const ow = g.outerW / 100, oh = g.outerH / 100, face = g.face / 100;
  const depth = f.type === 'frameless' ? .025 : f.depthCm / 100;
  const finish = finishOf(f.finish);
  const material = new THREE.MeshStandardMaterial({ color: finish.base, roughness: finish.kind === 'metal' ? .25 : .48, metalness: finish.kind === 'metal' ? .87 : 0, map: finish.kind === 'wood' ? wood : null });
  if (f.type !== 'frameless') group.add(ring(ow, oh, ow - face * 2, oh - face * 2, depth, round, material));
  else material.dispose();
  const artZ = f.type === 'floating' ? Math.max(.012, depth - .008) : depth + .001;
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#e1d9cc', roughness: .9 });
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(outline(aw, ah, round), { depth: Math.min(.025, artZ), bevelEnabled: false, curveSegments: 64 }), bodyMaterial);
  body.position.z = artZ - Math.min(.025, artZ); body.castShadow = true; body.receiveShadow = true;
  group.add(body);
  // A genuine recessed backing behind the floating gap.
  if (f.type === 'floating') {
    const back = new THREE.Mesh(new THREE.ShapeGeometry(outline(ow - face, oh - face, round), 64), new THREE.MeshStandardMaterial({ color: '#171411', roughness: 1 }));
    back.position.z = .001; back.receiveShadow = true; group.add(back);
  }
  if (g.mat > 0) {
    const mat = ring(ow - face * 2, oh - face * 2, aw, ah, .002, round, new THREE.MeshStandardMaterial({ color: f.mat.color, roughness: 1 }));
    mat.position.z = depth - .001; group.add(mat);
  }
  // Unlit, colour-managed original artwork: lighting never repaints its pixels.
  const front = new THREE.Mesh(round ? new THREE.CircleGeometry(aw / 2, 128) : new THREE.PlaneGeometry(aw, ah), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  front.position.z = artZ + .0015; group.add(front);
  group.position.z = .014;
  return group;
}
