import type { AnimationId } from '@/lib/companion/model';

// These masks articulate pixels from the approved artwork; they do not redraw the fox.
// Coordinates match the reproducible 300 × 360 WebP assets in scripts/sketchy/prepare.mjs.
type Joint = { path: string; pivot: [number, number] };
export type RasterPart = 'tail' | 'legBack' | 'legFront' | 'head' | 'armFront';
type Rig = Record<RasterPart, Joint> & { eyes?: [number, number, number, number][] };

/** The frame every pose is drawn in (sprite pixels); he faces right in it. */
export const SPRITE = { w: 300, h: 360 } as const;
/** Hip to sole, roughly, for matching his steps to the ground he covers (sprite pixels). */
export const LEG = 78;
/**
 * Where the live sign meets him while he holds it (holdSign, sprite pixels): the top of the
 * post above his paw, and the line just beside his cheek where the board begins (covering
 * what is left of the printed board in the artwork).
 */
export const SIGN_HOLD = { post: { x: 235, y: 190 }, inner: 199 } as const;

const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y}h${w}v${h}h${-w}Z`;
const standing: Rig = {
 tail: { path:'M0 180 H125 L139 224 L150 305 H0Z',pivot:[143,280] },
 legBack:{path:'M151 273 L189 273 L190 360 H130Z',pivot:[174,277]},
 legFront:{path:'M189 273 H250 V360 H187Z',pivot:[206,277]},
 head:{path:rect(80,0,180,181),pivot:[182,179]},
 armFront:{path:'M225 198 L260 207 V284 H227 L220 243Z',pivot:[227,207]},
 eyes:[[162,121,13,17],[211,119,11,17]],
};
export const RASTER_RIGS: Record<AnimationId,Rig> = {
 idle:standing,
 walk:{...standing,head:{path:rect(80,0,185,180),pivot:[182,178]},tail:{path:'M0 180 H125 L145 251 L143 306 H0Z',pivot:[145,280]},legBack:{path:'M157 271 L189 282 L175 309 L168 360 H110 V320Z',pivot:[176,281]},legFront:{path:'M189 271 L212 273 L270 320 V360 H218 L185 303Z',pivot:[197,280]},armFront:{path:'M229 211 L271 231 V280 H242 L230 250Z',pivot:[233,224]},eyes:[[186,120,12,16],[230,116,8,13]]},
 run:{...standing,head:{path:rect(90,0,180,190),pivot:[190,185]},tail:{path:'M0 170 H135 L155 230 L150 289 H0Z',pivot:[152,265]},legBack:{path:'M153 272 L185 282 L157 307 L134 360 H80 V320Z',pivot:[170,280]},legFront:{path:'M190 270 L220 272 L292 316 V360 H242 L193 300Z',pivot:[205,280]},armFront:{path:'M231 192 H299 V243 H241Z',pivot:[235,220]},eyes:[[215,129,11,16],[252,132,6,10]]},
 jump:{...standing,head:{path:rect(70,0,170,174),pivot:[176,170]},armFront:{path:'M218 104 H288 V173 L235 198 L213 177Z',pivot:[220,180]},legBack:{path:'M155 262 L193 273 L161 335 H90Z',pivot:[174,270]},legFront:{path:'M191 247 H257 V325 H187Z',pivot:[205,260]},eyes:undefined},
 sit:{...standing,head:{path:rect(60,65,190,171),pivot:[175,229]},tail:{path:'M0 225 H125 L145 290 V345 H0Z',pivot:[143,315]},legBack:{path:rect(125,302,64,58),pivot:[160,312]},legFront:{path:rect(190,294,92,66),pivot:[211,308]},armFront:{path:rect(195,255,30,66),pivot:[205,260]},eyes:[[176,181,12,16],[215,171,10,14]]},
 rest:{...standing,head:{path:rect(60,65,200,171),pivot:[177,231]},tail:{path:'M0 225 H125 L145 290 V345 H0Z',pivot:[143,315]},legBack:{path:rect(125,302,64,58),pivot:[160,312]},legFront:{path:rect(190,294,92,66),pivot:[211,308]},armFront:{path:rect(195,255,30,66),pivot:[205,260]},eyes:undefined},
 wave:{...standing,head:{path:rect(45,0,182,177),pivot:[167,170]},tail:{path:'M0 180 H109 L125 230 L130 305 H0Z',pivot:[130,279]},legBack:{path:rect(105,275,56,85),pivot:[142,280]},legFront:{path:rect(161,275,75,85),pivot:[180,280]},armFront:{path:'M211 103 H285 V174 L218 220 L196 202 L220 163Z',pivot:[204,203]},eyes:[[145,121,13,17],[193,113,12,16]]},
 laugh:{...standing,head:{path:rect(45,0,225,171),pivot:[170,166]},armFront:{path:'M157 199 H219 V240 H148Z',pivot:[153,218]},legBack:{path:'M146 267 L180 278 L160 360 H110Z',pivot:[164,275]},eyes:undefined},
 think:{...standing,head:{path:rect(50,0,215,181),pivot:[176,178]},armFront:{path:'M189 152 H224 V228 H197 L182 209Z',pivot:[202,214]},eyes:[[166,122,12,17],[206,113,10,16]]},
 curious:{...standing,head:{path:rect(40,0,250,190),pivot:[175,185]},eyes:[[162,127,13,17],[207,117,11,16]]},
 celebrate:{...standing,head:{path:rect(40,0,220,173),pivot:[172,168]},tail:{path:'M0 180 H112 L137 240 L135 305 H0Z',pivot:[135,280]},armFront:{path:'M217 117 H278 V186 L220 213 L202 193Z',pivot:[211,198]},legBack:{path:'M138 274 H180 L163 360 H110Z',pivot:[156,280]},legFront:{path:'M180 250 H245 V320 H185Z',pivot:[201,268]},eyes:undefined},
 point:{...standing,head:{path:rect(45,0,185,180),pivot:[170,176]},tail:{path:'M0 180 H110 L128 239 L131 307 H0Z',pivot:[130,280]},legBack:{path:rect(108,273,59,87),pivot:[145,278]},legFront:{path:rect(167,273,68,87),pivot:[185,278]},armFront:{path:'M201 163 L300 130 V192 L215 216Z',pivot:[208,202]},eyes:[[145,121,12,17],[188,115,10,15]]},
 draw:{...standing,head:{path:rect(45,0,210,186),pivot:[176,182]},armFront:{path:'M144 195 L188 193 L209 225 L178 244 L145 231Z',pivot:[151,214]},eyes:[[172,135,12,14],[215,137,9,12]]},
 holdSign:{...standing,head:{path:rect(50,0,205,179),pivot:[177,175]},tail:{path:'M0 180 H113 L138 238 L139 310 H0Z',pivot:[139,282]},armFront:{path:'M228 184 H286 V268 H237 L228 226Z',pivot:[237,217]},eyes:[[169,120,13,17],[209,113,11,16]]},
};

/** His walk: the founder's side-view cycle, 8 frames of 120 ms in one strip (scripts/sketchy/walk-cycle.mjs). */
export const WALK = { src: '/sketchy/walk-cycle.webp', frames: 8, frameMs: 120 } as const;

/**
 * The official artwork of one pose: the WebGL canvas draws it moving (raster-mesh.ts); the still
 * picture underneath shows until then, and stays on devices without WebGL. While he walks, the
 * frames of his walking cycle show instead (the engine steps through them), and the two
 * cross-fade. The empty SVG keeps the stage's anchors and each joint's current turn (read by
 * tests), mirrored with him.
 */
export function RasterRig({ pose, style }: {pose: AnimationId; style?: React.CSSProperties}) {
 // The sprite's own proportions, centred like the still picture (never stretched to the box).
 const frame: React.CSSProperties = {position:'absolute',top:0,left:'50%',height:'100%',aspectRatio:`${SPRITE.w} / ${SPRITE.h}`,transform:'translateX(-50%)'};
 const fade = 'transition-opacity duration-200 ease-out motion-reduce:transition-none';
 return <div style={{...style,position:'relative'}} data-sketchy-art="official-raster-v1">
  <img data-raster-fallback src={`/sketchy/${pose}.webp`} alt="" aria-hidden="true" draggable={false} className={`${fade} [[data-walking]_&]:opacity-0`} style={{position:'absolute',width:'100%',height:'100%',objectFit:'contain'}} />
  <canvas data-raster-canvas aria-hidden="true" className={`${fade} [[data-walking]_&]:opacity-0`} style={frame} />
  <div data-raster-walk aria-hidden="true" className={`${fade} opacity-0 [[data-walking]_&]:opacity-100`} style={{...frame,backgroundImage:`url(${WALK.src})`,backgroundSize:`${WALK.frames * 100}% 100%`,backgroundRepeat:'no-repeat',backgroundPosition:'0% 0'}} />
  <svg viewBox={`0 0 ${SPRITE.w} ${SPRITE.h}`} style={{position:'absolute',width:'100%',height:'100%',overflow:'visible'}} aria-hidden="true" data-pose={pose}>
   <g data-raster-body>
    {(['tail','legBack','legFront','head','armFront'] as const).map(part=><g key={part} data-part={part}/>)}
    <rect data-anchor="shoulder" x="216" y="202" width="1" height="1" fill="transparent"/>
    <rect data-anchor="signTop" x={SIGN_HOLD.post.x} y={SIGN_HOLD.post.y} width="1" height="1" fill="transparent"/>
   </g>
  </svg>
 </div>;
}
