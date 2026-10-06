import type { SliceRegion, SliceSettings } from './types';

export interface Component { x: number; y: number; width: number; height: number; pixels: number; }
export interface UniformGridSuggestion { rows: number; columns: number; confidence: number; }
export const sortRegions = <T extends { x: number; y: number }>(regions: T[]) => [...regions].sort((a, b) => a.y - b.y || a.x - b.x);
export function gridSlices(assetId: string, imageWidth: number, imageHeight: number, rows: number, columns: number): SliceRegion[] {
  const cellWidth = Math.floor(imageWidth / columns), cellHeight = Math.floor(imageHeight / rows);
  return Array.from({ length: rows * columns }, (_, i) => ({ id: crypto.randomUUID(), assetId, x: (i % columns) * cellWidth, y: Math.floor(i / columns) * cellHeight, width: cellWidth, height: cellHeight, order: i, mode: 'grid' }));
}
export function connectedComponents(alpha: Uint8ClampedArray, width: number, height: number, threshold: number): Component[] {
  const visited = new Uint8Array(width * height), components: Component[] = [], queue: number[] = [];
  for (let i = 0; i < width * height; i++) {
    if (visited[i] || alpha[i * 4 + 3] <= threshold) continue;
    visited[i] = 1; queue.push(i); let minX = i % width, maxX = minX, minY = Math.floor(i / width), maxY = minY, pixels = 0;
    for (let q = 0; q < queue.length; q++) { const p = queue[q], x = p % width, y = Math.floor(p / width); pixels++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const [nx, ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) if (nx >= 0 && ny >= 0 && nx < width && ny < height) { const n = ny * width + nx; if (!visited[n] && alpha[n * 4 + 3] > threshold) { visited[n] = 1; queue.push(n); } }
    }
    queue.length = 0; components.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, pixels });
  }
  return components;
}
export function groupedComponents(components: Component[], settings: SliceSettings): Component[] {
  const items = components.filter(c => c.width * c.height >= settings.minimumRegion * settings.minimumRegion).map(c => ({ ...c }));
  const used = new Set<number>(), result: Component[] = [];
  for (let i = 0; i < items.length; i++) { if (used.has(i)) continue; let x1 = items[i].x, y1 = items[i].y, x2 = x1 + items[i].width, y2 = y1 + items[i].height, pixels = items[i].pixels; used.add(i); let changed = true;
    while (changed) { changed = false; for (let j = 0; j < items.length; j++) if (!used.has(j)) { const c = items[j]; const dx = Math.max(0, Math.max(x1 - (c.x + c.width), c.x - x2)), dy = Math.max(0, Math.max(y1 - (c.y + c.height), c.y - y2)); if (Math.max(dx, dy) <= settings.groupingDistance) { x1 = Math.min(x1,c.x); y1 = Math.min(y1,c.y); x2 = Math.max(x2,c.x+c.width); y2 = Math.max(y2,c.y+c.height); pixels += c.pixels; used.add(j); changed = true; } } }
    result.push({ x: x1 - settings.padding, y: y1 - settings.padding, width: x2 - x1 + settings.padding * 2, height: y2 - y1 + settings.padding * 2, pixels });
  } return sortRegions(result);
}

function mergedInkRuns(ink: ArrayLike<number>, maxGap:number) {
  const runs:{start:number;end:number}[]=[];
  let start=-1,last=-1;
  for(let index=0;index<ink.length;index++){
    if(!ink[index]) continue;
    if(start<0){start=index;last=index;continue;}
    if(index-last-1<=maxGap){last=index;continue;}
    runs.push({start,end:last});start=index;last=index;
  }
  if(start>=0)runs.push({start,end:last});
  return runs;
}

function nearestDivisor(value:number, desired:number, minimum:number) {
  const candidates:number[]=[];
  for(let candidate=minimum;candidate<=Math.min(64,value);candidate++)if(value%candidate===0)candidates.push(candidate);
  return candidates.sort((a,b)=>Math.abs(a-desired)-Math.abs(b-desired)||b-a)[0]??desired;
}

/**
 * Finds a regular cell layout from alpha occupancy. It ignores individual component
 * bounds, so particles and sparse final frames cannot shift an animation's pivot.
 */
export function inferUniformGrid(rgba:Uint8ClampedArray,width:number,height:number,alphaThreshold:number):UniformGridSuggestion|null {
  const rowInk=new Uint32Array(height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(rgba[(y*width+x)*4+3]>alphaThreshold)rowInk[y]++;
  const rowRuns=mergedInkRuns(rowInk,Math.max(2,Math.round(height*.03)));
  if(!rowRuns.length)return null;
  const rows=nearestDivisor(height,rowRuns.length,1);
  const columnCounts=rowRuns.map(run=>{
    const ink=new Uint32Array(width);
    for(let y=run.start;y<=run.end;y++)for(let x=0;x<width;x++)if(rgba[(y*width+x)*4+3]>alphaThreshold)ink[x]++;
    return mergedInkRuns(ink,Math.max(3,Math.round(width*.006))).length;
  }).filter(Boolean);
  const detectedColumns=Math.max(...columnCounts,0);
  if(detectedColumns<2)return null;
  const columns=nearestDivisor(width,detectedColumns,2);
  const agreement=columnCounts.length?columnCounts.reduce((sum,count)=>sum+1-Math.min(1,Math.abs(count-columns)/Math.max(1,columns)),0)/columnCounts.length:0;
  return {rows,columns,confidence:Math.round(agreement*100)};
}
