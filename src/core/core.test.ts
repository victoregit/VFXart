import { describe, expect, it } from 'vitest';
import { alphaBounds, normalizePlacement, numberedName } from './image';
import { connectedComponents, groupedComponents, gridSlices, inferUniformGrid } from './slice';
import { createProjectModel } from './project';
import { metadata, sheetDimensions } from './export';
import type { SpriteFrame } from './types';

describe('sprite core', () => {
  it('creates a deterministic row-major grid', () => {
    const grid=gridSlices('asset',100,80,2,5);
    expect(grid).toHaveLength(10); expect(grid[0]).toMatchObject({x:0,y:0,width:20,height:40,order:0}); expect(grid[5]).toMatchObject({x:0,y:40,order:5});
  });
  it('finds connected alpha components and deterministically groups nearby particles', () => {
    const data=new Uint8ClampedArray(10*5*4); for(const [x,y] of [[1,1],[2,1],[6,1],[7,1]]) data[(y*10+x)*4+3]=255;
    const components=connectedComponents(data,10,5,1); expect(components).toHaveLength(2);
    const merged=groupedComponents(components,{alphaThreshold:1,minimumRegion:1,padding:0,groupingDistance:4}); expect(merged).toHaveLength(1); expect(merged[0]).toMatchObject({x:1,y:1,width:7,height:1});
  });
  it('infers a fixed layout even when an animation cell only has a sparse final particle', () => {
    const width=160,height=80,data=new Uint8ClampedArray(width*height*4);
    // Two rows × four columns. Cell 8 intentionally contains only one fading pixel.
    for(let row=0;row<2;row++)for(let column=0;column<4;column++){
      const x=column*40+8,y=row*40+8;
      if(row===1&&column===3)data[(y*width+x)*4+3]=12;
      else for(let dy=0;dy<8;dy++)for(let dx=0;dx<8;dx++)data[((y+dy)*width+x+dx)*4+3]=255;
    }
    expect(inferUniformGrid(data,width,height,1)).toMatchObject({rows:2,columns:4});
    const grid=gridSlices('asset',width,height,2,4);
    expect(grid).toHaveLength(8);
    expect(grid.every(region=>region.width===40&&region.height===40)).toBe(true);
  });
  it('calculates transparent bounds and normalization placement', () => {
    const data=new Uint8ClampedArray(4*4*4); data[(2*4+1)*4+3]=255; expect(alphaBounds(data,4,4)).toEqual({x:1,y:2,width:1,height:1}); expect(normalizePlacement(10,5,32,32,'bottom-center')).toEqual({x:11,y:27});
  });
  it('creates predictable export names, dimensions and metadata', () => {
    const frames:SpriteFrame[]=[{id:'a',source:'a.png',originalSource:'a.png',revisions:[{id:'a:initial',source:'a.png',createdAt:'2020-01-01'}],activeRevisionId:'a:initial',width:16,height:8,offsetX:0,offsetY:0,anchorX:8,anchorY:8},{id:'b',source:'b.png',originalSource:'b.png',revisions:[{id:'b:initial',source:'b.png',createdAt:'2020-01-01'}],activeRevisionId:'b:initial',width:8,height:12,offsetX:0,offsetY:0,anchorX:4,anchorY:12}];
    const p=createProjectModel('p','Test');p.frames=frames;p.animation.frameIds=['a','b'];p.exportSettings={prefix:'blast',layout:'grid',columns:2,padding:2,includeMetadata:true};
    expect(numberedName('blast',0)).toBe('blast_001.png');expect(sheetDimensions(frames,p.exportSettings)).toMatchObject({width:34,height:12,columns:2,rows:1});expect(metadata(p,frames)).toMatchObject({name:'blast',frames:2,order:['a','b'],fps:12});
  });
});
