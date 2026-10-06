import { processFrame, suggestPixelArtSettings } from '../core/pixel-processing';
import type { PixelProcessingSettings } from '../core/pixel-processing';
import { analyzeUpgrade, previewUpgrade } from '../core/upgrade';
import type { UpgradeAnalysisOptions } from '../core/upgrade';

type ProcessRequest={kind:'process';id:number;width:number;height:number;data:ArrayBuffer;settings:Partial<PixelProcessingSettings>};
type SuggestRequest={kind:'suggest';id:number;width:number;height:number;data:ArrayBuffer};
type UpgradeFrame={id:string;width:number;height:number;data:ArrayBuffer;offsetX:number;offsetY:number;anchorX:number;anchorY:number;source:string};
type UpgradeAnalysisRequest={kind:'upgrade-analysis';id:number;frames:UpgradeFrame[];options:UpgradeAnalysisOptions};
type UpgradePreviewRequest={kind:'upgrade-preview';id:number;frames:UpgradeFrame[];options:UpgradeAnalysisOptions};
type Request=ProcessRequest|SuggestRequest|UpgradeAnalysisRequest|UpgradePreviewRequest;
type WorkerScope={onmessage:unknown;postMessage:(message:unknown,transfer?:Transferable[])=>void};
const worker=self as unknown as WorkerScope;

worker.onmessage=(event:MessageEvent<Request>)=>{
  const request=event.data;
  if(request.kind==='upgrade-analysis'||request.kind==='upgrade-preview'){
    const frames=request.frames.map(frame=>({...frame,frame:{width:frame.width,height:frame.height,data:new Uint8ClampedArray(frame.data)}}));
    if(request.kind==='upgrade-analysis'){worker.postMessage({kind:'upgrade-analysis',id:request.id,analysis:analyzeUpgrade(frames,request.options)});return;}
    const result=previewUpgrade(frames,request.options),outputs=result.frames.map(frame=>({id:frame.id,inputSource:frame.inputSource,width:frame.width,height:frame.height,anchorX:frame.anchorX,anchorY:frame.anchorY,offsetX:frame.offsetX,offsetY:frame.offsetY,data:Uint8ClampedArray.from(frame.frame.data).buffer}));
    worker.postMessage({kind:'upgrade-preview',id:request.id,analysis:result.analysis,frames:outputs},outputs.map(frame=>frame.data));
    return;
  }
  const frame={width:request.width,height:request.height,data:new Uint8ClampedArray(request.data)};
  if(request.kind==='suggest'){
    worker.postMessage({kind:'suggestion',id:request.id,suggestion:suggestPixelArtSettings(frame)});
    return;
  }
  const result=processFrame(frame,request.settings),output=Uint8ClampedArray.from(result.data).buffer;
  worker.postMessage({kind:'processed',id:request.id,width:result.width,height:result.height,data:output},[output]);
};
