// Controlled repeated full-host load/use/reset/unload. Measurements are samples,
// not peak memory, paint latency or proof of absence of every possible leak.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import os from "node:os";
import { chromium } from "playwright-core";
import { residentSample } from "./process-sample.mjs";
const root=new URL("../../",import.meta.url),iterations=Number(process.env.IIMG_LIFECYCLE_ITERATIONS??50);
assert.ok(Number.isInteger(iterations)&&iterations>=10&&iterations<=200);
const output=resolve(process.argv[2]??fileURLToPath(new URL("target/lifecycle.json",root)));
const sha=(bytes)=>createHash("sha256").update(bytes).digest("hex");
const files=["target/showcase/workload-2048.iimg","tests/fixtures/state-actions/panel.iimg","tests/fixtures/motion/motion.iimg","tests/fixtures/drag/drag.iimg"];
const fixtureRecords=await Promise.all(files.map(async(file)=>{const bytes=await readFile(new URL(file,root));return{file,bytes:bytes.length,sha256:sha(bytes)};}));
const shell=new Set(["index.html","viewer.mjs","editor.mjs","state-editor.mjs","drag-editor.mjs","text-editor.mjs","offline.js","iimg_web.wasm"]);
const server=createServer(async(req,res)=>{
  const name=req.url==="/"?"index.html":req.url.slice(1);
  if(!shell.has(name)){res.writeHead(404).end();return;}
  try{const path=name==="iimg_web.wasm"?new URL("target/wasm32-unknown-unknown/release/iimg_web.wasm",root):new URL(name,import.meta.url);
    const type=name.endsWith(".wasm")?"application/wasm":name.endsWith(".html")?"text/html":"text/javascript";
    res.writeHead(200,{"Content-Type":type}).end(await readFile(path));
  }catch{res.writeHead(500).end();}
});
await new Promise((done,fail)=>{server.once("error",fail);server.listen(0,"127.0.0.1",done);});
let browser;
try{
  browser=await chromium.launch(process.env.IIMG_CHROMIUM?{executablePath:process.env.IIMG_CHROMIUM}:process.env.IIMG_PLAYWRIGHT_CHROMIUM==="1"?{}:{channel:"chrome"});
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:"reduce"});
  const errors=[];page.on("pageerror",(error)=>errors.push(error.message));
  await page.addInitScript(()=>{
    const instantiate=WebAssembly.instantiate;
    WebAssembly.instantiate=async(...args)=>{const result=await instantiate(...args);window.iimgTestEngine??=(result.instance??result).exports;return result;};
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>!document.querySelector("#file").disabled);
  const session=await page.context().newCDPSession(page),processSession=await browser.newBrowserCDPSession();
  await session.send("Performance.enable");
  async function sample(round,phase){
    await session.send("HeapProfiler.collectGarbage");
    const {metrics}=await session.send("Performance.getMetrics");
    return{round,phase,wasmCapacityBytes:await page.evaluate(()=>window.iimgTestEngine.memory.buffer.byteLength),
      javascriptHeap:Object.fromEntries(metrics.filter(({name})=>name.startsWith("JSHeap")).map(({name,value})=>[name,value])),
      browserProcesses:await residentSample(processSession)};
  }
  async function cycle(file){
    const start=performance.now();await page.locator("#file").setInputFiles(fileURLToPath(new URL(file,root)));
    await page.waitForFunction(()=>document.querySelector("#status").textContent.startsWith("Image ready"));
    const ready=performance.now()-start;
    const firstButton=page.locator("#controls button:visible").first();
    if(await firstButton.count())await firstButton.click();
    const firstRange=page.locator("#sliders input:visible").first();
    if(await firstRange.count()){await firstRange.focus();await page.keyboard.press("End");}
    if(await page.locator("#reset").isVisible())await page.locator("#reset").click();
    await page.locator("#file").setInputFiles([]);
    await page.waitForFunction(()=>document.querySelector("#status").textContent==="Choose an IIMG file.");
    const cleared=await page.evaluate(()=>({width:document.querySelector("#scene").width,height:document.querySelector("#scene").height,
      buttons:document.querySelector("#controls").children.length,ranges:document.querySelector("#sliders").children.length,
      output:window.iimgTestEngine.output_len(),render:window.iimgTestEngine.render()}));
    assert.deepEqual(cleared,{width:1,height:1,buttons:0,ranges:0,output:0,render:1});return ready;
  }
  for(let round=0;round<2;round++)for(const file of files)await cycle(file);
  const samples=[await sample(0,"after-warmup-unload")],latencies=[];
  for(let round=1;round<=iterations;round++){
    const file=files[(round-1)%files.length];latencies.push({round,file,readyObservedMs:await cycle(file)});
    if(round%10===0||round===iterations)samples.push(await sample(round,"after-unload"));
  }
  assert.deepEqual(errors,[]);
  const baseline=samples[0];
  // Fixed warmed workloads should reuse WASM capacity; a small allocator/page
  // tolerance avoids equating a one-time capacity step with unbounded growth.
  for(const entry of samples){assert.ok(entry.wasmCapacityBytes<=baseline.wasmCapacityBytes+1024*1024,"WASM capacity grew after warmup");
    assert.ok(entry.javascriptHeap.JSHeapUsedSize<=baseline.javascriptHeap.JSHeapUsedSize+16*1024*1024,"post-GC JS heap regression");}
  const ordered=latencies.map((x)=>x.readyObservedMs).sort((a,b)=>a-b),percentile=(p)=>ordered[Math.ceil(p*ordered.length)-1];
  const record={methodology:"full-host-lifecycle-v1",gitHead:execFileSync("git",["rev-parse","HEAD"],{cwd:fileURLToPath(root),encoding:"utf8"}).trim(),
    dirtyWorktree:!!execFileSync("git",["status","--porcelain"],{cwd:fileURLToPath(root),encoding:"utf8"}).trim(),
    browser:browser.version(),node:process.version,platform:`${os.platform()} ${os.release()}`,cpu:os.cpus()[0]?.model,
    wasmSha256:sha(await readFile(new URL("target/wasm32-unknown-unknown/release/iimg_web.wasm",root))),fixtures:fixtureRecords,
    iterations,warmupCycles:8,viewport:[390,844],reducedMotion:true,observedReadyMs:{p50:percentile(.5),p95:percentile(.95),max:ordered.at(-1)},latencies,samples,
    notes:["Ready times include browser automation, file transfer and polling; not isolated parse/paint or physical touch latency.","Explicit GC occurs outside timed samples. JS heap, WASM capacity and browser process samples are separate measurements.","WASM pages cannot shrink; unload releases owned buffers/runtime and the canvas backing dimensions are reset to 1x1.","Process samples include browser/renderer overhead and can double-count shared pages; they are not total/peak app memory.","This controlled fixed-workload regression check is not proof that all inputs/devices are leak-free. Physical low-memory and TalkBack checks remain manual."]};
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(record,null,2)+"\n");
  console.log(`${iterations} full-host load/use/reset/unload cycles passed; WASM warmup ${baseline.wasmCapacityBytes} bytes; p50/p95 observed ready ${percentile(.5).toFixed(1)}/${percentile(.95).toFixed(1)} ms. Report: ${output}`);
}finally{await browser?.close();await new Promise((done)=>server.close(done));}
