import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildArtwork } from './artwork';
import { newProject } from '../types';

describe('physical 3D artwork', () => {
  for (const round of [false, true]) it(`has exact dimensions, real depth and a hollow floating frame (${round ? 'circle' : 'rectangle'})`, () => {
    const p = newProject('3d', '3d');
    p.artwork.widthCm = 100; p.artwork.heightCm = round ? 100 : 70;
    p.artwork.crop.aspect = round ? 'circle' : 'free';
    p.frame = { ...p.frame, type: 'floating', widthCm: 2, depthCm: 6, gapCm: 3 };
    const group = buildArtwork(p, new THREE.Texture(), new THREE.Texture());
    const frame = group.children[0] as THREE.Mesh;
    frame.geometry.computeBoundingBox();
    const size = frame.geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(1.1, 2);
    expect(size.z).toBeCloseTo(.06, 2);
    group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(.515, 0, 1), new THREE.Vector3(0, 0, -1));
    expect(ray.intersectObject(frame)).toHaveLength(0); // physically open gap, not painted black
    const front = group.children.at(-1) as THREE.Mesh;
    front.geometry.computeBoundingBox();
    expect(front.geometry.boundingBox!.getSize(new THREE.Vector3()).x).toBeCloseTo(1, 5);
    expect((front.material as THREE.MeshBasicMaterial).toneMapped).toBe(false);
  });
});
