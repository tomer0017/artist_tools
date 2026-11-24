import type { AnimationId } from '@/lib/companion/model';
import { CLIPS, type ClipParams } from './clips';
import { RASTER_RIGS, type RasterPart } from './raster-rig';
import type { EngineOptions } from './engine';
import { RasterMesh } from './raster-mesh';

type PlayOptions = { params?: ClipParams; onEnd?: () => void; restart?: boolean };
const TAU=Math.PI*2;
const rotate=(angle:number,x:number,y:number,dy=0)=>`translate(0 ${dy.toFixed(2)}) rotate(${angle.toFixed(2)} ${x} ${y})`;

/** Raster articulation, with the same director contract and clip timing as the original engine. */
export class RasterEngine {
 private id:AnimationId='idle';
 private opts:EngineOptions;
 private playOptions:PlayOptions={};
 private started=performance.now();
 private pausedAt:number|null=null;
 private raf=0;
 private lastFrame=0;
 private timer=0;
 private ended=false;
 private disposed=false;
 private mesh:RasterMesh|null=null;
 private meshAttempted=false;
 private target:{x:number;y:number}|null=null;
 constructor(private box:HTMLElement, options:EngineOptions, private select:(id:AnimationId)=>void) {this.opts=options;}
 get clip(){return this.id;}
 setOptions(options:Partial<EngineOptions>){this.opts={...this.opts,...options};window.clearTimeout(this.timer);this.timer=0;this.stop();this.draw();this.schedule();}
 play(id:AnimationId, options:PlayOptions={}) {
  if(this.disposed)return;
  if(this.id===id&&!this.ended&&!options.restart){this.playOptions=options;this.select(id);this.draw();this.schedule();return;}
  window.clearTimeout(this.timer);this.timer=0;
  this.id=id;this.playOptions=options;this.started=performance.now();this.ended=false;
  if(this.pausedAt!==null)this.pausedAt=this.started;
  this.select(id);this.draw();this.schedule();
 }
 look(target:{x:number;y:number}|null){this.target=target;this.draw();}
 pause(){if(this.pausedAt===null)this.pausedAt=performance.now();this.stop();window.clearTimeout(this.timer);this.timer=0;}
 resume(){if(this.pausedAt!==null){this.started+=performance.now()-this.pausedAt;this.pausedAt=null;}this.draw();this.schedule();}
 dispose(){this.mesh?.dispose();this.disposed=true;this.stop();window.clearTimeout(this.timer);this.timer=0;}
 renderNow(){this.draw();}
 private stop(){cancelAnimationFrame(this.raf);this.raf=0;}
 private schedule(){
  if(this.disposed||this.pausedAt!==null)return;
  if(this.opts.reducedMotion){
   if(!CLIPS[this.id].loop&&!this.ended&&!this.timer)this.timer=window.setTimeout(()=>{this.timer=0;this.finish();},600);
   return;
  }
  if(!this.raf)this.raf=requestAnimationFrame(this.frame);
 }
 private finish(){if(this.ended||this.disposed)return;this.ended=true;const end=this.playOptions.onEnd;if(end)queueMicrotask(()=>{if(!this.disposed)end();});}
 private frame=(now:number)=>{
  this.raf=0;
  if(this.disposed||this.pausedAt!==null)return;
  if(now-this.lastFrame>=30){this.lastFrame=now;this.draw();}
  this.schedule();
 };
 private draw(){
  if(this.disposed)return;
  const svg=this.box.querySelector<SVGSVGElement>('svg');
  if(!svg||svg.dataset.pose!==this.id)return;
  const clip=CLIPS[this.id];
  const reduced=this.opts.reducedMotion===true;
  const elapsed=((this.pausedAt??performance.now())-this.started)/1000;
  const t=reduced?clip.stillAt:clip.loop?elapsed%clip.duration:Math.min(elapsed,clip.duration);
  const s=Math.sin(t*TAU/clip.duration), fast=Math.sin(t*TAU*3);
  const life=!reduced&&this.opts.idleLife!==false;
  const joints=RASTER_RIGS[this.id];
  const rotations:Record<RasterPart,number>={tail:life?2.4*Math.sin(elapsed*1.9):0,head:0,legBack:0,legFront:0,armFront:0};
  let lift=0,bodyAngle=0,bodyY=life?-.5*Math.sin(elapsed*1.7):0;
  if(!reduced)switch(this.id){
   case 'walk': case 'run': {
    const run=this.id==='run',stride=run?40:28;
    rotations.legBack=(run?-32:-22)+stride*s;
    rotations.legFront=(run?35:25)-stride*s;
    rotations.armFront=-7*s;rotations.head=-.7*s;rotations.tail=4*s;
    bodyY=-Math.abs(Math.cos(t*TAU/clip.duration))* (run?5:2.5);bodyAngle=run?2:0;
    break;
   }
   case 'jump': {
    const p=t/clip.duration;
    lift=p<.18?-3*Math.sin(p/.18*Math.PI):p<.86?32*Math.sin((p-.18)/.68*Math.PI):0;
    bodyY=p>.86?2*Math.sin((p-.86)/.14*Math.PI):0;
    rotations.legFront=-8*Math.sin(p*Math.PI);rotations.legBack=7*Math.sin(p*Math.PI);rotations.armFront=-6*Math.sin(p*Math.PI);break;
   }
   case 'sit': bodyY=life?Math.sin(t*1.2)*.6:0;rotations.head=life?Math.sin(t)*1.1:0;break;
   case 'rest':bodyY=life?Math.sin(t*1.1)*1.1:0;rotations.head=life?Math.sin(t*1.1)*1.3:0;break;
   case 'wave':rotations.armFront=12*Math.sin(t*TAU*2.3)*Math.sin(Math.PI*t/clip.duration);rotations.head=-2*Math.sin(Math.PI*t/clip.duration);break;
   case 'laugh':rotations.head=-2+2*fast;rotations.armFront=2*fast;bodyY=-1.5*Math.abs(fast);break;
   case 'think':rotations.head=-2+2*s;rotations.armFront=1.5*s;break;
   case 'curious':rotations.head=4*s;bodyAngle=.5*s;break;
   case 'celebrate':lift=15*Math.abs(Math.sin(t*Math.PI*2/clip.duration));rotations.armFront=9*fast;rotations.legFront=-6*fast;rotations.head=-2;break;
   case 'holdSign':rotations.armFront=.65*s;rotations.head=life?1.2*s:0;break;
   case 'point':rotations.armFront=Math.max(-15,Math.min(25,(this.playOptions.params?.aim??0)*.35))+1.4*s;rotations.head=-1;break;
   case 'draw':rotations.armFront=3.5*Math.sin(t*TAU*2.4);rotations.head=1.2*Math.sin(t*2);break;
  }
  for(const [part,angle] of Object.entries(rotations) as [RasterPart,number][]){
   const el=svg.querySelector(`[data-part="${part}"]`),[x,y]=joints[part].pivot;
   el?.setAttribute('transform',rotate(angle,x,y));
  }
  svg.querySelector('[data-raster-body]')?.setAttribute('transform',`translate(0 ${(bodyY-lift).toFixed(2)}) rotate(${bodyAngle.toFixed(2)} 175 280)`);
  svg.querySelector('[data-raster-shadow]')?.setAttribute('opacity',String(.18-Math.max(0,lift)*.003));
  const target=this.target??{x:0,y:0};
  for(const eye of svg.querySelectorAll('[data-raster-eye]'))eye.setAttribute('transform',`translate(${(Math.max(-1,Math.min(1,target.x))*.85).toFixed(2)} ${(Math.max(-1,Math.min(1,target.y))*.65).toFixed(2)})`);
  const blink=life&&elapsed%4.7>4.52;
  if(!this.meshAttempted){
   const canvas=this.box.querySelector<HTMLCanvasElement>('[data-raster-canvas]');
   if(canvas){this.meshAttempted=true;try{this.mesh=new RasterMesh(canvas,()=>{const fallback=this.box.querySelector<HTMLElement>('[data-raster-fallback]');if(fallback)fallback.style.visibility='hidden';});}catch{/* Keep official artwork visible on devices without WebGL. */}}
  }
  this.mesh?.draw(this.id,{angles:rotations,bodyY:bodyY-lift,bodyAngle,gaze:{x:Math.max(-1,Math.min(1,target.x)),y:Math.max(-1,Math.min(1,target.y))},blink:blink?Math.sin((elapsed%4.7-4.52)/.18*Math.PI):0});
  for(const lid of svg.querySelectorAll<SVGGElement>('[data-raster-lid]'))lid.style.display=blink?'':'none';
  this.opts.onFrame?.({lift,clip:this.id});
  if(!clip.loop&&!reduced&&elapsed>=clip.duration)this.finish();
 }
}
