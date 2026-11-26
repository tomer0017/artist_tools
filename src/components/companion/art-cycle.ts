import type { ArtSceneId } from './art-scenes';

export const ART_CYCLE = { stand: 11_000, sit: 8_000, restart: 250 } as const;

/** Shuffle bag: every eligible scene plays once before a refill; never repeat at the boundary. */
export function nextScene(pool: readonly ArtSceneId[], remaining: readonly ArtSceneId[], previous: ArtSceneId | null, random = Math.random) {
 let bag = remaining.filter(id => pool.includes(id));
 if (!bag.length) {
  bag = [...pool];
  for (let i = bag.length - 1; i > 0; i--) {
   const j = Math.floor(random() * (i + 1));
   [bag[i], bag[j]] = [bag[j], bag[i]];
  }
 }
 if (bag.length > 1 && bag[0] === previous) [bag[0], bag[1]] = [bag[1], bag[0]];
 return { id: bag[0] ?? null, remaining: bag.slice(1) };
}
