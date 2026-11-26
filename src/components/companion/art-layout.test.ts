import {describe,it,expect} from 'vitest';
import {artLayout} from './art-layout';
import {geometryOf,type Measured} from './geometry';
import {ART_SCENES,SCENES} from './art-scenes';
const desktop:Measured={width:1152,floor:240,textEnd:480,topLimit:8,rtl:false,narrow:false};
describe('art scene character scale',()=>{
 it.each(ART_SCENES)('%s keeps the idle fox visible height, in either reading direction',id=>{
  const spec=SCENES[id];
  for(const rtl of [false,true]){
   const g=geometryOf({...desktop,rtl},100)!;
   const box=artLayout(spec,g,g.spots[0])!;
   expect(box).not.toBeNull();
   const imageHeight=box.height;
   expect(imageHeight*spec.foxHeight).toBeCloseTo(g.height*306/360);
   expect(box.left).toBeGreaterThanOrEqual(g.activity.left);
   expect(box.left+box.width).toBeLessThanOrEqual(g.activity.right);
   expect(box.top).toBeGreaterThanOrEqual(g.activity.top);
   expect(box.top+box.height).toBeLessThanOrEqual(g.floor);
  }
 });
 it('defers a wide scene when there is only room for the regular fox',()=>{
  const g=geometryOf({...desktop,width:390,textEnd:288,topLimit:52,floor:212,narrow:true},100)!;
  expect(artLayout(SCENES['mona-lisa'],g,g.spots[0])).toBeNull();
 });
 it('uses all free space even when only one walking spot exists',()=>{
  const g=geometryOf({...desktop,width:800,textEnd:490},100)!;
  expect(g.spots).toHaveLength(1);
  expect(artLayout(SCENES.sketchbook,g,g.spots[0])).not.toBeNull();
 });
});

 it.each([320,390,768,1024,1440])('all eight wide scenes fit a reserved Hero at viewport %i',width=>{
  const narrow=width<768;
  const m:Measured={width,floor:narrow?450:254,topLimit:narrow?278:30,textEnd:narrow?16:width*0.55,rtl:false,narrow,sceneRoom:true};
  for(const size of [70,100,140]){
   const g=geometryOf(m,size)!;
   for(const id of ART_SCENES)expect(artLayout(SCENES[id],g,g.spots[0]),`${width}/${size}/${id}`).not.toBeNull();
  }
 });
