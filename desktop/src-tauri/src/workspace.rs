//! Ações do sistema sobre a pasta do projeto: revelar no gerenciador de
//! arquivos e abrir um terminal ali.
//!
//! Vive no app, e não numa rota do servidor, porque é acesso ao sistema do
//! usuário: pelo servidor a mesma ação ficaria acessível a qualquer página
//! aberta no navegador que alcançasse a porta local. Aqui só a webview do
//! app chega, pela capability já declarada para a origem do painel.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Só diretórios existentes e caminhos absolutos passam.
///
/// O caminho chega do JavaScript. Ele vem do próprio painel hoje, mas quem
/// valida não pode confiar na origem — um caminho relativo seria resolvido
/// contra o diretório do app, e um arquivo (ou algo inexistente) faria o
/// lançador se comportar de formas imprevisíveis.
fn validar(raw: &str) -> Result<PathBuf, String> {
    let caminho = Path::new(raw.trim());

    if raw.trim().is_empty() {
        return Err("Caminho vazio.".into());
    }
    if !caminho.is_absolute() {
        return Err("O caminho precisa ser absoluto.".into());
    }

    let resolvido = caminho
        .canonicalize()
        .map_err(|e| format!("Caminho inacessível: {e}"))?;

    if !resolvido.is_dir() {
        return Err("O caminho não é uma pasta.".into());
    }

    Ok(resolvido)
}

/// Argumentos passados um a um — nunca uma linha de shell —, para que um
/// caminho com espaço, aspas ou `;` seja tratado como texto e não como
/// comando.
fn lancar(programa: &str, args: &[&str]) -> Result<(), String> {
    Command::new(programa)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Não consegui executar {programa}: {e}"))
}

#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    let dir = validar(&path)?;
    let alvo = dir.to_string_lossy().to_string();

    crate::notify::debug_log(&format!("revelando no gerenciador: {alvo}"));

    if cfg!(target_os = "macos") {
        lancar("open", &["-R", &alvo])
    } else {
        lancar("xdg-open", &[&alvo])
    }
}

#[tauri::command]
pub fn open_terminal(path: String) -> Result<(), String> {
    let dir = validar(&path)?;
    let alvo = dir.to_string_lossy().to_string();

    crate::notify::debug_log(&format!("abrindo terminal em: {alvo}"));

    if cfg!(target_os = "macos") {
        return lancar("open", &["-a", "Terminal", &alvo]);
    }

    // No Linux não há um terminal padrão único. `x-terminal-emulator` é a
    // indireção do Debian; os outros são os emuladores mais comuns. O
    // primeiro que existir atende.
    let candidatos: [(&str, Vec<&str>); 4] = [
        ("x-terminal-emulator", vec!["--working-directory", &alvo]),
        ("gnome-terminal", vec!["--working-directory", &alvo]),
        ("konsole", vec!["--workdir", &alvo]),
        ("xterm", vec!["-e", "cd"]),
    ];
    for (programa, args) in candidatos {
        if lancar(programa, &args).is_ok() {
            return Ok(());
        }
    }
    Err("Nenhum emulador de terminal encontrado.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_and_relative_paths() {
        assert!(validar("").is_err());
        assert!(validar("   ").is_err());
        assert!(validar("relativo/demais").is_err());
    }

    #[test]
    fn rejects_missing_paths() {
        assert!(validar("/caminho/que/nao/existe/mesmo").is_err());
    }

    #[test]
    fn rejects_files() {
        // Revelar aceita arquivo em alguns sistemas, abrir terminal não —
        // manter uma regra só evita comportamento diferente por plataforma.
        let arquivo = std::env::current_exe().expect("sem executável de teste");
        assert!(validar(&arquivo.to_string_lossy()).is_err());
    }

    #[test]
    fn accepts_an_existing_directory() {
        let dir = std::env::temp_dir();
        assert!(validar(&dir.to_string_lossy()).is_ok());
    }
}
