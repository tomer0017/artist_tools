import {describe,it,expect} from 'vitest';
import {ART_CYCLE,nextScene} from './art-cycle';
import {ART_SCENES,type ArtSceneId} from './art-scenes';
describe('art rotation',()=>{
 it('waits eleven seconds standing and eight sitting, without the old three-minute delay',()=>{
  expect(ART_CYCLE.stand).toBe(11000);expect(ART_CYCLE.sit).toBe(8000);
  expect(ART_CYCLE.restart).toBeLessThan(1000);
 });
 it('plays the entire pool before repeating, with no repetition at bag boundaries',()=>{
  let bag:ArtSceneId[]=[],previous:ArtSceneId|null=null;
  const played:ArtSceneId[]=[];
  for(let i=0;i<ART_SCENES.length*3;i++){
   const next=nextScene(ART_SCENES,bag,previous,()=>0.37);
   expect(next.id).not.toBe(previous);
   played.push(next.id!);previous=next.id;bag=next.remaining;
  }
  for(let i=0;i<played.length;i+=ART_SCENES.length)expect(new Set(played.slice(i,i+ART_SCENES.length)).size).toBe(ART_SCENES.length);
 });
 it('drops disabled scenes and handles empty and single-scene pools',()=>{
  expect(nextScene([],['dream'],null).id).toBeNull();
  expect(nextScene(['sunflowers'],['dream'],'dream').id).toBe('sunflowers');
  expect(nextScene(['sunflowers'],[],'sunflowers').id).toBe('sunflowers');
 });
});
