//! Autorização do IPC para a página do painel + rastro de diagnóstico.
//!
//! O painel roda numa origem REMOTA (`http://127.0.0.1:<porta>`), e o Tauri
//! recusa IPC de origem remota a menos que ela esteja declarada numa
//! capability. Como a porta é configurável, a capability não pode ser um
//! arquivo estático — ela é montada em tempo de execução com a porta real
//! (ver [`register_panel_origin`]).

use tauri::AppHandle;

/// Rastro de diagnóstico. Fica atrás de `SUPER_NOTEPAD_DESKTOP_DEBUG` porque o
/// caminho feliz não deve poluir a saída, mas quando algo «não acontece» a
/// primeira pergunta é se o pedido chegou até aqui — sem isto não há como
/// distinguir IPC bloqueado de outra falha.
pub fn debug_log(message: &str) {
    if std::env::var("SUPER_NOTEPAD_DESKTOP_DEBUG").is_ok_and(|v| !v.trim().is_empty() && v != "0") {
        eprintln!("[sn-desktop] {message}");
    }
}

/// Autoriza a origem do painel a usar o IPC.
///
/// Sem isto o `invoke` da página remota é descartado silenciosamente — os
/// comandos (arraste da janela, título, seletor de arquivo…) simplesmente
/// nunca surtem efeito, sem erro visível em lugar nenhum.
pub fn register_panel_origin(app: &AppHandle, port: u16) -> Result<(), String> {
    use tauri::Manager;
    let capability = serde_json::json!({
        "identifier": "painel-remoto",
        "description": "Permite ao painel servido em localhost usar o IPC do app.",
        "windows": ["main", "panel-*"],
        "remote": {
            "urls": [
                format!("http://127.0.0.1:{port}/*"),
                format!("http://localhost:{port}/*"),
            ]
        },
        "permissions": [
            "core:default",
            "allow-reveal-path",
            "allow-open-terminal",
            // Controles da barra de título integrada (arraste, min/max/fechar,
            // título). Sem estes, o `invoke` da página remota é recusado pelo
            // ACL em silêncio — foi o que deixou o arraste sem efeito.
            "allow-set-window-title",
            "allow-start-window-drag",
            // Diálogo "salvar como" e seletor nativo de pasta.
            "allow-pick-save-path",
            "allow-pick-folder-path",
            "allow-toggle-window-maximize",
            "allow-minimize-window",
            "allow-close-window",
            // Atalhos para os ajustes de permissão do SO (landing).
            "allow-open-os-settings"
        ]
    });

    app.add_capability(capability.to_string())
        .map_err(|e| format!("não consegui autorizar a origem do painel: {e}"))
}
