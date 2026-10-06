import { resolveSettings } from './presets';
import { sanitizeFrame } from './processor2';
import type { PixelAutoEnhanceMetrics, PixelAutoEnhanceSuggestion, RawFrame } from './types';

export const AUTO_ENHANCE_VERSION = '1';

const pixelOffset = (x:number, y:number, width:number) => (y * width + x) * 4;
const neighbors = (x:number, y:number, width:number, height:number) => {
  const result:number[] = [];
  for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
    if (!dx && !dy) continue;
    const nx=x+dx, ny=y+dy;
    if (nx>=0 && ny>=0 && nx<width && ny<height) result.push(ny * width + nx);
  }
  return result;
};

/**
 * Produces a conservative, deterministic suggestion for existing raster sprites.
 * It deliberately preserves dimensions and avoids stylistic changes; the user can
 * inspect the normal Process preview and edit every suggested setting before Apply.
 */
export function suggestPixelArtSettings(input:RawFrame):PixelAutoEnhanceSuggestion {
  const frame=sanitizeFrame(input), pixels=frame.width*frame.height, seen=new Uint8Array(pixels), colors=new Set<number>();
  let visible=0, semi=0, opaque=0, isolated=0, minLuminance=255, maxLuminance=0;

  for(let i=0;i<frame.data.length;i+=4){
    const alpha=frame.data[i+3];
    if(!alpha) continue;
    visible++;
    if(alpha<255) semi++; else opaque++;
    colors.add((frame.data[i]<<16)|(frame.data[i+1]<<8)|frame.data[i+2]);
    const luminance=.2126*frame.data[i]+.7152*frame.data[i+1]+.0722*frame.data[i+2];
    minLuminance=Math.min(minLuminance,luminance); maxLuminance=Math.max(maxLuminance,luminance);
  }

  for(let start=0;start<pixels;start++){
    if(seen[start]||!frame.data[start*4+3]) continue;
    const queue=[start]; let size=0; seen[start]=1;
    for(let cursor=0;cursor<queue.length;cursor++){
      const index=queue[cursor], x=index%frame.width, y=Math.floor(index/frame.width);
      size++;
      for(const next of neighbors(x,y,frame.width,frame.height)) if(!seen[next]&&frame.data[next*4+3]){seen[next]=1;queue.push(next);}
    }
    if(size===1) isolated++;
  }

  const semiRatio=visible?semi/visible:0, isolatedRatio=visible?isolated/visible:0;
  const metrics:PixelAutoEnhanceMetrics={
    visiblePixels:visible, semiTransparentPixels:semi, semiTransparentRatio:semiRatio,
    uniqueVisibleColors:colors.size, isolatedPixelComponents:isolated,
    luminanceRange:visible?Math.round(maxLuminance-minLuminance):0
  };
  const settings=resolveSettings({});
  const reasons=['Resolution preserved'];

  if(colors.size>16){
    settings.colorCount=colors.size<=48?16:32;
    reasons.push(`${settings.colorCount}-color palette suggested`);
  }else reasons.push('Source palette preserved');

  // A tiny fringe is usually import noise on an otherwise crisp sprite. Soft alpha
  // that materially contributes to the sprite is retained for anti-aliased art/VFX.
  if(visible>0 && opaque/visible>=.96 && semiRatio<=.04){
    settings.minimumAlpha=8;
    settings.alphaThreshold=8;
    reasons.push('Low-alpha fringe cleaned');
  }else if(semi>0) reasons.push('Soft alpha preserved');

  // Only propose one-pixel island removal when detached pixels are demonstrably rare.
  if(visible>=64 && opaque/visible>=.96 && isolated>0 && isolatedRatio<=.03){
    settings.minIslandSize=2;
    reasons.push('Rare isolated pixels removed');
  }

  return {version:AUTO_ENHANCE_VERSION,settings,metrics,reasons};
}
