import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { encodeRgbPng } from "./text-editor.mjs";
const binary=process.argv[2]??new URL("../../target/wasm32-unknown-unknown/release/iimg_web.wasm",import.meta.url);
const wasm=(await WebAssembly.instantiate(await readFile(binary))).instance.exports;
const output=()=>Buffer.from(new Uint8Array(wasm.memory.buffer,wasm.output_ptr(),wasm.output_len()));
function input(bytes){const p=wasm.prepare_input(bytes.length);assert.ok(p);new Uint8Array(wasm.memory.buffer,p,bytes.length).set(bytes);}
for(const [width,height]of [[1,1],[127,53],[1024,256]]){
  const rgba=new Uint8Array(width*height*4),rgb=Buffer.alloc(width*height*3);
  for(let i=0;i<width*height;i++)for(let c=0;c<3;c++)rgb[i*3+c]=rgba[i*4+c]=(i*17+c*71)%256;
  const png=Buffer.from(encodeRgbPng(width,height,rgba));const idats=[];
  for(let at=8;at<png.length;){const n=png.readUInt32BE(at);if(png.toString("ascii",at+4,at+8)==="IDAT")idats.push(png.subarray(at+8,at+8+n));at+=n+12;}
  const filtered=inflateSync(Buffer.concat(idats));assert.equal(filtered.length,height*(width*3+1));
  for(let y=0;y<height;y++){assert.equal(filtered[y*(width*3+1)],0);assert.deepEqual(filtered.subarray(y*(width*3+1)+1,(y+1)*(width*3+1)),rgb.subarray(y*width*3,(y+1)*width*3));}
  const source={width,height,scene:{background:[0,0,0],objects:[{type:"image",id:"text",asset:"text",x:0,y:0}]},assets:[{id:"text",png_base64:png.toString("base64"),text:{text:"مرحبا Hello",font_family:"sans-serif",font_size:32,direction:"rtl",color:[255,255,255],background:[0,0,0]}}],accessibility:{description:"نص عربي ولاتيني",language:"ar"}};
  input(Buffer.from(JSON.stringify(source)));assert.equal(wasm.compile_source_v1(),0,output().toString());
  const file=output();input(file);assert.equal(wasm.load(),0);assert.equal(wasm.render(),0);assert.deepEqual(output(),rgb);
  wasm.describe();assert.equal(JSON.parse(output()).accessibility.language,"ar");
  if(process.env.IIMG_OLD_WASM){const old=(await WebAssembly.instantiate(await readFile(process.env.IIMG_OLD_WASM))).instance.exports;const p=old.prepare_input(file.length);new Uint8Array(old.memory.buffer,p,file.length).set(file);assert.equal(old.load(),0);assert.equal(old.render(),0);assert.deepEqual(Buffer.from(new Uint8Array(old.memory.buffer,old.output_ptr(),old.output_len())),rgb);}
}
assert.throws(()=>encodeRgbPng(1025,1,new Uint8Array(4100)));
console.log("RGB text PNG: small, multi-row and maximum multi-DEFLATE-block images matched independent zlib and Core/WASM pixels; source hints and aTXT do not alter raster data.");
