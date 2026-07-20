use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
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
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const EDITOR_METADATA_PATH: &str = ".rpgne/editor.json";
const PROJECT_FILES_CHANGED_EVENT: &str = "rpgne-project-files-changed";
const SAVE_JOURNAL_PATH: &str = ".rpgne/save-transaction.json";
const SAVE_JOURNAL_PREPARE_PATH: &str = ".rpgne/save-transaction.preparing";
const SAVE_COMMIT_PATH: &str = ".rpgne/save-commit";
const SAVE_COMMIT_PREPARE_PATH: &str = ".rpgne/save-commit.preparing";
const SAVE_JOURNAL_SCHEMA: u32 = 1;
const MAX_SAVE_JOURNAL_BYTES: u64 = 8 * 1024 * 1024;
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
    _watcher: RecommendedWatcher,
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
    recovery_notice: Option<String>,
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
    recovery_notice: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeCheckResult {
    changed_paths: Vec<String>,
    recovery_notice: Option<String>,
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
    relative_path: String,
    target: PathBuf,
    temporary: PathBuf,
    backup: PathBuf,
    had_original: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveJournal {
    schema: u32,
    operation_id: u64,
    files: Vec<SaveJournalFile>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveJournalFile {
    path: String,
    had_original: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectFilesChanged {
    session_id: String,
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

fn operation_for_root(state: &ProjectState, root: &Path) -> Result<Arc<Mutex<()>>, String> {
    let sessions = state_lock(state)?;
    Ok(sessions
        .values()
        .find(|session| session.root == root)
        .map(|session| Arc::clone(&session.operation))
        .unwrap_or_else(|| Arc::new(Mutex::new(()))))
}

fn root_name(root: &Path) -> String {
    root.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Project")
        .to_string()
}

fn watch_path_is_relevant(root: &Path, path: &Path, kind: &EventKind) -> bool {
    if matches!(kind, EventKind::Access(_)) {
        return false;
    }
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    if relative.as_os_str().is_empty() {
        return true;
    }
    let normalized = relative.to_string_lossy().replace('\\', "/");
    if normalized == "project.toml" || normalized == EDITOR_METADATA_PATH {
        return true;
    }
    let component_names = relative
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .collect::<Vec<_>>();
    let Some(first) = component_names.first() else {
        return false;
    };
    if *first == ".rpgne" || should_skip_story_directory(first) {
        return false;
    }
    if component_names
        .iter()
        .any(|name| name.contains(".rpgne-save-") || name.contains(".rpgne-previous-"))
    {
        return false;
    }
    normalized.ends_with(".story") || path.is_dir() || !path.exists()
}

fn create_project_watcher(
    app: &AppHandle,
    root: &Path,
    session_id: &str,
) -> Result<RecommendedWatcher, String> {
    let watched_root = root.to_path_buf();
    let event_app = app.clone();
    let payload = ProjectFilesChanged {
        session_id: session_id.to_string(),
    };
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        let relevant = match result {
            Ok(event) => event
                .paths
                .iter()
                .any(|path| watch_path_is_relevant(&watched_root, path, &event.kind)),
            Err(_) => true,
        };
        if relevant {
            let _ = event_app.emit(PROJECT_FILES_CHANGED_EVENT, payload.clone());
        }
    })
    .map_err(|error| format!("Could not create the project filesystem watcher: {error}"))?;
    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|error| format!("Could not watch {}: {error}", root.display()))?;
    Ok(watcher)
}

fn opened_project(
    session_id: String,
    root: &Path,
    snapshot: ProjectSnapshot,
    recovery_notice: Option<String>,
) -> OpenedProject {
    OpenedProject {
        session_id,
        root_name: root_name(root),
        files: snapshot.files,
        recovery_notice,
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

fn remove_file_with_retry(path: &Path) -> Result<(), String> {
    let delays = [25_u64, 50, 100, 200, 400, 800, 1_600];
    for (attempt, delay) in delays.iter().chain(std::iter::once(&0)).enumerate() {
        match fs::remove_file(path) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                let transient = matches!(
                    error.kind(),
                    std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::WouldBlock
                ) || matches!(error.raw_os_error(), Some(5 | 32 | 33));
                if attempt >= delays.len() || !transient {
                    return Err(format!("Could not remove {}: {error}", path.display()));
                }
                thread::sleep(Duration::from_millis(*delay));
            }
        }
    }
    unreachable!()
}

fn ordinary_file_exists(path: &Path, label: &str) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => Err(format!(
            "{label} {} must be an ordinary file.",
            path.display()
        )),
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("Could not inspect {}: {error}", path.display())),
    }
}

fn ensure_transaction_directory(root: &Path) -> Result<PathBuf, String> {
    reject_symlink_components(root, ".rpgne", "Transaction directory")?;
    let directory = root.join(".rpgne");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create {}: {error}", directory.display()))?;
    let metadata = fs::symlink_metadata(&directory)
        .map_err(|error| format!("Could not inspect {}: {error}", directory.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!(
            "Transaction directory {} must be an ordinary directory.",
            directory.display()
        ));
    }
    Ok(directory)
}

#[cfg(not(windows))]
fn sync_directory(path: &Path) -> Result<(), String> {
    fs::File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("Could not flush directory {}: {error}", path.display()))
}

#[cfg(windows)]
fn sync_directory(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn sync_stage_parents(stages: &[SaveStage]) -> Result<(), String> {
    let parents = stages
        .iter()
        .filter_map(|stage| stage.target.parent().map(Path::to_path_buf))
        .collect::<BTreeSet<_>>();
    for parent in parents {
        sync_directory(&parent)?;
    }
    Ok(())
}

fn transaction_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    reject_symlink_components(root, relative_path, "Save transaction file")?;
    resolved_child(root, relative_path, "Save transaction file")
}

fn remove_transaction_file(root: &Path, relative_path: &str) -> Result<(), String> {
    let path = transaction_path(root, relative_path)?;
    if ordinary_file_exists(&path, "Save transaction file")? {
        remove_file_with_retry(&path)?;
    }
    Ok(())
}

fn prepare_save_stages(
    root: &Path,
    files: &[ProjectFile],
    operation_id: u64,
) -> Result<Vec<SaveStage>, String> {
    ensure_transaction_directory(root)?;
    let mut stages = Vec::with_capacity(files.len());
    for file in files {
        reject_symlink_components(root, &file.path, "Project file")?;
        let target = resolved_child(root, &file.path, "Project file")?;
        let parent = target
            .parent()
            .ok_or_else(|| format!("{} has no parent directory.", target.display()))?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
        reject_symlink_components(root, &file.path, "Project file")?;
        let had_original = ordinary_file_exists(&target, "Project file")?;
        let temporary = sibling_transaction_path(&target, "save", operation_id)?;
        let backup = sibling_transaction_path(&target, "previous", operation_id)?;
        if path_exists(&temporary)? || path_exists(&backup)? {
            return Err(format!(
                "Save transaction files already exist beside {}.",
                target.display()
            ));
        }
        stages.push(SaveStage {
            relative_path: file.path.clone(),
            target,
            temporary,
            backup,
            had_original,
        });
    }
    Ok(stages)
}

fn journal_for_stages(operation_id: u64, stages: &[SaveStage]) -> SaveJournal {
    SaveJournal {
        schema: SAVE_JOURNAL_SCHEMA,
        operation_id,
        files: stages
            .iter()
            .map(|stage| SaveJournalFile {
                path: stage.relative_path.clone(),
                had_original: stage.had_original,
            })
            .collect(),
    }
}

fn write_transaction_record(
    root: &Path,
    preparing_path: &str,
    final_path: &str,
    content: &[u8],
) -> Result<(), String> {
    let directory = ensure_transaction_directory(root)?;
    let preparing = transaction_path(root, preparing_path)?;
    let final_record = transaction_path(root, final_path)?;
    if path_exists(&preparing)? || path_exists(&final_record)? {
        return Err(format!(
            "A save transaction record already exists in {}.",
            directory.display()
        ));
    }
    write_synced_new(&preparing, content)?;
    rename_with_retry(&preparing, &final_record)?;
    sync_directory(&directory)
}

fn write_save_journal(root: &Path, journal: &SaveJournal) -> Result<(), String> {
    let encoded = serde_json::to_vec(journal)
        .map_err(|error| format!("Could not encode the save transaction journal: {error}"))?;
    if encoded.len() as u64 > MAX_SAVE_JOURNAL_BYTES {
        return Err("The save transaction journal exceeds its safety limit.".to_string());
    }
    write_transaction_record(root, SAVE_JOURNAL_PREPARE_PATH, SAVE_JOURNAL_PATH, &encoded)
}

fn write_commit_marker(root: &Path, operation_id: u64) -> Result<(), String> {
    write_transaction_record(
        root,
        SAVE_COMMIT_PREPARE_PATH,
        SAVE_COMMIT_PATH,
        operation_id.to_string().as_bytes(),
    )
}

fn read_save_journal(root: &Path) -> Result<Option<SaveJournal>, String> {
    let path = transaction_path(root, SAVE_JOURNAL_PATH)?;
    if !ordinary_file_exists(&path, "Save transaction journal")? {
        return Ok(None);
    }
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
    if metadata.len() > MAX_SAVE_JOURNAL_BYTES {
        return Err(format!(
            "Save transaction journal {} exceeds its safety limit.",
            path.display()
        ));
    }
    let encoded =
        fs::read(&path).map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let journal: SaveJournal = serde_json::from_slice(&encoded).map_err(|error| {
        format!(
            "Save transaction journal {} is invalid: {error}",
            path.display()
        )
    })?;
    if journal.schema != SAVE_JOURNAL_SCHEMA || journal.operation_id == 0 {
        return Err(format!(
            "Save transaction journal {} uses an unsupported schema or operation id.",
            path.display()
        ));
    }
    if journal.files.is_empty() || journal.files.len() > MAX_PROJECT_FILES + 2 {
        return Err(format!(
            "Save transaction journal {} contains an invalid file count.",
            path.display()
        ));
    }
    let mut paths = BTreeSet::new();
    for file in &journal.files {
        validate_relative_path(&file.path, "Save transaction path")?;
        if file.path != "project.toml"
            && file.path != EDITOR_METADATA_PATH
            && !file.path.ends_with(".story")
        {
            return Err(format!(
                "Save transaction path {} is not an editable project source.",
                file.path
            ));
        }
        if !paths.insert(file.path.clone()) {
            return Err(format!(
                "Save transaction journal contains duplicate path {}.",
                file.path
            ));
        }
    }
    Ok(Some(journal))
}

fn stages_from_journal(root: &Path, journal: &SaveJournal) -> Result<Vec<SaveStage>, String> {
    journal
        .files
        .iter()
        .map(|file| {
            reject_symlink_components(root, &file.path, "Save transaction path")?;
            let target = resolved_child(root, &file.path, "Save transaction path")?;
            Ok(SaveStage {
                relative_path: file.path.clone(),
                temporary: sibling_transaction_path(&target, "save", journal.operation_id)?,
                backup: sibling_transaction_path(&target, "previous", journal.operation_id)?,
                target,
                had_original: file.had_original,
            })
        })
        .collect()
}

fn commit_marker_exists(root: &Path, operation_id: u64) -> Result<bool, String> {
    let path = transaction_path(root, SAVE_COMMIT_PATH)?;
    if !ordinary_file_exists(&path, "Save commit marker")? {
        return Ok(false);
    }
    let encoded =
        fs::read(&path).map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let marker = std::str::from_utf8(&encoded)
        .ok()
        .and_then(|value| value.parse::<u64>().ok());
    if marker != Some(operation_id) {
        return Err(format!(
            "Save commit marker {} does not match transaction {}.",
            path.display(),
            operation_id
        ));
    }
    Ok(true)
}

fn validate_rollback_state(stages: &[SaveStage]) -> Result<(), String> {
    for stage in stages {
        let target_exists = ordinary_file_exists(&stage.target, "Project file")?;
        let temporary_exists = ordinary_file_exists(&stage.temporary, "Staged project file")?;
        let backup_exists = ordinary_file_exists(&stage.backup, "Project backup")?;
        if backup_exists && !stage.had_original {
            return Err(format!(
                "Unexpected backup exists for newly created file {}.",
                stage.relative_path
            ));
        }
        if backup_exists && target_exists {
            return Err(format!(
                "Both the project file and its backup exist for {}; refusing to overwrite either.",
                stage.relative_path
            ));
        }
        if stage.had_original && !backup_exists && !target_exists {
            return Err(format!(
                "Neither the original nor backup exists for {}.",
                stage.relative_path
            ));
        }
        let _ = temporary_exists;
    }
    Ok(())
}

fn rollback_prepared_save(root: &Path, stages: &[SaveStage]) -> Result<(), String> {
    validate_rollback_state(stages)?;
    for stage in stages.iter().rev() {
        if ordinary_file_exists(&stage.temporary, "Staged project file")? {
            remove_file_with_retry(&stage.temporary)?;
        }
        if ordinary_file_exists(&stage.backup, "Project backup")? {
            rename_with_retry(&stage.backup, &stage.target)?;
        }
    }
    sync_stage_parents(stages)?;
    remove_transaction_file(root, SAVE_COMMIT_PREPARE_PATH)?;
    remove_transaction_file(root, SAVE_JOURNAL_PATH)?;
    remove_transaction_file(root, SAVE_JOURNAL_PREPARE_PATH)?;
    sync_directory(&root.join(".rpgne"))
}

fn validate_forward_state(stages: &[SaveStage]) -> Result<(), String> {
    for stage in stages {
        let target_exists = ordinary_file_exists(&stage.target, "Project file")?;
        let temporary_exists = ordinary_file_exists(&stage.temporary, "Staged project file")?;
        let backup_exists = ordinary_file_exists(&stage.backup, "Project backup")?;
        if backup_exists && !stage.had_original {
            return Err(format!(
                "Unexpected backup exists for newly created file {}.",
                stage.relative_path
            ));
        }
        if target_exists && temporary_exists {
            return Err(format!(
                "Both the installed and staged versions exist for {}; refusing to choose one.",
                stage.relative_path
            ));
        }
        if !target_exists && !temporary_exists {
            return Err(format!(
                "Neither the installed nor staged version exists for {}.",
                stage.relative_path
            ));
        }
    }
    Ok(())
}

fn complete_committed_save(root: &Path, stages: &[SaveStage]) -> Result<(), String> {
    validate_forward_state(stages)?;
    for stage in stages {
        if ordinary_file_exists(&stage.temporary, "Staged project file")? {
            rename_with_retry(&stage.temporary, &stage.target)?;
        }
    }
    sync_stage_parents(stages)?;
    for stage in stages {
        if ordinary_file_exists(&stage.backup, "Project backup")? {
            remove_file_with_retry(&stage.backup)?;
        }
    }
    sync_stage_parents(stages)?;
    remove_transaction_file(root, SAVE_JOURNAL_PATH)?;
    sync_directory(&root.join(".rpgne"))?;
    remove_transaction_file(root, SAVE_COMMIT_PATH)?;
    remove_transaction_file(root, SAVE_COMMIT_PREPARE_PATH)?;
    remove_transaction_file(root, SAVE_JOURNAL_PREPARE_PATH)?;
    sync_directory(&root.join(".rpgne"))
}

fn recover_interrupted_save(root: &Path) -> Result<Option<String>, String> {
    let transaction_directory = root.join(".rpgne");
    let directory_metadata = match fs::symlink_metadata(&transaction_directory) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Could not inspect {}: {error}",
                transaction_directory.display()
            ));
        }
    };
    if directory_metadata.file_type().is_symlink() || !directory_metadata.is_dir() {
        return Err(format!(
            "Transaction directory {} must be an ordinary directory.",
            transaction_directory.display()
        ));
    }
    let journal_preparing = transaction_path(root, SAVE_JOURNAL_PREPARE_PATH)?;
    let journal = read_save_journal(root)?;
    if journal.is_some() && ordinary_file_exists(&journal_preparing, "Preparing save journal")? {
        return Err(
            "Both active and preparing save journals exist; refusing ambiguous recovery."
                .to_string(),
        );
    }
    let Some(journal) = journal else {
        remove_transaction_file(root, SAVE_JOURNAL_PREPARE_PATH)?;
        remove_transaction_file(root, SAVE_COMMIT_PREPARE_PATH)?;
        let commit = transaction_path(root, SAVE_COMMIT_PATH)?;
        if ordinary_file_exists(&commit, "Save commit marker")? {
            remove_file_with_retry(&commit)?;
            sync_directory(&root.join(".rpgne"))?;
            return Ok(Some(
                "Recovered an interrupted project save by completing it.".to_string(),
            ));
        }
        return Ok(None);
    };

    let committed = commit_marker_exists(root, journal.operation_id)?;
    let commit_preparing = transaction_path(root, SAVE_COMMIT_PREPARE_PATH)?;
    if committed && ordinary_file_exists(&commit_preparing, "Preparing commit marker")? {
        return Err(
            "Both active and preparing save commit markers exist; refusing ambiguous recovery."
                .to_string(),
        );
    }
    let stages = stages_from_journal(root, &journal)?;
    if committed {
        complete_committed_save(root, &stages)?;
        Ok(Some(
            "Recovered an interrupted project save by completing it.".to_string(),
        ))
    } else {
        rollback_prepared_save(root, &stages)?;
        Ok(Some(
            "Recovered an interrupted project save by rolling it back.".to_string(),
        ))
    }
}

fn atomically_replace_project_files(
    root: &Path,
    files: &[ProjectFile],
    operation_id: u64,
) -> Result<Option<String>, String> {
    let stages = prepare_save_stages(root, files, operation_id)?;
    let journal = journal_for_stages(operation_id, &stages);
    let mut committed = false;
    let result = (|| {
        write_save_journal(root, &journal)?;
        for (file, stage) in files.iter().zip(&stages) {
            write_synced_new(&stage.temporary, file.content.as_bytes())?;
        }
        sync_stage_parents(&stages)?;
        for stage in &stages {
            if stage.had_original {
                rename_with_retry(&stage.target, &stage.backup)?;
            }
        }
        sync_stage_parents(&stages)?;
        write_commit_marker(root, operation_id)?;
        committed = true;
        complete_committed_save(root, &stages)
    })();

    match result {
        Ok(()) => Ok(None),
        Err(save_error) => {
            let marker_committed =
                committed || commit_marker_exists(root, operation_id).unwrap_or(false);
            match recover_interrupted_save(root) {
                Ok(notice) if marker_committed => Ok(notice),
                Ok(_) => Err(save_error),
                Err(recovery_error) => Err(format!(
                    "{save_error} Automatic save recovery also failed: {recovery_error}"
                )),
            }
        }
    }
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
    let operation = operation_for_root(&state, &root)?;
    let _operation = operation_lock(&operation)?;
    let recovery_notice = recover_interrupted_save(&root)?;
    let snapshot = read_project(&root)?;
    let session_id = format!(
        "project-{}",
        state.next_session.fetch_add(1, Ordering::Relaxed) + 1
    );
    let watcher = create_project_watcher(&app, &root, &session_id)?;
    state_lock(&state)?.insert(
        session_id.clone(),
        ProjectSession {
            root: root.clone(),
            revisions: snapshot.revisions.clone(),
            writable_paths: snapshot.writable_paths.clone(),
            last_output: None,
            operation: Arc::clone(&operation),
            _watcher: watcher,
        },
    );
    Ok(Some(opened_project(
        session_id,
        &root,
        snapshot,
        recovery_notice,
    )))
}

#[tauri::command]
pub fn close_project(
    state: State<'_, ProjectState>,
    request: SessionRequest,
) -> Result<(), String> {
    state_lock(&state)?.remove(&request.session_id);
    Ok(())
}

#[tauri::command]
pub fn reload_project(
    state: State<'_, ProjectState>,
    request: SessionRequest,
) -> Result<OpenedProject, String> {
    let access = session_access(&state, &request.session_id)?;
    let _operation = operation_lock(&access.operation)?;
    let recovery_notice = recover_interrupted_save(&access.root)?;
    let snapshot = read_project(&access.root)?;
    {
        let mut sessions = state_lock(&state)?;
        let session = sessions
            .get_mut(&request.session_id)
            .ok_or_else(|| "This project session is no longer open.".to_string())?;
        session.revisions = snapshot.revisions.clone();
        session.writable_paths = snapshot.writable_paths.clone();
    }
    Ok(opened_project(
        request.session_id,
        &access.root,
        snapshot,
        recovery_notice,
    ))
}

#[tauri::command]
pub fn check_project_changes(
    state: State<'_, ProjectState>,
    request: SessionRequest,
) -> Result<ChangeCheckResult, String> {
    let access = session_access(&state, &request.session_id)?;
    let _operation = operation_lock(&access.operation)?;
    let recovery_notice = recover_interrupted_save(&access.root)?;
    let snapshot = read_project(&access.root)?;
    Ok(ChangeCheckResult {
        changed_paths: changed_paths(&access.revisions, &snapshot.revisions),
        recovery_notice,
    })
}

#[tauri::command]
pub fn save_project(
    state: State<'_, ProjectState>,
    request: SaveProjectRequest,
) -> Result<SaveProjectResult, String> {
    let access = session_access(&state, &request.session_id)?;
    let _operation = operation_lock(&access.operation)?;
    let recovery_notice = recover_interrupted_save(&access.root)?;
    validate_save_files(&request.files, &access.writable_paths)?;
    let current = read_project(&access.root)?;
    let external_changes = changed_paths(&access.revisions, &current.revisions);
    if !external_changes.is_empty() {
        return Ok(SaveProjectResult {
            saved_files: 0,
            changed_paths: external_changes,
            recovery_notice,
        });
    }

    let operation_id = state.next_operation.fetch_add(1, Ordering::Relaxed) + 1;
    let save_recovery_notice =
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
        recovery_notice: save_recovery_notice.or(recovery_notice),
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

#[cfg(test)]
mod tests {
    use super::*;

    static NEXT_TEST_PROJECT: AtomicU64 = AtomicU64::new(1);

    struct TestProject {
        root: PathBuf,
    }

    impl TestProject {
        fn create(label: &str) -> Self {
            let id = NEXT_TEST_PROJECT.fetch_add(1, Ordering::Relaxed);
            let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join("recovery-tests")
                .join(format!("{label}-{}-{id}", std::process::id()));
            fs::create_dir_all(root.join("scenes")).expect("create recovery test project");
            fs::write(
                root.join("project.toml"),
                "[project]\nid = \"test\"\ntitle = \"Before\"\n",
            )
            .expect("write test manifest");
            fs::write(root.join("scenes").join("main.story"), "scene before\n")
                .expect("write test story");
            Self { root }
        }

        fn replacement_files() -> Vec<ProjectFile> {
            vec![
                ProjectFile {
                    path: "project.toml".to_string(),
                    content: "[project]\nid = \"test\"\ntitle = \"After\"\n".to_string(),
                },
                ProjectFile {
                    path: "scenes/main.story".to_string(),
                    content: "scene after\n".to_string(),
                },
            ]
        }
    }

    impl Drop for TestProject {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn prepare_interrupted_transaction(
        project: &TestProject,
        operation_id: u64,
    ) -> (Vec<ProjectFile>, Vec<SaveStage>) {
        let files = TestProject::replacement_files();
        let stages =
            prepare_save_stages(&project.root, &files, operation_id).expect("prepare save stages");
        write_save_journal(&project.root, &journal_for_stages(operation_id, &stages))
            .expect("write save journal");
        for (file, stage) in files.iter().zip(&stages) {
            write_synced_new(&stage.temporary, file.content.as_bytes())
                .expect("write staged source");
        }
        for stage in &stages {
            rename_with_retry(&stage.target, &stage.backup).expect("back up original source");
        }
        (files, stages)
    }

    #[test]
    fn recovery_rolls_back_a_prepared_save_without_a_commit_marker() {
        let project = TestProject::create("rollback");
        let (_files, stages) = prepare_interrupted_transaction(&project, 4_101);

        let notice = recover_interrupted_save(&project.root)
            .expect("recover prepared save")
            .expect("report recovery");

        assert!(notice.contains("rolling it back"));
        assert!(fs::read_to_string(project.root.join("project.toml"))
            .expect("read restored manifest")
            .contains("Before"));
        assert_eq!(
            fs::read_to_string(project.root.join("scenes").join("main.story"))
                .expect("read restored story"),
            "scene before\n"
        );
        for stage in stages {
            assert!(!stage.temporary.exists());
            assert!(!stage.backup.exists());
        }
        assert!(!project.root.join(SAVE_JOURNAL_PATH).exists());
    }

    #[test]
    fn recovery_finishes_a_partially_installed_committed_save() {
        let project = TestProject::create("forward");
        let (files, stages) = prepare_interrupted_transaction(&project, 4_102);
        write_commit_marker(&project.root, 4_102).expect("write commit marker");
        rename_with_retry(&stages[0].temporary, &stages[0].target).expect("partially install save");

        let notice = recover_interrupted_save(&project.root)
            .expect("recover committed save")
            .expect("report recovery");

        assert!(notice.contains("completing it"));
        for file in files {
            assert_eq!(
                fs::read_to_string(resolved_child(&project.root, &file.path, "test path").unwrap())
                    .expect("read completed source"),
                file.content
            );
        }
        for stage in stages {
            assert!(!stage.temporary.exists());
            assert!(!stage.backup.exists());
        }
        assert!(!project.root.join(SAVE_JOURNAL_PATH).exists());
        assert!(!project.root.join(SAVE_COMMIT_PATH).exists());
    }
}
