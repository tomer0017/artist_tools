import { useEffect, useRef, useState } from 'react';

export type ArtSceneId = 'portrait' | 'machine' | 'sketchbook' | 'dream';
export const ART_SCENES: ArtSceneId[] = ['portrait', 'machine', 'sketchbook', 'dream'];
const drawing = [0,1,2,3,2,3,2,3,4,4,2,3,2,3,5];
export const SCENES = {
 portrait: { frames:9, aspect:1.5, sequence:[0,1,2,3,4,5,6,7,8,8], beat:1100 },
 machine: { frames:6, aspect:1, sequence:[0,1,2,3,3,3,4,5,5,5], beat:900 },
 sketchbook: { frames:6, aspect:1, sequence:drawing, beat:700 },
 dream: { frames:6, aspect:1, sequence:[0,1,2,3,2,3,2,3,2,3,4,5,5], beat:1000 },
} as const;
const labels = {
 portrait:{en:'Practice portrait proportions',he:'לתרגל פרופורציות בדיוקן'},
 machine:{en:'Try an art challenge',he:'לנסות אתגר יצירתי'},
 sketchbook:{en:'Get a drawing tip',he:'לקבל טיפ לרישום'},
 dream:{en:'Sketchy dreams of painted sheep',he:'סקצ׳י חולם על כבשים מצוירות'},
};

/** Short authored frame sequences, never a reference sheet displayed as a picture.
 * Time stops offscreen; reduced motion shows one meaningful pose without autoplay.
 */
export function ArtScene({id,locale,paused,reducedMotion,onEnd,onAction,onInspect}:{id:ArtSceneId;locale:'en'|'he';paused:boolean;reducedMotion:boolean;onEnd:()=>void;onAction?:()=>void;onInspect?:()=>void}){
 const spec=SCENES[id];const elapsed=useRef(0);const [step,setStep]=useState(0);
 const end=useRef(onEnd);end.current=onEnd;
 useEffect(()=>{
  if(paused||reducedMotion)return;
  let raf=0,last=performance.now();
  const tick=(now:number)=>{
   elapsed.current+=Math.min(100,now-last);last=now;
   const next=Math.floor(elapsed.current/spec.beat);
   if(next>=spec.sequence.length){end.current();return;}
   setStep(previous=>previous===next?previous:next);raf=requestAnimationFrame(tick);
  };
  raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);
 },[paused,reducedMotion,spec]);
 const frame=reducedMotion?spec.sequence[spec.sequence.length-1]:spec.sequence[Math.min(step,spec.sequence.length-1)];
 return <div className="relative flex h-full w-full flex-col items-center justify-end" data-sketchy-art-scene={id}>
  <div role="img" aria-label={labels[id][locale]} data-art-frame={frame} className="min-h-0 w-full flex-1 bg-contain bg-center bg-no-repeat" style={{backgroundImage:`url(/sketchy/art/${id}.webp)`,backgroundSize:`${spec.frames*100}% 100%`,backgroundPosition:`${frame/(spec.frames-1)*100}% 0`,aspectRatio:spec.aspect,maxWidth:`${spec.aspect*100}%`}} />
  {onInspect&&<button type="button" onClick={onInspect} aria-label={locale==='he'?'לדבר עם סקצ׳י':'Talk to Sketchy'} className="pointer-events-auto absolute inset-x-0 bottom-9 top-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"/>}
  {onAction&&id!=='dream'&&<button type="button" onClick={onAction} className="pointer-events-auto mt-1 max-w-full rounded-full border border-primary/40 bg-background/95 px-2 py-1 text-xs font-semibold leading-tight text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-art-action={id}>{labels[id][locale]}</button>}
 </div>;
}
