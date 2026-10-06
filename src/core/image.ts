export function alphaBounds(data: Uint8ClampedArray, width: number, height: number, threshold = 0) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) if (data[(y*width+x)*4+3] > threshold) { left=Math.min(left,x); top=Math.min(top,y); right=Math.max(right,x); bottom=Math.max(bottom,y); }
  return right < left ? { x: 0, y: 0, width: 1, height: 1 } : { x: left, y: top, width: right-left+1, height: bottom-top+1 };
}
export function normalizePlacement(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number, align: 'center'|'top-center'|'bottom-center') {
  return { x: Math.floor((targetWidth-sourceWidth)/2), y: align === 'top-center' ? 0 : align === 'bottom-center' ? targetHeight-sourceHeight : Math.floor((targetHeight-sourceHeight)/2) };
}
export const numberedName = (prefix: string, index: number) => `${prefix}_${String(index + 1).padStart(3, '0')}.png`;
