use iimg_core::interaction::{Runtime, MAX_TRACE_BYTES};
use std::error::Error;
use std::io::{Read, Write};
use std::path::Path;
use std::{env, fs, process};

fn read_bounded(path: &Path, limit: usize) -> Result<Vec<u8>, Box<dyn Error>> {
    let file = fs::File::open(path)?;
    if file.metadata()?.len() > limit as u64 {
        return Err(iimg_core::Error::Oversize.into());
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(iimg_core::Error::Oversize.into());
    }
    Ok(bytes)
}

fn read_document(path: &Path) -> Result<iimg_core::Document, Box<dyn Error>> {
    Ok(iimg_core::decode(&read_bounded(
        path,
        iimg_core::MAX_FILE,
    )?)?)
}

fn write_frame(runtime: &Runtime, path: &Path) -> Result<(), Box<dyn Error>> {
    let pixels = runtime.render_rgb()?;
    let (width, height) = runtime.dimensions();
    let mut file = fs::File::create_new(path)?;
    write!(file, "P6\n{width} {height}\n255\n")?;
    file.write_all(&pixels)?;
    Ok(())
}
fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e}");
        process::exit(1)
    }
}
fn run() -> Result<(), Box<dyn Error>> {
    let a: Vec<_> = env::args_os().collect();
    if let [_, command, input, trace, output] = a.as_slice() {
        if command == "replay" {
            let mut runtime = Runtime::new(&read_document(Path::new(input))?)?;
            runtime.replay(&read_bounded(Path::new(trace), MAX_TRACE_BYTES)?)?;
            return write_frame(&runtime, Path::new(output));
        }
    }
    if let [_, command, input, output] = a.as_slice() {
        if command == "upgrade-v1" {
            let input = read_bounded(Path::new(input), iimg_core::MAX_FILE)?;
            let document = iimg_core::author::upgrade_v1(&input)?;
            fs::File::create_new(output)?.write_all(&document)?;
            return Ok(());
        }
        if command == "compile" || command == "compile-v1" {
            let source = read_bounded(Path::new(input), iimg_core::author::MAX_SOURCE_BYTES)?;
            let document = if command == "compile-v1" {
                iimg_core::author::compile_v1(&source)?
            } else {
                iimg_core::author::compile(&source)?
            };
            fs::File::create_new(output)?.write_all(&document)?;
            return Ok(());
        }
        if command == "extract-preview" {
            let preview = iimg_core::visual::extract_static_preview(&read_bounded(
                Path::new(input),
                iimg_core::MAX_FILE,
            )?)?;
            fs::File::create_new(output)?.write_all(&preview)?;
            return Ok(());
        }
        if command == "render" {
            let document = read_document(Path::new(input))?;
            return write_frame(&Runtime::new(&document)?, Path::new(output));
        }
    }
    if a.len() != 3 {
        return Err(
            "usage: iimg-cli <sample|validate|inspect> <file> | <render|extract-preview|upgrade-v1> <file> <new-output> | replay <file> <trace.json> <new.ppm> | <compile|compile-v1> <source.json> <new.iimg>".into(),
        );
    }
    let path = Path::new(&a[2]);
    match a[1].to_str() {
        Some("sample") => {
            fs::write(path, iimg_core::encode(&iimg_core::sample())?)?;
            println!("created {}", path.display());
        }
        Some("validate") => {
            let document = read_document(path)?;
            if (document.major, document.minor) != (0, 1) {
                let runtime = Runtime::new(&document)?;
                iimg_core::visual::decode_preview(&document, runtime.dimensions())?;
                println!(
                    "valid IIMG v{}.{} draft envelope, scene and PNG preview",
                    document.major, document.minor
                );
            } else {
                println!("valid experimental IIMG v0.1 container");
            }
        }
        Some("inspect") => {
            let d = read_document(path)?;
            println!("IIMG {}.{}", d.major, d.minor);
            for c in d.chunks {
                println!(
                    "{} {} bytes",
                    String::from_utf8_lossy(&c.kind),
                    c.data.len()
                )
            }
        }
        _ => return Err("unknown command".into()),
    }
    Ok(())
}
