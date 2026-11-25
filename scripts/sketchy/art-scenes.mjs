import sharp from 'sharp';
// Packing only: original portrait frames and ImageGen-authored six-frame action sequences.
const src='assets/sketchy/art/';
const {width,height}=await sharp(src+'scenes-alpha.png').metadata();
async function clean(bytes){
 const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const w=info.width,h=info.height,seen=new Uint8Array(w*h),keep=new Uint8Array(w*h);
 for(let p=0;p<w*h;p++){
  if(seen[p]||data[p*4+3]<48)continue;const part=[p];seen[p]=1;
  for(let i=0;i<part.length;i++){const q=part[i],x=q%w,y=Math.floor(q/w);for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){if(nx<0||ny<0||nx>=w||ny>=h)continue;const n=ny*w+nx;if(!seen[n]&&data[n*4+3]>=48){seen[n]=1;part.push(n);}}}
  if(part.length>=90)for(const q of part)keep[q]=1;
 }
 for(let p=0;p<w*h;p++)if(data[p*4+3]<16||(!keep[p]&&!keep[p-1]&&!keep[p+1]&&!keep[p-w]&&!keep[p+w]))data[p*4+3]=0;
 return sharp(data,{raw:info}).png().toBuffer();
}
for(const [row,name] of ['machine','sketchbook','dream'].entries()){
 const frames=[];
 for(let col=0;col<6;col++){
  const left=Math.round(col*width/6),top=Math.round(row*height/3);
  const bytes=await sharp(src+'scenes-alpha.png').extract({left,top,width:Math.round((col+1)*width/6)-left,height:Math.round((row+1)*height/3)-top}).png().toBuffer();
  const image=await sharp(await clean(bytes)).resize(256,256,{fit:'contain',background:'#00000000'}).png().toBuffer();frames.push({input:image,left:col*256,top:0});
 }
 await sharp({create:{width:1536,height:256,channels:4,background:'#00000000'}}).composite(frames).webp({quality:88,alphaQuality:100}).toFile(`public/sketchy/art/${name}.webp`);
}
const frames=[];
for(let i=0;i<9;i++){
 const input=await sharp(src+'portrait-original.gif',{page:i,pages:1}).resize(384,256,{fit:'contain',background:'#00000000'}).png().toBuffer();frames.push({input,left:i*384,top:0});
}
await sharp({create:{width:3456,height:256,channels:4,background:'#00000000'}}).composite(frames).webp({quality:88,alphaQuality:100}).toFile('public/sketchy/art/portrait.webp');
