use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, MutexGuard,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const EDITOR_METADATA_PATH: &str = ".rpgne/editor.json";
const STAGING_MARKER: &str = ".rpgne-staging.json";
const MAX_PROJECT_FILES: usize = 4_096;
const MAX_PROJECT_ENTRIES: usize = 100_000;
const MAX_SOURCE_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_PROJECT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_BUILD_FILES: usize = 20_000;
const MAX_BUILD_BYTES: usize = 512 * 1024 * 1024;

#[derive(Default)]
pub struct ProjectState {
    sessions: Mutex<HashMap<String, ProjectSession>>,
    next_session: AtomicU64,
    next_operation: AtomicU64,
}

struct ProjectSession {
    root: PathBuf,
    revisions: BTreeMap<String, String>,
    writable_paths: BTreeSet<String>,
    last_output: Option<PathBuf>,
    operation: Arc<Mutex<()>>,
}

struct ProjectSnapshot {
    files: Vec<ProjectFile>,
    revisions: BTreeMap<String, String>,
    writable_paths: BTreeSet<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    path: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedProject {
    session_id: String,
    root_name: String,
    files: Vec<ProjectFile>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRequest {
    session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProjectRequest {
    session_id: String,
    files: Vec<ProjectFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProjectResult {
    saved_files: usize,
    changed_paths: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeCheckResult {
    changed_paths: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildFile {
    path: String,
    content_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteBuildRequest {
    session_id: String,
    output_path: String,
    project_id: String,
    files: Vec<BuildFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteBuildResult {
    output_path: String,
}

struct SessionAccess {
    root: PathBuf,
    revisions: BTreeMap<String, String>,
    writable_paths: BTreeSet<String>,
    operation: Arc<Mutex<()>>,
}

struct SaveStage {
    target: PathBuf,
    temporary: PathBuf,
    backup: PathBuf,
    backed_up: bool,
    installed: bool,
}

struct DecodedBuildFile {
    path: String,
    content: Vec<u8>,
}

fn state_lock(
    state: &ProjectState,
) -> Result<MutexGuard<'_, HashMap<String, ProjectSession>>, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "The native project session store is unavailable.".to_string())
}

fn operation_lock(operation: &Arc<Mutex<()>>) -> Result<MutexGuard<'_, ()>, String> {
    operation
        .lock()
        .map_err(|_| "The project filesystem operation lock is unavailable.".to_string())
}

fn session_access(state: &ProjectState, session_id: &str) -> Result<SessionAccess, String> {
    let sessions = state_lock(state)?;
    let session = sessions
        .get(session_id)
        .ok_or_else(|| "This project session is no longer open.".to_string())?;
    Ok(SessionAccess {
        root: session.root.clone(),
        revisions: session.revisions.clone(),
        writable_paths: session.writable_paths.clone(),
        operation: Arc::clone(&session.operation),
    })
}

fn root_name(root: &Path) -> String {
    root.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Project")
        .to_string()
}

fn opened_project(session_id: String, root: &Path, snapshot: ProjectSnapshot) -> OpenedProject {
    OpenedProject {
        session_id,
        root_name: root_name(root),
        files: snapshot.files,
    }
}

fn validate_relative_path<'a>(path: &'a str, label: &str) -> Result<Vec<&'a str>, String> {
    if path.is_empty() || path.starts_with('/') || path.ends_with('/') || path.contains('\\') {
        return Err(format!(
            "{label} must be a normalized project-relative path."
        ));
    }
    let segments: Vec<&str> = path.split('/').collect();
    if segments.iter().any(|segment| {
        segment.is_empty() || *segment == "." || *segment == ".." || segment.contains(':')
    }) {
        return Err(format!(
            "{label} must not contain traversal, drive, or empty segments."
        ));
    }
    Ok(segments)
}

fn resolved_child(root: &Path, relative_path: &str, label: &str) -> Result<PathBuf, String> {
    let segments = validate_relative_path(relative_path, label)?;
    let mut candidate = root.to_path_buf();
    for segment in segments {
        candidate.push(segment);
    }
    if candidate == root || !candidate.starts_with(root) {
        return Err(format!(
            "{label} must resolve beneath the project directory."
        ));
    }
    Ok(candidate)
}

fn reject_symlink_components(root: &Path, relative_path: &str, label: &str) -> Result<(), String> {
    let segments = validate_relative_path(relative_path, label)?;
    let mut current = root.to_path_buf();
    for segment in segments {
        current.push(segment);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!(
                    "{label} cannot pass through symbolic link {}.",
                    current.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                return Err(format!("Could not inspect {}: {error}", current.display()));
            }
        }
    }
    Ok(())
}

fn content_revision(content: &str) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in content.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}:{}", hash, content.len())
}

fn read_text_file(root: &Path, relative_path: &str) -> Result<String, String> {
    reject_symlink_components(root, relative_path, "Project file")?;
    let path = resolved_child(root, relative_path, "Project file")?;
    let metadata = fs::symlink_metadata(&path)
        .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!("{} must be an ordinary file.", path.display()));
    }
    if metadata.len() > MAX_SOURCE_FILE_BYTES {
        return Err(format!(
            "{} exceeds the {} MiB source-file limit.",
            relative_path,
            MAX_SOURCE_FILE_BYTES / 1024 / 1024
        ));
    }
    let bytes =
        fs::read(&path).map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    String::from_utf8(bytes).map_err(|_| format!("{relative_path} is not valid UTF-8 text."))
}

fn should_skip_story_directory(name: &str) -> bool {
    matches!(name, ".git" | ".rpgne" | "node_modules" | "target")
        || name.starts_with(".rpgne-")
        || name.ends_with(".rpgne-staging")
        || name.ends_with(".rpgne-previous")
}

fn collect_story_paths(
    directory: &Path,
    relative_directory: &str,
    paths: &mut Vec<String>,
    visited_entries: &mut usize,
) -> Result<(), String> {
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("Could not read {}: {error}", directory.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Could not read a project entry: {error}"))?;
        *visited_entries += 1;
        if *visited_entries > MAX_PROJECT_ENTRIES {
            return Err(format!(
                "The project contains more than {MAX_PROJECT_ENTRIES} filesystem entries."
            ));
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Could not inspect {}: {error}", entry.path().display()))?;
        if file_type.is_symlink() {
            continue;
        }
        let relative_path = if relative_directory.is_empty() {
            name.clone()
        } else {
            format!("{relative_directory}/{name}")
        };
        if file_type.is_dir() {
            if !should_skip_story_directory(&name) {
                collect_story_paths(&entry.path(), &relative_path, paths, visited_entries)?;
            }
        } else if file_type.is_file() && relative_path.ends_with(".story") {
            paths.push(relative_path);
            if paths.len() > MAX_PROJECT_FILES {
                return Err(format!(
                    "The project contains more than {MAX_PROJECT_FILES} story files."
                ));
            }
        }
    }
    Ok(())
}

fn read_project(root: &Path) -> Result<ProjectSnapshot, String> {
    let root_metadata = fs::metadata(root)
        .map_err(|error| format!("Could not inspect {}: {error}", root.display()))?;
    if !root_metadata.is_dir() {
        return Err(format!("{} is not a project directory.", root.display()));
    }

    let mut sources = BTreeMap::new();
    sources.insert(
        "project.toml".to_string(),
        read_text_file(root, "project.toml")?,
    );

    let mut story_paths = Vec::new();
    let mut visited_entries = 0;
    collect_story_paths(root, "", &mut story_paths, &mut visited_entries)?;
    story_paths.sort();
    story_paths.dedup();
    for path in story_paths {
        sources.insert(path.clone(), read_text_file(root, &path)?);
    }

    let metadata_path = root.join(".rpgne").join("editor.json");
    if metadata_path.exists() {
        sources.insert(
            EDITOR_METADATA_PATH.to_string(),
            read_text_file(root, EDITOR_METADATA_PATH)?,
        );
    }

    let total_bytes = sources.values().try_fold(0_u64, |total, source| {
        total.checked_add(source.len() as u64)
    });
    if total_bytes.is_none() || total_bytes.unwrap_or(u64::MAX) > MAX_PROJECT_BYTES {
        return Err(format!(
            "The project exceeds the {} MiB editable-source limit.",
            MAX_PROJECT_BYTES / 1024 / 1024
        ));
    }

    let revisions = sources
        .iter()
        .map(|(path, content)| (path.clone(), content_revision(content)))
        .collect();
    let writable_paths = sources.keys().cloned().collect();
    let files = sources
        .into_iter()
        .map(|(path, content)| ProjectFile { path, content })
        .collect();
    Ok(ProjectSnapshot {
        files,
        revisions,
        writable_paths,
    })
}

fn changed_paths(
    baseline: &BTreeMap<String, String>,
    current: &BTreeMap<String, String>,
) -> Vec<String> {
    baseline
        .keys()
        .chain(current.keys())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .filter(|path| baseline.get(*path) != current.get(*path))
        .cloned()
        .collect()
}

fn sibling_transaction_path(
    target: &Path,
    phase: &str,
    operation_id: u64,
) -> Result<PathBuf, String> {
    let filename = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("{} has no portable filename.", target.display()))?;
    Ok(target.with_file_name(format!(".{filename}.rpgne-{phase}-{operation_id}")))
}

fn write_synced_new(path: &Path, content: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("Could not create {}: {error}", path.display()))?;
    file.write_all(content)
        .map_err(|error| format!("Could not write {}: {error}", path.display()))?;
    file.sync_all()
        .map_err(|error| format!("Could not flush {}: {error}", path.display()))
}

fn rename_with_retry(source: &Path, destination: &Path) -> Result<(), String> {
    let delays = [25_u64, 50, 100, 200, 400, 800, 1_600];
    for (attempt, delay) in delays.iter().chain(std::iter::once(&0)).enumerate() {
        match fs::rename(source, destination) {
            Ok(()) => return Ok(()),
            Err(error) => {
                let transient = matches!(
                    error.kind(),
                    std::io::ErrorKind::PermissionDenied
                        | std::io::ErrorKind::WouldBlock
                        | std::io::ErrorKind::AlreadyExists
                ) || matches!(error.raw_os_error(), Some(5 | 32 | 33 | 145 | 183));
                if attempt >= delays.len() || !transient {
                    return Err(format!(
                        "Could not rename {} to {}: {error}",
                        source.display(),
                        destination.display()
                    ));
                }
                thread::sleep(Duration::from_millis(*delay));
            }
        }
    }
    unreachable!()
}

fn rollback_save(stages: &mut [SaveStage]) {
    for stage in stages.iter_mut().rev() {
        if stage.installed {
            let _ = fs::remove_file(&stage.target);
            stage.installed = false;
        }
        if stage.backed_up && stage.backup.exists() {
            let _ = rename_with_retry(&stage.backup, &stage.target);
            stage.backed_up = false;
        }
        if stage.temporary.exists() {
            let _ = fs::remove_file(&stage.temporary);
        }
    }
}

fn atomically_replace_project_files(
    root: &Path,
    files: &[ProjectFile],
    operation_id: u64,
) -> Result<(), String> {
    let mut stages = Vec::with_capacity(files.len());
    for file in files {
        let staged = (|| {
            reject_symlink_components(root, &file.path, "Project file")?;
            let target = resolved_child(root, &file.path, "Project file")?;
            let parent = target
                .parent()
                .ok_or_else(|| format!("{} has no parent directory.", target.display()))?;
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
            let temporary = sibling_transaction_path(&target, "save", operation_id)?;
            let backup = sibling_transaction_path(&target, "previous", operation_id)?;
            if let Err(error) = write_synced_new(&temporary, file.content.as_bytes()) {
                let _ = fs::remove_file(&temporary);
                return Err(error);
            }
            Ok(SaveStage {
                target,
                temporary,
                backup,
                backed_up: false,
                installed: false,
            })
        })();
        match staged {
            Ok(stage) => stages.push(stage),
            Err(error) => {
                rollback_save(&mut stages);
                return Err(error);
            }
        }
    }

    for index in 0..stages.len() {
        if stages[index].target.exists() {
            if let Err(error) = rename_with_retry(&stages[index].target, &stages[index].backup) {
                rollback_save(&mut stages);
                return Err(error);
            }
            stages[index].backed_up = true;
        }
    }
    for index in 0..stages.len() {
        if let Err(error) = rename_with_retry(&stages[index].temporary, &stages[index].target) {
            rollback_save(&mut stages);
            return Err(error);
        }
        stages[index].installed = true;
    }
    for stage in &stages {
        if stage.backed_up {
            let _ = fs::remove_file(&stage.backup);
        }
    }
    Ok(())
}

fn validate_save_files(
    files: &[ProjectFile],
    writable_paths: &BTreeSet<String>,
) -> Result<(), String> {
    if files.is_empty() || files.len() > MAX_PROJECT_FILES + 2 {
        return Err("The save request contains an invalid number of project files.".to_string());
    }
    let mut paths = BTreeSet::new();
    let mut total_bytes = 0_u64;
    for file in files {
        validate_relative_path(&file.path, "Project file")?;
        if !writable_paths.contains(&file.path) && file.path != EDITOR_METADATA_PATH {
            return Err(format!(
                "{} was not opened as an editable project file.",
                file.path
            ));
        }
        if !paths.insert(file.path.clone()) {
            return Err(format!(
                "The save request contains duplicate path {}.",
                file.path
            ));
        }
        if file.content.len() as u64 > MAX_SOURCE_FILE_BYTES {
            return Err(format!("{} exceeds the source-file size limit.", file.path));
        }
        total_bytes = total_bytes
            .checked_add(file.content.len() as u64)
            .ok_or_else(|| "The save request is too large.".to_string())?;
    }
    if total_bytes > MAX_PROJECT_BYTES {
        return Err("The save request exceeds the editable-project size limit.".to_string());
    }
    if !paths.contains("project.toml") {
        return Err("The save request is missing project.toml.".to_string());
    }
    for path in writable_paths {
        if !paths.contains(path) {
            return Err(format!("The save request is missing opened file {path}."));
        }
    }
    Ok(())
}

fn path_exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("Could not inspect {}: {error}", path.display())),
    }
}

fn manifest_project_id(source: &str) -> Option<String> {
    let value: Value = serde_json::from_str(source).ok()?;
    value
        .get("project")?
        .get("id")?
        .as_str()
        .map(str::to_string)
}

fn verify_output_ownership(candidate: &Path, project_id: &str) -> Result<(), String> {
    if !path_exists(candidate)? {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(candidate)
        .map_err(|error| format!("Could not inspect {}: {error}", candidate.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!(
            "Build output {} must be an ordinary directory.",
            candidate.display()
        ));
    }
    let mut entries = fs::read_dir(candidate)
        .map_err(|error| format!("Could not read {}: {error}", candidate.display()))?;
    if entries.next().is_none() {
        return Ok(());
    }
    let manifest_path = candidate.join("artifact-manifest.json");
    if let Ok(source) = fs::read_to_string(&manifest_path) {
        if manifest_project_id(&source).as_deref() == Some(project_id) {
            return Ok(());
        }
    }
    Err(format!(
        "Refusing to replace nonempty directory {} because it is not build output owned by {project_id}.",
        candidate.display()
    ))
}

fn verify_staging_ownership(candidate: &Path, project_id: &str) -> Result<(), String> {
    if !path_exists(candidate)? {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(candidate)
        .map_err(|error| format!("Could not inspect {}: {error}", candidate.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("The stale build staging path is not an ordinary directory.".to_string());
    }
    let marker = fs::read_to_string(candidate.join(STAGING_MARKER)).ok();
    let owned = marker
        .as_deref()
        .and_then(|source| serde_json::from_str::<Value>(source).ok())
        .and_then(|value| {
            value
                .get("projectId")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .is_some_and(|owner| owner == project_id);
    if owned {
        Ok(())
    } else {
        Err(format!(
            "Refusing to remove unowned staging directory {}.",
            candidate.display()
        ))
    }
}

fn remove_owned_directory(candidate: &Path, root: &Path) -> Result<(), String> {
    if candidate == root || !candidate.starts_with(root) {
        return Err("Refusing to remove a path outside the project directory.".to_string());
    }
    if !path_exists(candidate)? {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(candidate)
        .map_err(|error| format!("Could not inspect {}: {error}", candidate.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!(
            "Refusing to remove {} as build output.",
            candidate.display()
        ));
    }
    fs::remove_dir_all(candidate)
        .map_err(|error| format!("Could not remove {}: {error}", candidate.display()))
}

fn decode_build_files(
    files: Vec<BuildFile>,
    project_id: &str,
) -> Result<Vec<DecodedBuildFile>, String> {
    if files.is_empty() || files.len() > MAX_BUILD_FILES {
        return Err("The build request contains an invalid number of files.".to_string());
    }
    let mut decoded = Vec::with_capacity(files.len());
    let mut paths = BTreeSet::new();
    let mut total_bytes = 0_usize;
    for file in files {
        validate_relative_path(&file.path, "Build artifact")?;
        if file.path == STAGING_MARKER || !paths.insert(file.path.clone()) {
            return Err(format!(
                "The build request contains invalid duplicate path {}.",
                file.path
            ));
        }
        let content = BASE64
            .decode(file.content_base64.as_bytes())
            .map_err(|_| format!("Build artifact {} is not valid base64.", file.path))?;
        total_bytes = total_bytes
            .checked_add(content.len())
            .ok_or_else(|| "The build request is too large.".to_string())?;
        if total_bytes > MAX_BUILD_BYTES {
            return Err("The build request exceeds the native write limit.".to_string());
        }
        decoded.push(DecodedBuildFile {
            path: file.path,
            content,
        });
    }
    let manifest = decoded
        .iter()
        .find(|file| file.path == "artifact-manifest.json")
        .ok_or_else(|| "The build request is missing artifact-manifest.json.".to_string())?;
    let manifest_source = std::str::from_utf8(&manifest.content)
        .map_err(|_| "The artifact manifest is not UTF-8 JSON.".to_string())?;
    if manifest_project_id(manifest_source).as_deref() != Some(project_id) {
        return Err("The artifact manifest does not belong to the open project.".to_string());
    }
    Ok(decoded)
}

fn write_build_files(
    staging: &Path,
    project_id: &str,
    files: &[DecodedBuildFile],
) -> Result<(), String> {
    fs::create_dir_all(staging)
        .map_err(|error| format!("Could not create {}: {error}", staging.display()))?;
    let marker = serde_json::to_vec(&serde_json::json!({ "projectId": project_id }))
        .map_err(|error| format!("Could not encode the build marker: {error}"))?;
    fs::write(staging.join(STAGING_MARKER), marker)
        .map_err(|error| format!("Could not write the build marker: {error}"))?;
    for file in files {
        let destination = resolved_child(staging, &file.path, "Build artifact")?;
        let parent = destination
            .parent()
            .ok_or_else(|| format!("{} has no parent directory.", destination.display()))?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
        fs::write(&destination, &file.content)
            .map_err(|error| format!("Could not write {}: {error}", destination.display()))?;
    }
    Ok(())
}

fn promote_build(
    root: &Path,
    output: &Path,
    staging: &Path,
    backup: &Path,
    project_id: &str,
) -> Result<(), String> {
    let mut output_exists = path_exists(output)?;
    if path_exists(backup)? {
        verify_output_ownership(backup, project_id)?;
        if output_exists {
            remove_owned_directory(backup, root)?;
        } else {
            rename_with_retry(backup, output)?;
            output_exists = true;
        }
    }
    if output_exists {
        rename_with_retry(output, backup)?;
    }
    if let Err(error) = rename_with_retry(staging, output) {
        if output_exists && path_exists(backup).unwrap_or(false) {
            let _ = rename_with_retry(backup, output);
        }
        return Err(format!(
            "Could not promote the staged build output. {error}"
        ));
    }
    let _ = fs::remove_file(output.join(STAGING_MARKER));
    if output_exists {
        remove_owned_directory(backup, root)?;
    }
    Ok(())
}

fn write_build_directory(
    root: &Path,
    output_path: &str,
    project_id: &str,
    files: &[DecodedBuildFile],
) -> Result<PathBuf, String> {
    let segments = validate_relative_path(output_path, "Build output")?;
    let first = segments[0];
    if matches!(first, ".git" | ".rpgne" | "node_modules") || first.starts_with(".rpgne-") {
        return Err(format!(
            "Build output cannot use reserved directory {first}."
        ));
    }
    reject_symlink_components(root, output_path, "Build output")?;
    let output = resolved_child(root, output_path, "Build output")?;
    let parent = output
        .parent()
        .ok_or_else(|| format!("{} has no parent directory.", output.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;

    let output_name = output
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Build output has no portable directory name.".to_string())?;
    let staging = output.with_file_name(format!("{output_name}.rpgne-staging"));
    let backup = output.with_file_name(format!("{output_name}.rpgne-previous"));
    let lock_path = output.with_file_name(format!("{output_name}.rpgne-lock"));
    let mut lock = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&lock_path)
        .map_err(|error| {
            format!(
                "Another build may own {}. If no build is running, remove the stale lock file: {error}",
                lock_path.display()
            )
        })?;
    let _ = writeln!(
        lock,
        "{{\"projectId\":{}}}",
        serde_json::to_string(project_id).unwrap_or_default()
    );

    let result = (|| {
        verify_output_ownership(&output, project_id)?;
        verify_staging_ownership(&staging, project_id)?;
        remove_owned_directory(&staging, root)?;
        write_build_files(&staging, project_id, files)?;
        promote_build(root, &output, &staging, &backup, project_id)
    })();
    drop(lock);
    let lock_cleanup = fs::remove_file(&lock_path)
        .map_err(|error| format!("Could not remove {}: {error}", lock_path.display()));
    result?;
    lock_cleanup?;
    Ok(output)
}

#[tauri::command]
pub async fn open_project(
    app: AppHandle,
    state: State<'_, ProjectState>,
) -> Result<Option<OpenedProject>, String> {
    let Some(selection) = app
        .dialog()
        .file()
        .set_title("Open RPG Narrative Engine project")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let selected_path = selection
        .into_path()
        .map_err(|_| "The selected folder is not a local filesystem path.".to_string())?;
    let root = fs::canonicalize(&selected_path)
        .map_err(|error| format!("Could not open {}: {error}", selected_path.display()))?;
    let snapshot = read_project(&root)?;
    let session_id = format!(
        "project-{}",
        state.next_session.fetch_add(1, Ordering::Relaxed) + 1
    );
    state_lock(&state)?.insert(
        session_id.clone(),
        ProjectSession {
            root: root.clone(),
            revisions: snapshot.revisions.clone(),
            writable_paths: snapshot.writable_paths.clone(),
            last_output: None,
            operation: Arc::new(Mutex::new(())),
        },
    );
    Ok(Some(opened_project(session_id, &root, snapshot)))
}

#[tauri::command]
pub fn reload_project(
    state: State<'_, ProjectState>,
    request: SessionRequest,
) -> Result<OpenedProject, String> {
    let access = session_access(&state, &request.session_id)?;
    let _operation = operation_lock(&access.operation)?;
    let snapshot = read_project(&access.root)?;
    {
        let mut sessions = state_lock(&state)?;
        let session = sessions
            .get_mut(&request.session_id)
            .ok_or_else(|| "This project session is no longer open.".to_string())?;
        session.revisions = snapshot.revisions.clone();
        session.writable_paths = snapshot.writable_paths.clone();
    }
    Ok(opened_project(request.session_id, &access.root, snapshot))
}

#[tauri::command]
pub fn check_project_changes(
    state: State<'_, ProjectState>,
    request: SessionRequest,
) -> Result<ChangeCheckResult, String> {
    let access = session_access(&state, &request.session_id)?;
    let _operation = operation_lock(&access.operation)?;
    let snapshot = read_project(&access.root)?;
    Ok(ChangeCheckResult {
        changed_paths: changed_paths(&access.revisions, &snapshot.revisions),
    })
}

#[tauri::command]
pub fn save_project(
    state: State<'_, ProjectState>,
    request: SaveProjectRequest,
) -> Result<SaveProjectResult, String> {
    let access = session_access(&state, &request.session_id)?;
    let _operation = operation_lock(&access.operation)?;
    validate_save_files(&request.files, &access.writable_paths)?;
    let current = read_project(&access.root)?;
    let external_changes = changed_paths(&access.revisions, &current.revisions);
    if !external_changes.is_empty() {
        return Ok(SaveProjectResult {
            saved_files: 0,
            changed_paths: external_changes,
        });
    }

    let operation_id = state.next_operation.fetch_add(1, Ordering::Relaxed) + 1;
    atomically_replace_project_files(&access.root, &request.files, operation_id)?;
    let saved = read_project(&access.root)?;
    {
        let mut sessions = state_lock(&state)?;
        let session = sessions
            .get_mut(&request.session_id)
            .ok_or_else(|| "This project session is no longer open.".to_string())?;
        session.revisions = saved.revisions;
        session.writable_paths = saved.writable_paths;
    }
    Ok(SaveProjectResult {
        saved_files: request.files.len(),
        changed_paths: Vec::new(),
    })
}

#[tauri::command]
pub fn write_project_build(
    state: State<'_, ProjectState>,
    request: WriteBuildRequest,
) -> Result<WriteBuildResult, String> {
    let access = session_access(&state, &request.session_id)?;
    let _operation = operation_lock(&access.operation)?;
    let files = decode_build_files(request.files, &request.project_id)?;
    let output = write_build_directory(
        &access.root,
        &request.output_path,
        &request.project_id,
        &files,
    )?;
    {
        let mut sessions = state_lock(&state)?;
        let session = sessions
            .get_mut(&request.session_id)
            .ok_or_else(|| "This project session is no longer open.".to_string())?;
        session.last_output = Some(output);
    }
    Ok(WriteBuildResult {
        output_path: request.output_path,
    })
}

#[tauri::command]
pub fn open_project_output(
    app: AppHandle,
    state: State<'_, ProjectState>,
    request: SessionRequest,
) -> Result<(), String> {
    let output = {
        let sessions = state_lock(&state)?;
        sessions
            .get(&request.session_id)
            .and_then(|session| session.last_output.clone())
            .ok_or_else(|| "This project has no completed native build output yet.".to_string())?
    };
    let metadata = fs::symlink_metadata(&output)
        .map_err(|error| format!("Could not inspect {}: {error}", output.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("The last build output is no longer an ordinary directory.".to_string());
    }
    app.opener()
        .open_path(output.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| format!("Could not open the build folder: {error}"))
}
