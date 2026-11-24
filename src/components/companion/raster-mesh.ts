import type { AnimationId } from '@/lib/companion/model';
import { RASTER_RIGS, type RasterPart } from './raster-rig';

const images=new Map<string,HTMLImageElement>();
function imageFor(id:AnimationId){
 const url=`/sketchy/${id}.webp`;
 let image=images.get(url);
 if(!image){image=new Image();image.src=url;images.set(url,image);}
 return image;
}
const vertex=`attribute vec2 position; attribute vec2 uv; varying vec2 tex;
void main(){tex=uv;gl_Position=vec4(position.x/150.-1.,1.-position.y/180.,0.,1.);}`;
const fragment=`precision mediump float;
varying vec2 tex; uniform sampler2D artwork; uniform vec4 eyes[2]; uniform vec2 gaze; uniform float blink;
void main(){
 vec2 pixel=tex*vec2(300.,360.); vec2 source=tex;
 for(int i=0;i<2;i++){
  vec4 e=eyes[i];
  if(e.z>0.){
   vec2 q=(pixel-e.xy)/e.zw;
   float inside=1.-smoothstep(.82,1.,dot(q,q));
   source-=gaze*inside/vec2(300.,360.);
   if(blink>0. && q.y< -1.+2.1*blink && inside>.1){
    vec4 fur=texture2D(artwork,vec2(e.x+(pixel.x-e.x)*.3,e.y-e.w*1.9)/vec2(300.,360.));
    gl_FragColor=vec4(fur.rgb,texture2D(artwork,tex).a);return;
   }
  }
 }
 gl_FragColor=texture2D(artwork,source);
}`;

// Flatten the small authored SVG polygon vocabulary, including relative rectangular paths.
function polygon(path:string):[number,number][]{
 const tokens=path.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g)!;const points:[number,number][]=[];
 let i=0,x=0,y=0;
 while(i<tokens.length){const cmd=tokens[i++];
  if(cmd==='M'||cmd==='L'){x=Number(tokens[i++]);y=Number(tokens[i++]);}
  else if(cmd==='H')x=Number(tokens[i++]);else if(cmd==='V')y=Number(tokens[i++]);
  else if(cmd==='h')x+=Number(tokens[i++]);else if(cmd==='v')y+=Number(tokens[i++]);else if(cmd.toLowerCase()==='z')break;
  points.push([x,y]);
 }
 return points;
}
function influence(x:number,y:number,points:[number,number][]){
 let inside=false,distance=Infinity;
 for(let i=0,j=points.length-1;i<points.length;j=i++){
  const [ax,ay]=points[i],[bx,by]=points[j];
  if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
  const dx=bx-ax,dy=by-ay,k=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1)));
  distance=Math.min(distance,Math.hypot(x-ax-k*dx,y-ay-k*dy));
 }
 const k=Math.max(0,Math.min(1,.5+(inside?distance:-distance)/16));
 return k*k*(3-2*k);
}
const PARTS:RasterPart[]=['tail','legBack','legFront','head','armFront'];
export interface MeshMotion {angles:Record<RasterPart,number>;bodyY:number;bodyAngle:number;gaze:{x:number;y:number};blink:number;}

/** One GPU draw per frame. A connected skinned mesh keeps all joints and fur edges intact. */
export class RasterMesh {
 private gl:WebGLRenderingContext;
 private program:WebGLProgram;
 private buffer:WebGLBuffer;
 private texture:WebGLTexture;
 private indices:WebGLBuffer;
 private indexCount=0;
 private loaded:AnimationId|null=null;
 private pose:AnimationId|null=null;
 private weights:number[][]=[];
 private points:[number,number][]=[];
 private data:Float32Array;
 private last:{id:AnimationId;motion:MeshMotion}|null=null;
 private disposed=false;
 private pending:HTMLImageElement|null=null;
 constructor(private canvas:HTMLCanvasElement,private ready:()=>void){
  const gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false});
  if(!gl)throw new Error('WebGL unavailable');this.gl=gl;
  const shader=(type:number,source:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)??'shader');return s;};
  this.program=gl.createProgram()!;
  const vs=shader(gl.VERTEX_SHADER,vertex),fs=shader(gl.FRAGMENT_SHADER,fragment);
  gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);gl.deleteShader(vs);gl.deleteShader(fs);
  if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error('Raster shader link failed');
  gl.useProgram(this.program);this.buffer=gl.createBuffer()!;this.texture=gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D,this.texture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  for(let y=0;y<=360;y+=6)for(let x=0;x<=300;x+=6)this.points.push([x,y]);
  const indices:number[]=[];
  for(let y=0;y<60;y++)for(let x=0;x<50;x++){const a=y*51+x;indices.push(a,a+1,a+51,a+1,a+52,a+51);}
  this.indices=gl.createBuffer()!;this.indexCount=indices.length;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indices);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
  this.data=new Float32Array(this.points.length*4);
  canvas.addEventListener('webglcontextlost',this.lost);
 }
 private lost=()=>{this.canvas.style.visibility='hidden';const fallback=this.canvas.parentElement?.querySelector<HTMLElement>('[data-raster-fallback]');if(fallback)fallback.style.visibility='visible';};
 draw(id:AnimationId,motion:MeshMotion){
  if(this.disposed)return;this.last={id,motion};
  const image=imageFor(id);
  if(!image.complete||!image.naturalWidth){
   if(this.pending!==image){this.pending?.removeEventListener('load',this.onLoad);this.pending=image;image.addEventListener('load',this.onLoad,{once:true});}
   return;
  }
  const gl=this.gl;gl.useProgram(this.program);
  if(this.loaded!==id){gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);this.loaded=id;this.ready();}
  const rig=RASTER_RIGS[id];
  if(this.pose!==id){
   const polygons=PARTS.map(part=>polygon(rig[part].path));
   this.weights=this.points.map(([x,y])=>{
    const weights=polygons.map(poly=>influence(x,y,poly));
    // Later foreground parts own overlapping pixels, with a soft joint transition.
    for(let i=weights.length-1;i>=0;i--)for(let j=0;j<i;j++)weights[j]*=1-weights[i];
    return weights;
   });this.pose=id;
  }
  const matrices=PARTS.map(part=>{const a=motion.angles[part]*Math.PI/180;return [Math.cos(a),Math.sin(a),...rig[part].pivot];});
  const angle=motion.bodyAngle*Math.PI/180,bc=Math.cos(angle),bs=Math.sin(angle);
  for(let i=0;i<this.points.length;i++){
   const [x,y]=this.points[i];let nx=x,ny=y;
   for(let j=0;j<PARTS.length;j++){const w=this.weights[i][j];if(w<.001)continue;const [c,s,px,py]=matrices[j];nx+=w*(px+(x-px)*c-(y-py)*s-x);ny+=w*(py+(x-px)*s+(y-py)*c-y);}
   const dx=nx-175,dy=ny-280;
   const offset=i*4;this.data[offset]=175+dx*bc-dy*bs;this.data[offset+1]=280+dx*bs+dy*bc+motion.bodyY;this.data[offset+2]=x/300;this.data[offset+3]=y/360;
  }
  gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,this.data,gl.DYNAMIC_DRAW);
  for(const [name,offset] of [['position',0],['uv',8]] as const){const location=gl.getAttribLocation(this.program,name);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,16,offset);}
  const eyes=rig.eyes??[];gl.uniform4fv(gl.getUniformLocation(this.program,'eyes[0]'),new Float32Array([...(eyes[0]??[0,0,0,0]),...(eyes[1]??[0,0,0,0])]));
  gl.uniform2f(gl.getUniformLocation(this.program,'gaze'),motion.gaze.x*.85,motion.gaze.y*.65);
  gl.uniform1f(gl.getUniformLocation(this.program,'blink'),motion.blink);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indices);gl.drawElements(gl.TRIANGLES,this.indexCount,gl.UNSIGNED_SHORT,0);
 }
 private onLoad=()=>{if(this.last&&!this.disposed)this.draw(this.last.id,this.last.motion);};
 dispose(){this.disposed=true;this.pending?.removeEventListener('load',this.onLoad);this.canvas.removeEventListener('webglcontextlost',this.lost);this.gl.deleteBuffer(this.buffer);this.gl.deleteBuffer(this.indices);this.gl.deleteTexture(this.texture);this.gl.deleteProgram(this.program);this.gl.getExtension('WEBGL_lose_context')?.loseContext();}
}
