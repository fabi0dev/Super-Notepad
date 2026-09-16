//! Ciclo de vida do backend do app de Super-Notepad visto pelo shell desktop.
//!
//! O app não serve o frontend: ele sobe o backend Python (`python -m
//! super_notepad --no-open --port <p>`), que serve o SPA e as rotas de notas, e
//! aponta a webview para a URL local com token que o backend grava em disco.
//!
//! Diferente do Super Notepad, o backend do Super-Notepad roda em FOREGROUND (não destaca um
//! daemon), então o processo filho é mantido vivo enquanto o app estiver aberto
//! e encerrado no `stop_panel`.

use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;

/// Tempo para a porta abrir depois de spawnar o backend.
const READY_TIMEOUT: Duration = Duration::from_secs(60);

const DEFAULT_PORT: u16 = 9010;

/// Processo do backend — mantido vivo enquanto o app roda; morto no encerramento.
static CHILD: Mutex<Option<Child>> = Mutex::new(None);

/// Config opcional em `<super-notepad-home>/desktop.json`. Ausência ou campos vazios
/// caem na descoberta automática, então o app abre mesmo sem esse arquivo.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct DesktopState {
    /// Caminho do Python (idealmente o do venv do backend).
    python: String,
    /// Diretório que contém o pacote `super_notepad` (a pasta `backend/`).
    backend_dir: String,
    port: Option<u16>,
    keep_panel: bool,
}

fn state() -> &'static DesktopState {
    static STATE: OnceLock<DesktopState> = OnceLock::new();
    STATE.get_or_init(|| {
        std::fs::read_to_string(state_path())
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    })
}

fn state_path() -> PathBuf {
    super_notepad_home().join("desktop.json")
}

/// Espelha `get_super_notepad_home()` do lado Python: `SUPER_NOTEPAD_HOME` ou `~/.super-notepad`.
/// (O nome `super_notepad_home` é mantido porque o `main.rs` o consome.)
pub(crate) fn super_notepad_home() -> PathBuf {
    if let Some(raw) = std::env::var_os("SUPER_NOTEPAD_HOME") {
        let path = PathBuf::from(raw);
        if !path.as_os_str().is_empty() {
            return path;
        }
    }
    let home = std::env::var_os("HOME").unwrap_or_default();
    PathBuf::from(home).join(".super-notepad")
}

pub fn port() -> u16 {
    std::env::var("SUPER_NOTEPAD_DESKTOP_PORT")
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .or_else(|| state().port.filter(|p| *p > 0))
        .unwrap_or(DEFAULT_PORT)
}

#[tauri::command]
pub async fn start_panel() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| launch(None))
        .await
        .map_err(|e| format!("Falha ao executar a inicialização: {e}"))?
}

/// Correção acionada pela tela de erro: re-sobe o backend com o PATH do shell
/// de login (onde vivem pythons instalados por pyenv/Homebrew, etc.).
#[tauri::command]
pub async fn repair_panel() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| launch(login_shell_path()))
        .await
        .map_err(|e| format!("Falha ao executar a correção: {e}"))?
}

fn launch(path_override: Option<String>) -> Result<String, String> {
    let port = port();
    let url = spawn_backend(port, path_override.as_deref())?;
    wait_for_port(port, READY_TIMEOUT)?;
    crate::notify::debug_log(&format!("backend pronto, navegando para {url}"));
    Ok(url)
}

/// PATH montado pelo shell de login do usuário. Vazio/falha vira `None`.
fn login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let output = Command::new(shell)
        .args(["-lc", "printf %s \"$PATH\""])
        .stdin(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!path.is_empty()).then_some(path)
}

/// Resolve o interpretador Python: `SUPER_NOTEPAD_PYTHON` → `desktop.json` → venv do
/// backend ao lado do app → `python3` do PATH.
fn resolve_python() -> PathBuf {
    if let Some(raw) = std::env::var_os("SUPER_NOTEPAD_PYTHON") {
        let p = PathBuf::from(raw);
        if is_executable(&p) {
            return p;
        }
    }
    let configured = PathBuf::from(&state().python);
    if is_executable(&configured) {
        return configured;
    }
    if let Some(dir) = backend_dir() {
        let venv = dir.join(".venv/bin/python");
        if is_executable(&venv) {
            return venv;
        }
    }
    PathBuf::from("python3")
}

/// Diretório que contém o pacote `super_notepad` (a pasta `backend/`).
fn backend_dir() -> Option<PathBuf> {
    if let Some(raw) = std::env::var_os("SUPER_NOTEPAD_BACKEND_DIR") {
        let p = PathBuf::from(raw);
        if p.is_dir() {
            return Some(p);
        }
    }
    let configured = PathBuf::from(&state().backend_dir);
    if configured.is_dir() {
        return Some(configured);
    }
    // Dev: o repo tem `desktop/` e `backend/` como irmãos; a partir do
    // executável em desktop/src-tauri/target/... subimos até achar `backend`.
    if let Ok(exe) = std::env::current_exe() {
        let mut cur = exe.as_path();
        while let Some(parent) = cur.parent() {
            let candidate = parent.join("backend");
            if candidate.join("super_notepad").is_dir() {
                return Some(candidate);
            }
            cur = parent;
        }
    }
    None
}

fn spawn_backend(port: u16, path_override: Option<&str>) -> Result<String, String> {
    let python = resolve_python();
    let url_file = super_notepad_home().join("desktop_url.txt");
    // Começa limpo: uma URL velha de um arranque anterior confundiria o polling.
    let _ = std::fs::remove_file(&url_file);

    let mut cmd = Command::new(&python);
    cmd.arg("-m")
        .arg("super_notepad")
        .arg("--no-open")
        .arg("--port")
        .arg(port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .env("PYTHONUNBUFFERED", "1")
        .env("SUPER_NOTEPAD_DESKTOP_URL_FILE", &url_file);

    if let Some(dir) = backend_dir() {
        // Sem instalar o pacote: rodar com o `backend/` no cwd e no PYTHONPATH
        // deixa o `-m super_notepad` encontrá-lo.
        cmd.current_dir(&dir);
        cmd.env("PYTHONPATH", &dir);
    }
    if let Some(path) = path_override {
        cmd.env("PATH", path);
    }

    let child = cmd.spawn().map_err(|e| {
        format!(
            "Não consegui iniciar o backend com {}: {e}. \
             Configure SUPER_NOTEPAD_PYTHON / desktop.json.",
            python.display()
        )
    })?;

    if let Ok(mut slot) = CHILD.lock() {
        // Substitui (e mata) um backend anterior deste app, se houver.
        if let Some(mut old) = slot.take() {
            let _ = old.kill();
        }
        *slot = Some(child);
    }

    // Espera a URL com token que o backend grava em disco.
    let deadline = Instant::now() + READY_TIMEOUT;
    loop {
        if let Ok(url) = std::fs::read_to_string(&url_file) {
            let url = url.trim().to_string();
            if !url.is_empty() {
                return Ok(url);
            }
        }
        if !backend_alive() {
            let err = drain_stderr();
            return Err(trim_report(&format!(
                "O backend do Super-Notepad encerrou antes de ficar pronto.\n\n{err}"
            )));
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "O backend não ficou pronto em {}s.",
                READY_TIMEOUT.as_secs()
            ));
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

fn backend_alive() -> bool {
    if let Ok(mut slot) = CHILD.lock() {
        if let Some(child) = slot.as_mut() {
            return matches!(child.try_wait(), Ok(None));
        }
    }
    false
}

fn drain_stderr() -> String {
    if let Ok(mut slot) = CHILD.lock() {
        if let Some(child) = slot.as_mut() {
            if let Some(mut err) = child.stderr.take() {
                let mut buf = Vec::new();
                let _ = std::io::Read::read_to_end(&mut err, &mut buf);
                return String::from_utf8_lossy(&buf).into_owned();
            }
        }
    }
    String::new()
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

fn wait_for_port(port: u16, timeout: Duration) -> Result<(), String> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let deadline = Instant::now() + timeout;
    loop {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "O backend não respondeu na porta {port} em {}s.",
                timeout.as_secs()
            ));
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

/// Encerra o backend quando o app sai. `SUPER_NOTEPAD_DESKTOP_KEEP_PANEL=1` — ou
/// `keep_panel` no `desktop.json` — mantém o backend de pé.
pub fn stop_panel() {
    let keep = match std::env::var("SUPER_NOTEPAD_DESKTOP_KEEP_PANEL") {
        Ok(raw) => truthy(Some(raw.as_str())),
        Err(_) => state().keep_panel,
    };
    if keep {
        return;
    }
    if let Ok(mut slot) = CHILD.lock() {
        if let Some(mut child) = slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn truthy(value: Option<&str>) -> bool {
    matches!(value.map(str::trim), Some("1" | "true" | "yes" | "on"))
}

/// Corta relatórios de erro longos para caberem na tela de erro.
fn trim_report(text: &str) -> String {
    const LIMIT: usize = 1200;
    let cleaned = text.trim();
    let total = cleaned.chars().count();
    if total <= LIMIT {
        return cleaned.to_string();
    }
    let tail: String = cleaned.chars().skip(total - LIMIT).collect();
    format!("…{tail}")
}
