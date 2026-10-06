import { extractPalette, processFrame, resolveSettings } from '../pixel-processing';
import type { PixelProcessingSettings, RawFrame, Rgb } from '../pixel-processing';

export const UPGRADE_VERSION='1';
export type UpgradeProfile='clean'|'pixel-art'|'strong';
export interface Bounds { x:number;y:number;width:number;height:number; }
export interface UpgradeFrameInput { id:string; frame:RawFrame; offsetX:number; offsetY:number; anchorX:number; anchorY:number; source:string; }
export interface UpgradeWarning { code:'bounds-variation'|'alpha-spike'|'one-frame-noise'|'palette-flicker'; message:string; frameId?:string; }
export interface UpgradeAnalysisOptions { profile?:UpgradeProfile; strength?:number; padding?:number; target?:{width:number;height:number}|null; alphaMinimum?:number; }
export interface FramingTransform { bounds:Bounds; canvasWidth:number; canvasHeight:number; contentWidth:number; contentHeight:number; scale:number; padX:number; padY:number; }
export interface ResolvedUpgradeSettings { processor:PixelProcessingSettings; palette:Rgb[]; framing:FramingTransform; profile:UpgradeProfile; strength:number; targetAutoReduced:boolean; }
export interface UpgradeAnalysisResult { frameCount:number; globalBounds:Bounds; originalWidth:number; originalHeight:number; recommendedWidth:number; recommendedHeight:number; originalColorCount:number; recommendedColorCount:number; sharedPalette:Rgb[]; alphaStats:{transparentPixels:number;semiTransparentPixels:number;visiblePixels:number}; cleanupRecommendation:{minIslandSize:number;maxHoleSize:number}; warnings:UpgradeWarning[]; recommendedSettings:ResolvedUpgradeSettings; }
export interface UpgradeProvenance { upgradeVersion:string; profile:UpgradeProfile; strength:number; settings:PixelProcessingSettings; target:{width:number;height:number}; sharedPalette:Rgb[]; sourceRevisionId?:string; globalBounds:Bounds; framing:FramingTransform; }
export interface UpgradeFrameOutput { id:string; inputSource:string; frame:RawFrame; width:number;height:number;anchorX:number;anchorY:number;offsetX:number;offsetY:number; }

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const pixel=(x:number,y:number,width:number)=>(y*width+x)*4;
const emptyBounds=():Bounds=>({x:0,y:0,width:1,height:1});
const colorKey=(r:number,g:number,b:number)=>(r<<16)|(g<<8)|b;

export function visibleBounds(frame:RawFrame,minimumAlpha=8):Bounds|null {
  let minX=frame.width,minY=frame.height,maxX=-1,maxY=-1;
  for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++)if(frame.data[pixel(x,y,frame.width)+3]>=minimumAlpha){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  return maxX<0?null:{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1};
}
export function documentBounds(input:UpgradeFrameInput,minimumAlpha=8):Bounds|null { const local=visibleBounds(input.frame,minimumAlpha);return local?{...local,x:local.x+input.offsetX,y:local.y+input.offsetY}:null; }
/** The Cutter's canvas is authoritative: Upgrade never infers a replacement crop. */
export function frameCanvasBounds(input:UpgradeFrameInput):Bounds { return {x:input.offsetX,y:input.offsetY,width:input.frame.width,height:input.frame.height}; }
export function unionBounds(bounds:Bounds[],padding=0):Bounds { if(!bounds.length)return emptyBounds();const left=Math.min(...bounds.map(b=>b.x)),top=Math.min(...bounds.map(b=>b.y)),right=Math.max(...bounds.map(b=>b.x+b.width)),bottom=Math.max(...bounds.map(b=>b.y+b.height));return {x:left-padding,y:top-padding,width:Math.max(1,right-left+padding*2),height:Math.max(1,bottom-top+padding*2)}; }

function balancedPalette(frames:UpgradeFrameInput[],count:number,minimumAlpha:number):Rgb[] {
  if(!count||!frames.length)return [];
  const budget=512, samples:number[]=[];
  for(const entry of frames){
    const visible:number[]=[];
    for(let index=0;index<entry.frame.width*entry.frame.height;index++)if(entry.frame.data[index*4+3]>=minimumAlpha)visible.push(index);
    if(!visible.length)continue;
    const step=Math.max(1,Math.ceil(visible.length/budget));
    for(let i=0;i<visible.length;i+=step){const p=visible[i]*4;samples.push(entry.frame.data[p],entry.frame.data[p+1],entry.frame.data[p+2],entry.frame.data[p+3]);}
  }
  return samples.length?extractPalette({width:samples.length/4,height:1,data:new Uint8ClampedArray(samples)},{colorCount:count,minimumAlpha}):[];
}

function countColors(frames:UpgradeFrameInput[],minimumAlpha:number){const colors=new Set<number>();for(const entry of frames)for(let i=0;i<entry.frame.data.length;i+=4)if(entry.frame.data[i+3]>=minimumAlpha)colors.add(colorKey(entry.frame.data[i],entry.frame.data[i+1],entry.frame.data[i+2]));return colors.size;}
function alphaStats(frames:UpgradeFrameInput[],minimumAlpha:number){let transparent=0,semi=0,visible=0;for(const entry of frames)for(let i=3;i<entry.frame.data.length;i+=4){const a=entry.frame.data[i];if(a<minimumAlpha)transparent++;else{visible++;if(a<255)semi++;}}return {transparentPixels:transparent,semiTransparentPixels:semi,visiblePixels:visible};}
function standardTarget(width:number,height:number,colorCount:number,semi:number){const longest=Math.max(width,height),area=width*height;if(longest<128||area<16384||colorCount<96||semi<Math.max(16,area*.03))return null;const candidates=[256,128,96,64,48,32].filter(candidate=>candidate<longest&&longest/candidate>=1.8);const target=candidates[0];if(!target)return null;const scale=target/longest;return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};}
function makeFraming(bounds:Bounds,target:{width:number;height:number}|null,colors:number,semi:number):{framing:FramingTransform;reduced:boolean}{const automatic=!target,chosen=target??standardTarget(bounds.width,bounds.height,colors,semi)??{width:bounds.width,height:bounds.height};const scale=Math.min(chosen.width/bounds.width,chosen.height/bounds.height);const contentWidth=Math.max(1,Math.round(bounds.width*scale)),contentHeight=Math.max(1,Math.round(bounds.height*scale));return {reduced:automatic&&(contentWidth<bounds.width||contentHeight<bounds.height),framing:{bounds,canvasWidth:chosen.width,canvasHeight:chosen.height,contentWidth,contentHeight,scale,padX:Math.floor((chosen.width-contentWidth)/2),padY:Math.floor((chosen.height-contentHeight)/2)}};}

export function resolveUpgradeStrength(profile:UpgradeProfile,strength:number,analysis:Pick<UpgradeAnalysisResult,'globalBounds'|'originalColorCount'|'alphaStats'>,options:UpgradeAnalysisOptions={}):ResolvedUpgradeSettings {
  const value=clamp(Math.round(strength),0,100), framingResult=makeFraming(analysis.globalBounds,options.target??null,analysis.originalColorCount,analysis.alphaStats.semiTransparentPixels);
  const band=value<=30?'low':value<=70?'medium':'high';
  const colorCount=profile==='clean'?(analysis.originalColorCount>64&&band==='high'?32:0):profile==='pixel-art'?(band==='low'?32:band==='medium'?16:8):(band==='low'?16:band==='medium'?8:6);
  const alphaThreshold=profile==='clean'?Math.min(8,Math.round(value/20)):profile==='pixel-art'?Math.round(value*.14):Math.round(8+value*.22);
  const minIslandSize=profile==='clean'?(value>=70?2:0):profile==='pixel-art'?(value<35?1:value<80?2:3):(value<35?2:value<75?3:5);
  const maxHoleSize=profile==='clean'?0:profile==='pixel-art'?(value>=55?1:0):(value>=35?1:2);
  const settings=resolveSettings({targetWidth:framingResult.framing.contentWidth,targetHeight:framingResult.framing.contentHeight,minimumAlpha:Math.max(1,Math.min(16,alphaThreshold||1)),alphaThreshold,alphaLevels:0,brightness:0,saturation:profile==='strong'&&value>60?8:0,hue:0,contrast:profile==='clean'?0:profile==='pixel-art'&&value>60?5:Math.round(value*.14),gradientStops:[],colorCount,customPalette:[],dithering:'none',ditherStrength:0,minIslandSize,maxHoleSize,outline:'none',outlineColor:{r:0,g:0,b:0}});
  return {processor:settings,palette:[],framing:framingResult.framing,profile,strength:value,targetAutoReduced:framingResult.reduced};
}

function isolatedClusters(frame:RawFrame,minimumAlpha:number){const seen=new Uint8Array(frame.width*frame.height);let count=0;for(let start=0;start<seen.length;start++){if(seen[start]||frame.data[start*4+3]<minimumAlpha)continue;const queue=[start];seen[start]=1;for(let cursor=0;cursor<queue.length;cursor++){const point=queue[cursor],x=point%frame.width,y=Math.floor(point/frame.width);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy,next=ny*frame.width+nx;if((!dx&&!dy)||nx<0||ny<0||nx>=frame.width||ny>=frame.height||seen[next]||frame.data[next*4+3]<minimumAlpha)continue;seen[next]=1;queue.push(next);}}if(queue.length<=2)count++;}return count;}
function temporalWarnings(frames:UpgradeFrameInput[],bounds:Bounds[],stats:{visible:number;semi:number}[],clusters:number[]):UpgradeWarning[]{const warnings:UpgradeWarning[]=[];const median=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]??0;const areas=bounds.map(b=>b.width*b.height),visible=stats.map(s=>s.visible),semi=stats.map(s=>s.semi),areaMedian=median(areas),visibleMedian=median(visible),semiMedian=median(semi);frames.forEach((frame,index)=>{if(areaMedian&&areas[index]>areaMedian*1.75)warnings.push({code:'bounds-variation',frameId:frame.id,message:`Frame ${index+1} has unusually large visible bounds.`});if(visibleMedian&&Math.abs(visible[index]-visibleMedian)>visibleMedian*.65)warnings.push({code:'alpha-spike',frameId:frame.id,message:`Frame ${index+1} has an alpha coverage spike.`});if(semiMedian&&Math.abs(semi[index]-semiMedian)>Math.max(8,semiMedian*.8))warnings.push({code:'palette-flicker',frameId:frame.id,message:`Frame ${index+1} has an unusual semi-transparent color distribution.`});if(clusters[index]>0&&clusters.filter(value=>value>0).length===1)warnings.push({code:'one-frame-noise',frameId:frame.id,message:`Frame ${index+1} contains ${clusters[index]} small cluster(s) seen only in this frame.`});});return warnings;}

export function analyzeUpgrade(frames:UpgradeFrameInput[],options:UpgradeAnalysisOptions={}):UpgradeAnalysisResult {
  const profile=options.profile??'pixel-art',strength=options.strength??70,minimumAlpha=options.alphaMinimum??8,
    // Visible bounds are useful for warnings only. Framing comes from the cells
    // already confirmed in Cutter, so sparse VFX frames retain their fixed point.
    frameBounds=frames.map(frame=>documentBounds(frame,minimumAlpha)).filter((value):value is Bounds=>Boolean(value)),
    globalBounds=unionBounds(frames.map(frameCanvasBounds),Math.max(0,options.padding??2)),colors=countColors(frames,minimumAlpha),alpha=alphaStats(frames,minimumAlpha),perFrameStats=frames.map(frame=>{const s=alphaStats([frame],minimumAlpha);return {visible:s.visiblePixels,semi:s.semiTransparentPixels};});
  const base={globalBounds,originalColorCount:colors,alphaStats:alpha} as Pick<UpgradeAnalysisResult,'globalBounds'|'originalColorCount'|'alphaStats'>;
  const resolved=resolveUpgradeStrength(profile,strength,base,options),palette=balancedPalette(frames,resolved.processor.colorCount,resolved.processor.minimumAlpha);resolved.palette=palette;resolved.processor.customPalette=palette;
  const warnings=temporalWarnings(frames,frames.map(frame=>documentBounds(frame,minimumAlpha)??emptyBounds()),perFrameStats,frames.map(frame=>isolatedClusters(frame.frame,minimumAlpha)));if(palette.length)warnings.unshift({code:'palette-flicker',message:'Shared palette is stable across the animation.'});
  return {frameCount:frames.length,globalBounds,originalWidth:Math.max(1,...frames.map(f=>f.frame.width)),originalHeight:Math.max(1,...frames.map(f=>f.frame.height)),recommendedWidth:resolved.framing.canvasWidth,recommendedHeight:resolved.framing.canvasHeight,originalColorCount:colors,recommendedColorCount:palette.length,sharedPalette:palette,alphaStats:alpha,cleanupRecommendation:{minIslandSize:resolved.processor.minIslandSize,maxHoleSize:resolved.processor.maxHoleSize},warnings,recommendedSettings:resolved};
}

function cropToGlobal(input:UpgradeFrameInput,framing:FramingTransform):RawFrame { const out=new Uint8ClampedArray(framing.bounds.width*framing.bounds.height*4);const originX=input.offsetX-framing.bounds.x,originY=input.offsetY-framing.bounds.y;for(let y=0;y<input.frame.height;y++)for(let x=0;x<input.frame.width;x++){const dx=x+originX,dy=y+originY;if(dx<0||dy<0||dx>=framing.bounds.width||dy>=framing.bounds.height)continue;const source=pixel(x,y,input.frame.width),target=pixel(dx,dy,framing.bounds.width);out[target]=input.frame.data[source];out[target+1]=input.frame.data[source+1];out[target+2]=input.frame.data[source+2];out[target+3]=input.frame.data[source+3];}return {width:framing.bounds.width,height:framing.bounds.height,data:out}; }
function letterbox(input:RawFrame,framing:FramingTransform):RawFrame { const out=new Uint8ClampedArray(framing.canvasWidth*framing.canvasHeight*4);for(let y=0;y<input.height;y++)for(let x=0;x<input.width;x++){const source=pixel(x,y,input.width),target=pixel(x+framing.padX,y+framing.padY,framing.canvasWidth);out[target]=input.data[source];out[target+1]=input.data[source+1];out[target+2]=input.data[source+2];out[target+3]=input.data[source+3];}return {width:framing.canvasWidth,height:framing.canvasHeight,data:out}; }
export function transformAnchor(input:UpgradeFrameInput,framing:FramingTransform){return {x:Math.round((input.anchorX+input.offsetX-framing.bounds.x)*framing.scale)+framing.padX,y:Math.round((input.anchorY+input.offsetY-framing.bounds.y)*framing.scale)+framing.padY};}
export function transformOffset(_input:UpgradeFrameInput,_framing:FramingTransform){return {x:0,y:0};}
export function renderUpgradeFrame(input:UpgradeFrameInput,analysis:UpgradeAnalysisResult):UpgradeFrameOutput { const framing=analysis.recommendedSettings.framing,framed=cropToGlobal(input,framing),settings={...analysis.recommendedSettings.processor,targetWidth:framing.contentWidth,targetHeight:framing.contentHeight},processed=processFrame(framed,settings),anchor=transformAnchor(input,framing),offset=transformOffset(input,framing);return {id:input.id,inputSource:input.source,frame:letterbox(processed,framing),width:framing.canvasWidth,height:framing.canvasHeight,anchorX:anchor.x,anchorY:anchor.y,offsetX:offset.x,offsetY:offset.y}; }
export function previewUpgrade(frames:UpgradeFrameInput[],options:UpgradeAnalysisOptions={}){const analysis=analyzeUpgrade(frames,options);return {analysis,frames:frames.map(frame=>renderUpgradeFrame(frame,analysis))};}
