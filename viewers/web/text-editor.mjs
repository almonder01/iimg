// Text is rasterized at authoring time. Embedded RGB PNG bytes are normative;
// source hints never load fonts, URLs, scripts or markup in a reader.
export function encodeRgbPng(width, height, rgba) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width<1 || width>1024 || height<1 || height>256 || rgba.length!==width*height*4) throw new Error("Invalid text bitmap dimensions.");
  const raw = new Uint8Array(height*(width*3+1));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)raw.set(rgba.subarray((y*width+x)*4,(y*width+x)*4+3),y*(width*3+1)+1+x*3);
  const parts=[],u32=(n)=>Uint8Array.of(n>>>24,n>>>16&255,n>>>8&255,n&255);
  const join=(values)=>{const out=new Uint8Array(values.reduce((n,v)=>n+v.length,0));let at=0;for(const v of values){out.set(v,at);at+=v.length;}return out;};
  const crc=(bytes)=>{let value=0xffffffff;for(const b of bytes){value^=b;for(let k=0;k<8;k++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;};
  const chunk=(name,body)=>{const bytes=join([new TextEncoder().encode(name),body]);return join([u32(body.length),bytes,u32(crc(bytes))]);};
  // Stored DEFLATE blocks avoid browser-dependent compression behavior.
  parts.push(Uint8Array.of(0x78,0x01));
  for(let at=0;at<raw.length;at+=65535){const block=raw.subarray(at,at+65535),n=block.length;parts.push(Uint8Array.of(at+n===raw.length?1:0,n&255,n>>>8,(n^65535)&255,(n^65535)>>>8),block);}
  let a=1,b=0;for(const value of raw){a=(a+value)%65521;b=(b+a)%65521;}parts.push(u32((b*65536+a)>>>0));
  return join([Uint8Array.of(137,80,78,71,13,10,26,10),chunk("IHDR",join([u32(width),u32(height),Uint8Array.of(8,2,0,0,0)])),chunk("IDAT",join(parts)),chunk("IEND",new Uint8Array())]);
}
export function mountTextTools(root, api) {
  const get=(name)=>root.querySelector(`#editor-text-${name}`);
  const fields=["text","font_family","font_size","direction","color","background"];
  const selected=()=>api.model()?.scene.objects.find((shape)=>shape.id===api.selected());
  function refresh(){
    const model=api.model(),shape=selected(),asset=shape?.type==="image"?model.assets.find((entry)=>entry.id===shape.asset):undefined;
    const hint=asset?.text??{text:"مرحبا بالعالم",font_family:"sans-serif",font_size:32,direction:"rtl",color:[245,248,255],background:[26,32,44]};
    get("fields").disabled=!model;get("update").disabled=!asset?.text;
    for(const name of fields)get(name).value=Array.isArray(hint[name])?api.hex(hint[name]):hint[name];
    const box=shape&&api.bounds(shape);
    get("width").value=asset?.text?box.width:Math.min(model?.width??512,512);
    get("height").value=asset?.text?box.height:Math.min(model?.height??96,96);
    const alternative=model?.accessibility;
    root.querySelector("#editor-description").value=alternative?.description??"";
    root.querySelector("#editor-language").value=alternative?.language??"en";
    root.querySelector("#editor-description-fields").disabled=!model;
  }
  function stamp(update){
    const model=api.model();if(!model)return;
    try{
      const hint=Object.fromEntries(fields.map((name)=>[name,get(name).value]));
      hint.font_size=Number(hint.font_size);hint.color=api.rgb(hint.color);hint.background=api.rgb(hint.background);
      const width=Number(get("width").value),height=Number(get("height").value),lines=hint.text.split("\n");
      if(new TextEncoder().encode(hint.text).length>1024||!hint.text.trim()||lines.length>8||/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u.test(hint.text))throw new Error("Use 1–1024 UTF-8 bytes and at most eight lines, without control characters.");
      if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>Math.min(1024,model.width)||height>Math.min(256,model.height)||hint.font_size<8||hint.font_size>128)throw new Error("Text bitmap must fit the canvas (maximum 1024 × 256), with font size 8–128.");
      if(lines.length*Math.ceil(hint.font_size*1.4)+16>height)throw new Error("Increase the text box height or reduce font size.");
      const bitmap=document.createElement("canvas");bitmap.width=width;bitmap.height=height;
      const context=bitmap.getContext("2d",{alpha:false});context.fillStyle=api.hex(hint.background);context.fillRect(0,0,width,height);
      context.font=`${hint.font_size}px ${hint.font_family}`;context.direction=hint.direction;context.textAlign=hint.direction==="rtl"?"right":"left";context.textBaseline="top";context.fillStyle=api.hex(hint.color);
      for(const [i,line]of lines.entries()){
        if(context.measureText(line).width>width-16)throw new Error("Text is wider than the box. Add a line break, enlarge it or reduce font size.");
        context.fillText(line,hint.direction==="rtl"?width-8:8,8+i*Math.ceil(hint.font_size*1.4));
      }
      const png=encodeRgbPng(width,height,context.getImageData(0,0,width,height).data);
      let id,assetId;const shape=selected();
      if(update){if(shape?.type!=="image"||!model.assets.find((entry)=>entry.id===shape.asset)?.text)return;id=shape.id;assetId=shape.asset;}
      else {let n=1;while(model.scene.objects.some((shape)=>shape.id===`text${n}`)||(model.assets??[]).some((asset)=>asset.id===`text${n}`))n++;id=assetId=`text${n}`;}
      // Updating a shared source asset changes its linked images together.
      const pieces=[];for(let at=0;at<png.length;at+=8192)pieces.push(String.fromCharCode(...png.subarray(at,at+8192)));
      const previous=api.selected();api.select(id);
      const accepted=api.edit((next)=>{
        const value={id:assetId,png_base64:btoa(pieces.join("")),text:hint};
        if(update)next.assets[next.assets.findIndex((entry)=>entry.id===assetId)]=value;
        else{(next.assets??=[]).push(value);next.scene.objects.push({type:"image",id,asset:assetId,x:0,y:0});}
      });
      if(!accepted)api.select(previous);
    }catch(error){api.message(`Text not applied: ${error.message}`);}
  }
  get("form").addEventListener("submit",(event)=>{event.preventDefault();stamp(false);});
  get("update").addEventListener("click",()=>stamp(true));
  root.querySelector("#editor-description-form").addEventListener("submit",(event)=>{
    event.preventDefault();api.edit((next)=>{
      const description=root.querySelector("#editor-description").value,language=root.querySelector("#editor-language").value;
      if(!description.trim())delete next.accessibility;else next.accessibility={description,language};
    });
  });
  return{refresh};
}
