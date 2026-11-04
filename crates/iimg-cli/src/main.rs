use std::{env,fs,process};
fn main(){if let Err(e)=run(){eprintln!("error: {e}");process::exit(1)}}
fn run()->Result<(),Box<dyn std::error::Error>>{
 let a:Vec<String>=env::args().collect();if a.len()!=3 {return Err("usage: iimg-cli <sample|validate|inspect> <file>".into())}
 match a[1].as_str(){
  "sample"=>{fs::write(&a[2],iimg_core::encode(&iimg_core::sample())?)?;println!("created {}",a[2]);},
  "validate"=>{let b=fs::read(&a[2])?;iimg_core::decode(&b)?;println!("valid experimental IIMG v0.1 container");},
  "inspect"=>{let b=fs::read(&a[2])?;let d=iimg_core::decode(&b)?;println!("IIMG {}.{}",d.major,d.minor);for c in d.chunks {println!("{} {} bytes",String::from_utf8_lossy(&c.kind),c.data.len())}},
  _=>return Err("unknown command".into())
 }Ok(())}
