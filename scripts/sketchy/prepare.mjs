// Reproducible runtime packing of the ImageGen alpha extractions. No artwork is redrawn.
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
const source = 'assets/sketchy/source/';
await mkdir('public/sketchy', { recursive: true });
const cells = {
 idle:[65,0,265,325], walk:[395,0,265,325], run:[710,0,305,325], jump:[1080,0,275,325],
 sit:[70,365,270,295], rest:[405,365,270,295], wave:[745,350,275,310], laugh:[1085,350,270,310],
 think:[20,700,265,325], curious:[295,700,260,325], celebrate:[570,700,260,325], point:[845,700,275,325], draw:[1135,700,270,325],
 holdSign:[150,35,1045,1105],
};
// Remove isolated low-alpha generation residue, retaining antialiased fur and expression marks.
async function clean(input, rect) {
 const { data, info } = await sharp(input).extract({left:rect[0],top:rect[1],width:rect[2],height:rect[3]}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const {width:w,height:h}=info; const seen=new Uint8Array(w*h); const keep=new Uint8Array(w*h);
 for(let p=0;p<w*h;p++) {
  if(seen[p] || data[p*4+3]<48) continue;
  const component=[p]; seen[p]=1;
  for(let i=0;i<component.length;i++) { const q=component[i],x=q%w,y=Math.floor(q/w);
   for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
    if(nx<0||nx>=w||ny<0||ny>=h)continue; const n=ny*w+nx;
    if(!seen[n]&&data[n*4+3]>=48){seen[n]=1;component.push(n);}
   }
  }
  if(component.length>=60) for(const q of component) keep[q]=1;
 }
 // Keep a one-pixel antialias fringe around retained components.
 for(let y=0;y<h;y++)for(let x=0;x<w;x++) { const p=y*w+x;
  if(!keep[p]&&!keep[p-1]&&!keep[p+1]&&!keep[p-w]&&!keep[p+w])data[p*4+3]=0;
 }
 return sharp(data,{raw:info}).png().toBuffer();
}
for(const [name,rect] of Object.entries(cells)) {
 let bytes=await clean(source+(name==='holdSign'?'sign-alpha.png':'poses-alpha.png'),rect);
 if(name==='holdSign') {
  // The live HTML sign replaces the small baked blank board. Keep his actual paw and post.
  bytes=await sharp(bytes).composite([{input:Buffer.from('<svg width="1045" height="1105"><path d="M650 70 L1045 70 L1045 560 L650 560 L650 450 L610 450 L640 380 L610 300 Z" fill="white"/></svg>'),blend:'dest-out'}]).png().toBuffer();
 }
 bytes=await sharp(bytes).trim({threshold:5}).png().toBuffer();
 const targetHeight=['sit','rest'].includes(name)?250:310;
 const {data,info}=await sharp(bytes).resize({width:280,height:targetHeight,fit:'inside'}).png().toBuffer({resolveWithObject:true});
 await sharp({create:{width:300,height:360,channels:4,background:'#00000000'}}).composite([{input:data,left:Math.round((300-info.width)/2),top:345-info.height}]).webp({quality:88,alphaQuality:100}).toFile(`public/sketchy/${name}.webp`);
}
await writeFile('public/sketchy/manifest.json',JSON.stringify({version:1,width:300,height:360,states:Object.keys(cells)},null,2)+'\n');

await sharp(source+'sign-alpha.png').extract({left:830,top:290,width:230,height:180}).webp({quality:80}).toFile('public/sketchy/parchment.webp');
