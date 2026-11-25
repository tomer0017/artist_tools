import sharp from 'sharp';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

// Technical sprite packing only. Artwork is authored by built-in ImageGen.
// One scale per whole scene: NEVER auto-trim or resize individual poses to fit.
const source='assets/sketchy/art/continuous-v2';
const target='public/sketchy/art/v2';
await mkdir(target,{recursive:true});
const {scenes}=JSON.parse(await readFile(`${source}/prompts.json`,'utf8'));
const W=640,H=360,foxHeight=280;
const config={
 'sunflowers':{height:288,floor:314,beat:420,sequence:[0,1,2,3,4,5,4,5,6,5,6,7,8,8,8]},
 'flower-crown':{height:294,floor:321,beat:420,sequence:[0,1,2,3,4,5,4,5,6,7,8,8,8]},
 'pearl':{height:285,floor:318,beat:460,sequence:[0,1,2,3,4,5,6,5,6,7,8,8,8]},
 'mona-lisa':{height:249,floor:309,beat:650,sequence:[0,1,2,3,4,5,6,5,6,7,8,8,8]},
 'scream':{height:291,floor:323,beat:360,sequence:[0,1,2,3,4,5,6,6,7,8,8]},
 'american-gothic':{height:254,floor:318,beat:500,sequence:[0,1,2,3,4,3,4,5,6,7,8,8,8]},
 'portrait-process':{height:292,floor:322,beat:500,sequence:[0,1,2,3,4,5,6,7,8,8,8]},
 'art-slots':{height:300,floor:322,beat:380,sequence:[0,1,2,3,4,5,4,5,4,5,6,7,8,8,8]},
};
const manifest={};
for(const {id} of scenes){
 const spec=config[id];
 const {data,info}=await sharp(`${source}/${id}${id==='mona-lisa'?'-clean':'-source'}.png`).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const frames=[];const scale=foxHeight/spec.height;
 for(let i=0;i<9;i++){
  const left=Math.round(i%3*info.width/3),top=Math.round(Math.floor(i/3)*info.height/3);
  const width=Math.round((i%3+1)*info.width/3)-left,height=Math.round((Math.floor(i/3)+1)*info.height/3)-top;
  const cell=await sharp(data,{raw:info}).extract({left,top,width,height}).raw().toBuffer();
  // Remove invisible RGB/low-alpha noise left by transparent generation. Retain soft fur edges.
  for(let p=0;p<cell.length;p+=4)if(cell[p+3]<20){cell[p]=0;cell[p+1]=0;cell[p+2]=0;cell[p+3]=0;}
  const resizedW=Math.round(width*scale),resizedH=Math.round(height*scale);
  const resized=await sharp(cell,{raw:{width,height,channels:4}}).resize(resizedW,resizedH).png().toBuffer();
  // Fixed floor and fixed scale in ALL frames, including seated poses and raised paws.
  const x=Math.round((W-resizedW)/2),y=Math.round(H-spec.floor*scale);
  const crop={left:Math.max(0,-x),top:Math.max(0,-y),width:Math.min(resizedW,W-x),height:Math.min(resizedH,H-y)};
  const input=await sharp(resized).extract(crop).png().toBuffer();
  frames.push(await sharp({create:{width:W,height:H,channels:4,background:'#00000000'}}).composite([{input,left:Math.max(0,x),top:Math.max(0,y)}]).raw().toBuffer());
 }
 const strip=await sharp({create:{width:W*9,height:H,channels:4,background:'#00000000'}}).composite(frames.map((input,i)=>({input,raw:{width:W,height:H,channels:4},left:i*W,top:0}))).webp({quality:88,alphaQuality:100}).toBuffer();
 await writeFile(`${target}/${id}.webp`,strip);
 await sharp(frames[0],{raw:{width:W,height:H,channels:4}}).webp({quality:88}).toFile(`${target}/${id}-poster.webp`);
 const animation=Buffer.concat(spec.sequence.map(frame=>frames[frame]));
 await sharp(animation,{raw:{width:W,height:H*spec.sequence.length,pageHeight:H,channels:4}}).webp({quality:88,alphaQuality:100,loop:0,delay:spec.sequence.map(()=>spec.beat)}).toFile(`${target}/${id}-animated.webp`);
 manifest[id]={frames:9,aspect:W/H,foxHeight:foxHeight/H,beat:spec.beat,sequence:spec.sequence,src:`/sketchy/art/v2/${id}.webp`,action:id==='art-slots'?'roulette':'tip',label:({sunflowers:['Sunflowers','חמניות'],'flower-crown':['Flower-crown portrait','דיוקן עם זר פרחים'],pearl:['Girl with a Pearl Earring','נערה עם עגיל פנינה'],'mona-lisa':['Mona Lisa','מונה ליזה'],scream:['The Scream','הצעקה'],'american-gothic':['American Gothic','אמריקן גותיק'],'portrait-process':['Painting a self-portrait','ציור דיוקן עצמי'],'art-slots':['Art slot machine','מכונת האמנות']})[id]};
 console.log(`${id}: 9 frames, ${strip.length} bytes, scale ${scale.toFixed(4)}`);
}
await writeFile('src/components/companion/art-scenes-v2.json',JSON.stringify(manifest,null,2)+'\n');
await writeFile(`${source}/calibration.json`,JSON.stringify({width:W,height:H,standingFoxHeight:foxHeight,scenes:config},null,2)+'\n');
