fn main() {
    // Sem declarar os comandos do app aqui, o ACL do Tauri não gera permissão
    // para eles e qualquer `invoke` vindo da origem remota do painel é
    // recusado com «Command X not allowed by ACL» — sem nada no log do app,
    // só uma promessa rejeitada no JavaScript.
    //
    // Declarados, viram permissões `allow-<comando>` que as capabilities em
    // `capabilities/` concedem.
    let attributes = tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "notify",
            "start_panel",
            "reveal_path",
            "open_terminal",
            // Controles da janela sem moldura — a página remota do painel só
            // pode chamá-los se o ACL gerar a permissão `allow-<comando>`.
            "set_window_title",
            "start_window_drag",
            "pick_save_path",
            "pick_folder_path",
            "toggle_window_maximize",
            "minimize_window",
            "close_window",
            // Segundo plano / permissões do SO — chamados pela landing do painel.
            "set_keep_background",
            "get_keep_background",
            "open_os_settings",
            // Bolinha vermelha na barra de menus durante a gravação do Eco.
            "set_eco_recording",
        ]),
    );

    tauri_build::try_build(attributes).expect("falha ao gerar o manifesto do app")
}
