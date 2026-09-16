//! Barra de menus nativa do app e a ponte menu → front.
//!
//! As ações que mexem na página (nova nota, buscar, ocultar lista…) são
//! despachadas ao front por um evento `supernotepad:menu`; as de janela e de
//! edição (copiar/colar/desfazer) são itens PREDEFINIDOS que o próprio sistema
//! resolve, para os atalhos padrão (⌘Z/⌘C/⌘V…) funcionarem no editor.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Manager;

/// Monta a barra de menus (macOS: no topo da tela; Windows/Linux: na janela).
pub(crate) fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // ── Super Note (menu do app) ──────────────────────────────────────────
    let settings = MenuItem::with_id(
        app,
        "settings",
        "Configurações…",
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let app_menu = Submenu::with_items(
        app,
        "Super Note",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("Sobre o Super Note"), None)?,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some("Serviços"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("Ocultar Super Note"))?,
            &PredefinedMenuItem::hide_others(app, Some("Ocultar Outros"))?,
            &PredefinedMenuItem::show_all(app, Some("Mostrar Tudo"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Encerrar Super Note"))?,
        ],
    )?;

    // ── Arquivo ───────────────────────────────────────────────────────────────
    let new_note =
        MenuItem::with_id(app, "menu-new-note", "Nova nota", true, Some("CmdOrCtrl+N"))?;
    let new_folder = MenuItem::with_id(
        app,
        "menu-new-folder",
        "Nova pasta",
        true,
        Some("CmdOrCtrl+Shift+N"),
    )?;
    let open_file = MenuItem::with_id(
        app,
        "menu-open-file",
        "Abrir arquivo…",
        true,
        Some("CmdOrCtrl+O"),
    )?;
    let file_menu = Submenu::with_items(
        app,
        "Arquivo",
        true,
        &[
            &new_note,
            &new_folder,
            &PredefinedMenuItem::separator(app)?,
            &open_file,
        ],
    )?;

    // ── Editar (predefinidos: os atalhos de edição do sistema) ─────────────────
    let edit_menu = Submenu::with_items(
        app,
        "Editar",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("Desfazer"))?,
            &PredefinedMenuItem::redo(app, Some("Refazer"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("Recortar"))?,
            &PredefinedMenuItem::copy(app, Some("Copiar"))?,
            &PredefinedMenuItem::paste(app, Some("Colar"))?,
            &PredefinedMenuItem::select_all(app, Some("Selecionar tudo"))?,
        ],
    )?;

    // ── Exibir ────────────────────────────────────────────────────────────────
    let toggle_list = MenuItem::with_id(
        app,
        "menu-toggle-list",
        "Mostrar/ocultar lista",
        true,
        Some("CmdOrCtrl+\\"),
    )?;
    let focus_search = MenuItem::with_id(
        app,
        "menu-focus-search",
        "Buscar",
        true,
        Some("CmdOrCtrl+F"),
    )?;
    let view_menu = Submenu::with_items(
        app,
        "Exibir",
        true,
        &[&toggle_list, &focus_search],
    )?;

    // ── Janela (predefinidos) ─────────────────────────────────────────────────
    let window_menu = Submenu::with_items(
        app,
        "Janela",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("Minimizar"))?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some("Fechar"))?,
        ],
    )?;

    Menu::with_items(
        app,
        &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu],
    )
}

/// Despacha uma ação de menu ao front, na janela em foco (ou na principal). O
/// front escuta `supernotepad:menu` e decide o que fazer (criar nota, focar a
/// busca, navegar para os ajustes…).
pub(crate) fn emit_menu_action(app: &tauri::AppHandle, action: &str) {
    let win = app
        .webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| app.get_webview_window("main"));
    if let Some(win) = win {
        let a = serde_json::to_string(action).unwrap_or_else(|_| "\"\"".to_string());
        let _ = win.eval(&format!(
            "window.dispatchEvent(new CustomEvent('supernotepad:menu',{{detail:{{action:{a}}}}}));"
        ));
    }
}

/// "Abrir arquivo…": seletor nativo → lê um .md/.txt → manda o conteúdo ao front
/// criar uma nota. O diálogo é assíncrono (callback), então nada bloqueia a UI.
pub(crate) fn menu_open_file(app: &tauri::AppHandle) {
    use tauri_plugin_dialog::DialogExt;
    let handle = app.clone();
    app.dialog()
        .file()
        .add_filter("Texto e Markdown", &["md", "markdown", "txt", "text"])
        .set_title("Abrir arquivo como nota")
        .pick_file(move |chosen| {
            let Some(fp) = chosen else { return };
            let Ok(path) = fp.into_path() else { return };
            let name = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("Nota importada")
                .to_string();
            let content = std::fs::read_to_string(&path).unwrap_or_default();
            let win = handle
                .get_webview_window("main")
                .or_else(|| handle.webview_windows().into_values().next());
            if let Some(win) = win {
                let n = serde_json::to_string(&name).unwrap_or_else(|_| "\"\"".to_string());
                let c =
                    serde_json::to_string(&content).unwrap_or_else(|_| "\"\"".to_string());
                let _ = win.eval(&format!(
                    "window.dispatchEvent(new CustomEvent('supernotepad:menu',\
                     {{detail:{{action:'open-file',name:{n},content:{c}}}}}));"
                ));
            }
        });
}
