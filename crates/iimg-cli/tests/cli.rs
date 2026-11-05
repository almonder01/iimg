use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn cli(command: &str, file: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_iimg-cli"))
        .arg(command)
        .arg(file)
        .output()
        .unwrap()
}

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("iimg-cli-{}-{unique}", std::process::id()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn sample_can_be_validated_and_inspected_at_a_unicode_path() {
    let dir = TestDirectory::new();
    let file = dir.0.join("مصباح.iimg");
    assert!(cli("sample", &file).status.success());
    assert!(cli("validate", &file).status.success());
    let inspected = cli("inspect", &file);
    assert!(inspected.status.success());
    let details = String::from_utf8(inspected.stdout).unwrap();
    assert!(details.starts_with("IIMG 0.1\n"));
    assert!(details.contains("IEND 0 bytes"));
}

#[test]
fn validate_and_inspect_reject_oversized_files() {
    let dir = TestDirectory::new();
    let file = dir.0.join("oversized.iimg");
    fs::File::create(&file)
        .unwrap()
        .set_len(iimg_core::MAX_FILE as u64 + 1)
        .unwrap();
    for command in ["validate", "inspect"] {
        let output = cli(command, &file);
        assert_eq!(output.status.code(), Some(1));
        assert!(String::from_utf8(output.stderr)
            .unwrap()
            .contains("Oversize"));
    }
}

#[test]
fn extract_preview_writes_original_bytes_and_preserves_existing_output() {
    let dir = TestDirectory::new();
    let fixture = include_bytes!("../../../tests/fixtures/v0.2/lamp.iimg");
    let input = dir.0.join("lamp.iimg");
    let output = dir.0.join("lamp.png");
    fs::write(&input, fixture).unwrap();
    let expected = iimg_core::decode(fixture).unwrap();
    let png = iimg_core::visual::decode_preview(&expected, (32, 32))
        .unwrap()
        .png;
    let extract = || {
        Command::new(env!("CARGO_BIN_EXE_iimg-cli"))
            .arg("extract-preview")
            .arg(&input)
            .arg(&output)
            .output()
            .unwrap()
    };
    assert!(extract().status.success());
    assert_eq!(fs::read(&output).unwrap(), png);
    fs::write(&output, b"existing").unwrap();
    assert!(!extract().status.success());
    assert_eq!(fs::read(&output).unwrap(), b"existing");
}
