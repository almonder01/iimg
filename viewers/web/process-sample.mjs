import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute=promisify(execFile);
export async function residentSample(session){
  try{
    const {processInfo}=await session.send("SystemInfo.getProcessInfo");
    const ids=processInfo.map(({id})=>Number(id));
    assert.ok(ids.length&&ids.every((id)=>Number.isSafeInteger(id)&&id>0));
    if(process.platform==="win32"){
      const script=`$rows=@(foreach($processId in @(${ids.join(",")})){try{$item=[Diagnostics.Process]::GetProcessById($processId);[pscustomobject]@{pid=$processId;rssBytes=$item.WorkingSet64;privateBytes=$item.PrivateMemorySize64}}catch{}});ConvertTo-Json -InputObject $rows -Compress`;
      const {stdout}=await execute("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{timeout:15000});
      const rows=JSON.parse(stdout);assert.ok(rows.length);
      return{method:"sum of current browser-process working sets/private bytes after explicit GC",processCount:rows.length,residentBytes:rows.reduce((n,r)=>n+r.rssBytes,0),privateBytes:rows.reduce((n,r)=>n+r.privateBytes,0)};
    }
    const{stdout}=await execute("ps",["-o","rss=","-p",ids.join(",")],{timeout:5000});
    const values=stdout.trim().split(/\s+/).map(Number);assert.ok(values.length&&values.every(Number.isFinite));
    return{method:"sum of current browser-process RSS after explicit GC",processCount:values.length,residentBytes:values.reduce((n,r)=>n+r*1024,0)};
  }catch(error){return{available:false,reason:error.message};}
}
