import generated from './art-scenes-v2.json';

export interface SceneSpec {
 frames: number;
 aspect: number;
 /** Standing character height as a fraction of the untrimmed sprite frame. */
 foxHeight: number;
 sequence: readonly number[];
 beat: number;
 src: string;
 action: string;
 label: readonly string[];
}
const drawing = [0,1,2,3,2,3,2,3,4,4,2,3,2,3,5];
export const SCENES = {
 ...generated,
 portrait: {frames:9,aspect:1.5,foxHeight:0.69,sequence:[0,1,2,3,4,5,6,7,8,8],beat:1100,src:'/sketchy/art/portrait.webp',action:'tip',label:['Practice portrait proportions','לתרגל פרופורציות בדיוקן']},
 machine: {frames:6,aspect:1,foxHeight:0.75,sequence:[0,1,2,3,3,3,4,5,5,5],beat:900,src:'/sketchy/art/machine.webp',action:'roulette',label:['Try an art challenge','לנסות אתגר יצירתי']},
 sketchbook: {frames:6,aspect:1,foxHeight:0.75,sequence:drawing,beat:700,src:'/sketchy/art/sketchbook.webp',action:'tip',label:['Get a drawing tip','לקבל טיפ לרישום']},
 dream: {frames:6,aspect:1,foxHeight:0.75,sequence:[0,1,2,3,2,3,2,3,2,3,4,5,5],beat:1000,src:'/sketchy/art/dream.webp',action:'none',label:['Sketchy dreams of painted sheep','סקצ׳י חולם על כבשים מצוירות']},
} satisfies Record<string,SceneSpec>;
export type ArtSceneId = keyof typeof SCENES;
export const ART_SCENES: ArtSceneId[] = [...Object.keys(generated) as ArtSceneId[], 'sketchbook', 'dream'];
