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
   const imageHeight=box.height-(spec.action==='none'?0:24);
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
