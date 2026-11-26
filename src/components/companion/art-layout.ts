import type { Geometry } from './geometry';
import type { SceneSpec } from './art-scenes';

/** Match the visible 306px fox in the regular 360px idle sprite. Never fit-to-box. */
export function artLayout(spec:SceneSpec,g:Geometry,center:number){
 const imageHeight=g.height*(306/360)/spec.foxHeight;
 const width=imageHeight*spec.aspect;
 const height=imageHeight;
 const top=g.floor-g.height*(17/360)-height;
 const {left,right,top:limit}=g.activity;
 // On a narrow Hero keep the normal character; don't shrink or crop the scene.
 if(width>right-left||top<limit)return null;
 return {left:Math.max(left,Math.min(center-width/2,right-width)),top,width,height};
}
