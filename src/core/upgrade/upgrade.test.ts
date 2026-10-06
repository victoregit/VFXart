import { describe, expect, it } from 'vitest';
import { analyzeUpgrade, previewUpgrade, unionBounds } from './index';
import type { UpgradeFrameInput } from './index';

const frame=(id:string,width:number,height:number,pixels:Array<[number,number,number,number]>,offsetX=0,offsetY=0):UpgradeFrameInput=>({id,source:`frames/${id}.png`,offsetX,offsetY,anchorX:Math.floor(width/2),anchorY:Math.floor(height/2),frame:{width,height,data:new Uint8ClampedArray(pixels.flat())}});
const solid=(width:number,height:number,color:[number,number,number,number])=>Array.from({length:width*height},()=>color);

describe('Upgrade core',()=>{
  it('builds document-space global bounds with padding',()=>{
    const first=frame('a',4,4,solid(4,4,[255,0,0,255]),10,20),second=frame('b',2,2,solid(2,2,[0,255,0,255]),16,23);
    const result=analyzeUpgrade([first,second],{padding:2});
    expect(result.globalBounds).toEqual({x:8,y:18,width:12,height:9});
  });
  it('preserves aspect ratio through transparent letterboxing and transforms anchors',()=>{
    const source=frame('wide',120,80,solid(120,80,[50,100,150,255]));
    const preview=previewUpgrade([source],{profile:'pixel-art',strength:70,padding:0,target:{width:96,height:96}});
    expect(preview.frames[0].frame).toMatchObject({width:96,height:96});
    expect(preview.analysis.recommendedSettings.framing).toMatchObject({contentWidth:96,contentHeight:64,padX:0,padY:16});
    expect(preview.frames[0].anchorX).toBe(48);expect(preview.frames[0].anchorY).toBe(48);
  });
  it('balances shared-palette samples so a large frame cannot hide a small frame color',()=>{
    const dominant=frame('dominant',80,20,solid(80,20,[255,0,0,255]));
    const rare=frame('rare',2,2,solid(2,2,[0,0,255,255]));
    const result=analyzeUpgrade([dominant,rare],{profile:'pixel-art',strength:70,padding:0});
    expect(result.sharedPalette.some(color=>color.b>150)).toBe(true);
    expect(analyzeUpgrade([dominant,rare],{profile:'pixel-art',strength:70,padding:0}).sharedPalette).toEqual(result.sharedPalette);
  });
  it('keeps Target Auto conservative for already-small pixel sprites',()=>{
    const sprite=frame('small',32,32,solid(32,32,[100,120,140,255]));
    const result=analyzeUpgrade([sprite],{profile:'pixel-art',strength:70,padding:0});
    expect(result.recommendedWidth).toBe(32);expect(result.recommendedHeight).toBe(32);
  });
  it('reports temporal changes and has deterministic unions',()=>{
    expect(unionBounds([{x:2,y:3,width:4,height:5},{x:0,y:4,width:3,height:2}],1)).toEqual({x:-1,y:2,width:8,height:7});
    const normal=frame('normal',8,8,solid(8,8,[1,2,3,255])),normalTwo=frame('normal-two',8,8,solid(8,8,[1,2,3,255]));
    const large=frame('large',20,20,solid(20,20,[1,2,3,255]));
    expect(analyzeUpgrade([normal,normalTwo,large],{padding:0}).warnings.some(warning=>warning.code==='bounds-variation')).toBe(true);
  });
});
