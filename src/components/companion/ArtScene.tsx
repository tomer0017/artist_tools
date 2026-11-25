import { useEffect, useRef, useState } from 'react';
import { SCENES, type ArtSceneId, type SceneSpec } from './art-scenes';
export { ART_SCENES, SCENES, type ArtSceneId } from './art-scenes';

/** Registered image frames. Fixed canvas/scale; time stops while hidden. */
export function ArtScene({id,locale,paused,reducedMotion,onEnd,onAction,onInspect}:{id:ArtSceneId;locale:'en'|'he';paused:boolean;reducedMotion:boolean;onEnd:()=>void;onAction?:()=>void;onInspect?:()=>void}){
 const spec:SceneSpec=SCENES[id];
 const elapsed=useRef(0),completed=useRef(false);
 const [step,setStep]=useState(0);
 const end=useRef(onEnd);end.current=onEnd;
 useEffect(()=>{elapsed.current=0;completed.current=false;setStep(0);},[id]);
 useEffect(()=>{
  if(paused||reducedMotion||completed.current)return;
  let raf=0,last=performance.now();
  const tick=(now:number)=>{
   elapsed.current+=Math.min(100,now-last);last=now;
   const next=Math.floor(elapsed.current/spec.beat);
   if(next>=spec.sequence.length){completed.current=true;end.current();return;}
   setStep(previous=>previous===next?previous:next);raf=requestAnimationFrame(tick);
  };
  raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);
 },[id,paused,reducedMotion,spec]);
 const frame=reducedMotion?spec.sequence[spec.sequence.length-1]:spec.sequence[Math.min(step,spec.sequence.length-1)];
 const label=spec.label[locale==='he'?1:0];
 const actionLabel=spec.action==='roulette'?(locale==='he'?'לנסות אתגר יצירתי':'Try an art challenge'):(locale==='he'?'לקבל טיפ לרישום':'Get a drawing tip');
 return <div className="relative flex h-full w-full flex-col items-center justify-end" data-sketchy-art-scene={id}>
  {spec.action!=='none'&&<div className="flex h-6 shrink-0 items-start justify-center">{onAction&&<button type="button" onClick={onAction} className="pointer-events-auto rounded-full border border-primary/40 bg-background/95 px-2 py-0.5 text-xs font-semibold leading-tight text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-art-action={id}>{actionLabel}</button>}</div>}
  <div className="relative w-full flex-1 min-h-0">
   <div role="img" aria-label={label} data-art-frame={frame} className="absolute inset-0 bg-no-repeat" style={{backgroundImage:`url(${spec.src})`,backgroundSize:`${spec.frames*100}% 100%`,backgroundPosition:`${frame/(spec.frames-1)*100}% 0`}}/>
   {onInspect&&<button type="button" onClick={onInspect} aria-label={locale==='he'?'לדבר עם סקצ׳י':'Talk to Sketchy'} className="pointer-events-auto absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"/>}
  </div>
 </div>;
}
