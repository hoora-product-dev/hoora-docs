import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist';
GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.min.mjs';
export async function mountPdf(root,bytes,filename){
 const original=bytes.slice(),pdf=await getDocument({data:bytes,isEvalSupported:false,cMapUrl:'/vendor/pdf/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdf/standard_fonts/',wasmUrl:'/vendor/pdf/wasm/'}).promise;
 let page=1,zoom=1,busy=false;
 async function draw(){if(busy||!root.isConnected)return;busy=true;try{const item=await pdf.getPage(page);const base=item.getViewport({scale:1}),width=Math.min(root.clientWidth-36,1000);const viewport=item.getViewport({scale:Math.max(0.3,width/base.width)*zoom});const canvas=root.querySelector('canvas'),ratio=Math.min(devicePixelRatio||1,2);canvas.width=viewport.width*ratio;canvas.height=viewport.height*ratio;canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';await item.render({canvasContext:canvas.getContext('2d'),viewport,transform:[ratio,0,0,ratio,0,0]}).promise;root.querySelector('[data-pdf-position]').textContent=`Page ${page} of ${pdf.numPages}`;root.querySelector('[data-pdf-prev]').disabled=page<=1;root.querySelector('[data-pdf-next]').disabled=page>=pdf.numPages;}finally{busy=false;}}
 root.querySelector('[data-pdf-prev]').onclick=()=>{if(page>1&&!busy){page--;draw()}};
 root.querySelector('[data-pdf-next]').onclick=()=>{if(page<pdf.numPages&&!busy){page++;draw()}};
 root.querySelector('[data-pdf-zoom-in]').onclick=()=>{zoom=Math.min(zoom+0.2,2.5);draw()};
 root.querySelector('[data-pdf-zoom-out]').onclick=()=>{zoom=Math.max(zoom-0.2,0.5);draw()};
 root.querySelector('[data-pdf-full]').onclick=()=>root.requestFullscreen?.();
 root.querySelector('[data-pdf-download]').onclick=()=>{const url=URL.createObjectURL(new Blob([original],{type:'application/pdf'})),a=document.createElement('a');a.href=url;a.download=filename||'document.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
 await draw();
}
