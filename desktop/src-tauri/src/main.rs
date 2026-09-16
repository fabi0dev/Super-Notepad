// Evita abrir um console extra no Windows em release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod links;
mod notify;
mod panel;
mod workspace;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri::{Manager, WebviewUrl};

/// Lê a preferência "Fundo transparente" persistida (padrão: desligada).
///
/// No macOS o flag `transparent` da janela só pode ser definido na criação, e
/// esta preferência é quem decide. Fica num arquivo próprio em
/// `<super_notepad_home>/desktop_transparent` ("1"/"0"), gravado pelo servidor do painel
/// quando o usuário troca a opção — separado do `desktop.json` (do `python -m super_notepad
/// desktop`) para não pisar na configuração de caminho/porta. Vale a partir do
/// próximo arranque, que é justamente quando esta função é chamada.
fn read_transparent_pref() -> bool {
    std::fs::read_to_string(panel::super_notepad_home().join("desktop_transparent"))
        .map(|s| s.trim() == "1")
        .unwrap_or(false)
}

/// Tema escolhido pelo usuário (dark/light/system), gravado pelo painel em
/// `<super_notepad_home>/desktop_theme`. O splash do bootstrap roda numa origem sem o
/// localStorage do painel, então injetamos este valor cedo (init script) para
/// a tela de carregamento já nascer na cor certa. "system" (ou ausente) deixa
/// o bootstrap seguir o `prefers-color-scheme`.
fn read_boot_theme() -> String {
    let value = std::fs::read_to_string(panel::super_notepad_home().join("desktop_theme"))
        .map(|s| s.trim().to_lowercase())
        .unwrap_or_default();
    match value.as_str() {
        "dark" | "light" | "system" => value,
        _ => "system".to_string(),
    }
}

/// Abre a tela de ajustes do SO na seção pedida ("notifications" | "login-items").
///
/// A concessão de permissão é do usuário no próprio SO — o app não pode marcá-la
/// por conta própria, então a landing leva direto ao lugar certo. Cada
/// plataforma tem seu esquema de URL/atalho.
#[tauri::command]
fn open_os_settings(section: String) {
    #[cfg(target_os = "macos")]
    {
        let url = match section.as_str() {
            "notifications" => "x-apple.systempreferences:com.apple.preference.notifications",
            "login-items" => {
                "x-apple.systempreferences:com.apple.LoginItems-Settings.extension"
            }
            "files" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders"
            }
            "screen-recording" => {
                // Sequoia+ (PrivacySecurity) + fallback clássico.
                let _ = std::process::Command::new("open")
                    .arg("x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture")
                    .spawn();
                let _ = std::process::Command::new("open")
                    .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
                    .spawn();
                return;
            }
            _ => "x-apple.systempreferences:",
        };
        let _ = std::process::Command::new("open").arg(url).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let target = match section.as_str() {
            "notifications" => "ms-settings:notifications",
            "login-items" => "ms-settings:startupapps",
            "files" => "ms-settings:privacy-broadfilesystemaccess",
            _ => "ms-settings:",
        };
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", target])
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = &section; // sem um destino universal no Linux; a landing orienta.
    }
}

/// Traz a janela principal de volta (bandeja, reabertura no dock do macOS).
/// Se a "main" foi DESTRUÍDA (usuário fechou a home sem "manter em segundo
/// plano"), recria — senão o "Abrir Super Note" não tinha o que mostrar e só sobrava
/// focar outra janela de app que ficou aberta (ex.: Notas).
fn show_main_window(app: &tauri::AppHandle) {
    let window = match app.get_webview_window("main") {
        Some(window) => window,
        None => match build_main_window(app) {
            Ok(window) => window,
            Err(err) => {
                notify::debug_log(&format!("falha ao recriar a janela principal: {err}"));
                return;
            }
        },
    };
    let _ = window.show();
    let _ = window.unminimize();
    // No macOS, `set_focus()` sozinho NÃO traz a "main" para a FRENTE das
    // outras janelas do app quando uma janela própria de app (Finanças, Eco…)
    // é a key window — o "Abrir Super Note" acabava só focando a janela que já
    // estava aberta em vez de mostrar a home. O toggle de always-on-top força
    // o raise acima das irmãs sem deixá-la fixada no topo.
    #[cfg(target_os = "macos")]
    {
        let _ = window.set_always_on_top(true);
        let _ = window.set_always_on_top(false);
    }
    let _ = window.set_focus();
}

/// Barra de menus nativa do app (macOS: no topo da tela; Windows/Linux: na
/// janela). As ações que mexem na página (nova nota, buscar, ocultar lista…)
/// são despachadas ao front por um evento `supernotepad:menu`; as de janela e de
/// edição (copiar/colar/desfazer) são itens PREDEFINIDOS que o próprio sistema
/// resolve, para os atalhos padrão (⌘Z/⌘C/⌘V…) funcionarem no editor.
fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
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
fn emit_menu_action(app: &tauri::AppHandle, action: &str) {
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
fn menu_open_file(app: &tauri::AppHandle) {
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

/// Aplica o desfoque do sistema atrás da janela, quando a plataforma tem um.
///
/// macOS usa `NSVisualEffectView` (o mesmo efeito das janelas nativas) e
/// Windows usa acrylic. No Linux não há API equivalente: lá o desfeito é
/// atribuição do compositor (KWin, Hyprland, Picom), que aplica o efeito às
/// janelas transparentes conforme a regra do usuário — por isso não há
/// chamada a fazer, e a transparência sozinha já produz o resultado.
fn apply_backdrop_blur(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
        if let Err(err) = apply_vibrancy(
            window,
            NSVisualEffectMaterial::HudWindow,
            None,
            None,
        ) {
            eprintln!("[sn-desktop] vibrancy indisponível: {err}");
        }
    }

    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::apply_acrylic;
        if let Err(err) = apply_acrylic(window, Some((19, 19, 22, 125))) {
            eprintln!("[sn-desktop] acrylic indisponível: {err}");
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = window;
    }
}

/// Sincroniza o título nativo da janela com o `document.title` do painel.
///
/// Toda janela nasce como "Super Note"; o front resolve o título por rota (ex.:
/// "E-mail — Super Note") e chama isto para a barra de título nativa acompanhar.
#[tauri::command]
fn set_window_title(window: tauri::Window, title: String) {
    let _ = window.set_title(&title);
}

/// Abre o diálogo nativo "salvar como" e devolve o caminho escolhido (ou
/// ``None`` se cancelar). Usado pelo Backup: o painel roda na mesma máquina, então
/// o painel grava o zip DIRETO nesse caminho (`/api/backup/finalize`).
///
/// ASYNC de propósito: comando síncrono roda na MAIN thread, e
/// `blocking_save_file()` bloquearia a main thread esperando o painel — que
/// PRECISA da main thread pra rodar → o app congela. Async roda fora da main
/// thread; usamos a API de callback (não-bloqueante) + um oneshot pra aguardar
/// o resultado sem travar a UI.
#[tauri::command]
async fn pick_save_path(app: tauri::AppHandle, default_name: String) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let name = if default_name.trim().is_empty() {
        "sn-backup.zip".to_string()
    } else {
        default_name
    };
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(&name)
        .add_filter("Backup do Super Note", &["zip"])
        .save_file(move |path| {
            let _ = tx.send(path);
        });
    rx.await
        .ok()
        .flatten()
        .and_then(|p| p.into_path().ok())
        .map(|pb| pb.to_string_lossy().to_string())
}

/// Abre o seletor NATIVO de pasta e devolve o caminho escolhido (ou ``None`` se
/// cancelar). Usado pelo "Abrir pasta" do chat (pasta de trabalho da conversa).
/// Async pelo mesmo motivo do pick_save_path: não bloquear a main thread.
#[tauri::command]
async fn pick_folder_path(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path);
    });
    rx.await
        .ok()
        .flatten()
        .and_then(|p| p.into_path().ok())
        .map(|pb| pb.to_string_lossy().to_string())
}

/// Arrasta a janela a partir da faixa do topo (barra de título integrada).
///
/// No macOS a janela usa `titleBarStyle: Overlay` (sem barra nativa), então o
/// arraste NÃO vem de graça — e `-webkit-app-region: drag` é do Chromium, que
/// o WKWebView ignora. O front chama este comando no `mousedown` da faixa e o
/// próprio WebKit assume o arraste do resto do gesto.
#[tauri::command]
fn start_window_drag(window: tauri::Window) {
    let _ = window.start_dragging();
}

/// Alterna maximizar/restaurar — duplo-clique na faixa, como numa barra nativa.
#[tauri::command]
fn toggle_window_maximize(window: tauri::Window) {
    match window.is_maximized() {
        Ok(true) => {
            let _ = window.unmaximize();
        }
        _ => {
            let _ = window.maximize();
        }
    }
}

/// Minimiza a janela. Usado pelos controles próprios (Windows/Linux), onde a
/// janela é SEM moldura e não há botões nativos.
#[tauri::command]
fn minimize_window(window: tauri::Window) {
    let _ = window.minimize();
}

/// Fecha a janela — controle próprio do Windows/Linux (sem moldura nativa).
#[tauri::command]
fn close_window(window: tauri::Window) {
    let _ = window.close();
}

/// Barra de título integrada, conforme a plataforma — mesmo visual "sem
/// moldura" no macOS e no Windows/Linux, com o app híbrido nos dois.
///
/// - **macOS**: `Overlay` + título oculto mantém os controles NATIVOS (os três
///   círculos) flutuando sobre o conteúdo. `title_bar_style`/`hidden_title` só
///   existem no macOS na API do Tauri — por isso ficam sob `#[cfg]` (sem isso
///   nem compilaria para Windows).
/// - **Windows/Linux**: não há Overlay; a janela nasce SEM moldura e o próprio
///   app desenha os controles no topo (ver `.sn-win-controls` no frontend),
///   chamando `minimize_window`/`toggle_window_maximize`/`close_window`.
fn apply_seamless_chrome<'a, R: tauri::Runtime, M: tauri::Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    #[cfg(target_os = "macos")]
    {
        builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder.decorations(false)
    }
}

/// Abre uma URL do painel numa JANELA DESKTOP própria.
///
/// A janela recebe os MESMOS desvios de link da principal — navegação e
/// `target="_blank"`. Sem isso, links dentro dela (ex.: "criar senha de app"
/// na tela de e-mail) não teriam quem os atendesse e o clique morreria. Por
/// isso o `on_new_window` da filha chama esta própria função de novo.
/// Título nativo da janela a partir da rota do painel. Definido já na CRIAÇÃO
/// (não depende do IPC da origem remota, que pode falhar) — assim cada app abre
/// com "Super Note — <App>" em vez do genérico "Super Note". O front ainda refina depois
/// via `set_window_title` (ex.: estado "(Trabalhando)").
fn title_for_url(url: &tauri::Url) -> String {
    let path = url.path().trim_end_matches('/');
    let name = match path {
        "/mail" => "E-mail",
        "/agenda" => "Agenda",
        "/contas" => "Central de contas",
        "/drive" => "Drive",
        "/tarefas" => "Tarefas",
        "/config" => "Configurações",
        "/memory" => "Memória",
        "/analytics" => "Uso e custos",
        "/logs" => "Logs",
        "/cron" => "Agendamentos",
        "/skills" => "Skills",
        "/env" => "Chaves de API",
        "/channels" => "Canais",
        "/home" => "Início",
        "" | "/" | "/chat" => "Chat",
        _ => return "Super Note".to_string(),
    };
    format!("Super Note — {name}")
}

/// Label ESTÁVEL por app/rota, para reusar a janela em vez de abrir uma nova a
/// cada clique (era `panel-N` sempre novo → janelas duplicadas e espalhadas).
/// Mesmo app → mesma janela: o clique seguinte foca/atualiza a que já existe.
fn label_for_url(url: &tauri::Url) -> String {
    let path = url.path().trim_end_matches('/');
    // Eco e sub-rotas (biblioteca/detalhe) compartilham a mesma janela — senão
    // cada clique em "Ver gravações" criaria um panel-eco-gravacoes separado.
    let path = if path.starts_with("/eco") {
        "/eco"
    } else {
        path
    };
    let slug = if path.is_empty() { "chat" } else { path.trim_start_matches('/') };
    let clean: String = slug
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let clean = clean.trim_matches('-');
    format!("panel-{}", if clean.is_empty() { "chat" } else { clean })
}

/// Posição (lógica) para centralizar uma janela 1100x820 no monitor da janela
/// ATUAL (em foco), em vez de sempre no primário. `.center()` do Tauri usa o
/// monitor primário — daí a janela abria noutra tela. `None` = sem referência
/// (aí o chamador cai no `.center()` padrão).
fn center_on_active_monitor(handle: &tauri::AppHandle) -> Option<(f64, f64)> {
    let reference = handle
        .webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| handle.get_webview_window("main"))?;
    let mon = reference.current_monitor().ok().flatten()?;
    let sf = mon.scale_factor();
    let mp = mon.position().to_logical::<f64>(sf);
    let ms = mon.size().to_logical::<f64>(sf);
    let x = mp.x + (ms.width - 1100.0) / 2.0;
    let y = mp.y + (ms.height - 820.0) / 2.0;
    Some((x, y))
}

fn open_internal_window(handle: tauri::AppHandle, port: u16, url: tauri::Url) {
    let label = label_for_url(&url);
    // Já existe janela deste app? Reusa em vez de abrir outra (fim das
    // duplicatas e do excesso de janelas). Se o alvo aponta um ITEM específico
    // (e-mail, nota, conversa), navega para ele; senão só traz à frente — sem
    // recarregar a tela ao reabrir o mesmo app.
    if let Some(existing) = handle.get_webview_window(&label) {
        let has_item = url.query_pairs().any(|(k, _)| {
            matches!(
                k.as_ref(),
                "uid" | "open" | "resume" | "new" | "id" | "record" | "stop" | "focus"
            )
        });
        if has_item {
            let _ = existing.navigate(url);
        }
        let _ = existing.set_focus();
        return;
    }
    let nw_handle = handle.clone();
    // A janela do painel (ex.: E-mail) segue a MESMA regra da principal: quando
    // "Fundo transparente" está ligado ela nasce transparente com o desfoque do
    // sistema atrás — senão o vidro "não pega" nesta tela e ela fica opaca
    // enquanto o resto do app é translúcido. Opaco + transparent(true) aborta no
    // macOS, então o alfa do fundo acompanha o flag.
    let transparent = read_transparent_pref();
    let mut builder =
        WebviewWindowBuilder::new(&handle, label, WebviewUrl::External(url.clone()))
            .title(title_for_url(&url))
            .inner_size(1100.0, 820.0)
            .min_inner_size(720.0, 520.0)
            .resizable(true);
    // Abre no MESMO monitor da janela atual (não sempre no primário).
    builder = match center_on_active_monitor(&handle) {
        Some((x, y)) => builder.position(x, y),
        None => builder.center(),
    };
    builder = apply_seamless_chrome(builder);
    builder = if transparent {
        builder
            .transparent(true)
            .background_color(tauri::window::Color(0x13, 0x13, 0x16, 0x00))
    } else {
        builder.background_color(tauri::window::Color(0x13, 0x13, 0x16, 0xFF))
    };
    let built = builder
        .on_navigation(move |u| {
            if links::is_internal(u, port) {
                return true;
            }
            links::open_in_browser(u);
            false
        })
        .on_new_window(move |u, _features| {
            if matches!(u.scheme(), "http" | "https") && links::is_internal(&u, port) {
                open_internal_window(nw_handle.clone(), port, u);
                return NewWindowResponse::Deny;
            }
            links::open_in_browser(&u);
            NewWindowResponse::Deny
        })
        .build();
    match built {
        Ok(window) => {
            if transparent {
                apply_backdrop_blur(&window);
            }
            enable_spellcheck(&window);
        }
        Err(err) => {
            notify::debug_log(&format!("falha ao abrir janela interna: {err}"));
            links::open_in_browser(&url);
        }
    }
}

/// Liga a correção ortográfica contínua da WKWebView (o sublinhado ondulado
/// vermelho embaixo das palavras erradas). Na WKWebView do macOS o atributo
/// HTML `spellcheck` sozinho não acende nada — é preciso este flag nativo.
/// Guardado por `respondsToSelector:` para nunca quebrar se a API mudar.
#[cfg(target_os = "macos")]
fn enable_spellcheck(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|pw| {
        use objc2::runtime::{AnyObject, Sel};
        use objc2::{msg_send, sel};
        let wk = pw.inner() as *mut AnyObject;
        if wk.is_null() {
            return;
        }
        unsafe {
            let set_spell: Sel = sel!(setContinuousSpellCheckingEnabled:);
            let responds: bool = msg_send![wk, respondsToSelector: set_spell];
            if responds {
                let _: () = msg_send![wk, setContinuousSpellCheckingEnabled: true];
            }
            let set_grammar: Sel = sel!(setGrammarCheckingEnabled:);
            let responds_g: bool = msg_send![wk, respondsToSelector: set_grammar];
            if responds_g {
                let _: () = msg_send![wk, setGrammarCheckingEnabled: true];
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn enable_spellcheck(_window: &tauri::WebviewWindow) {}

/// Cria a janela principal ("main"), com todos os desvios de navegação, tema,
/// transparência e o handler de fechamento. Extraído do `setup` para poder ser
/// RECRIADA depois: quando o usuário fecha a home sem "manter em segundo plano",
/// a janela é destruída — e o "Abrir Super Note" precisa reconstruí-la, senão só
/// sobrava focar outra janela de app que ficou aberta (ex.: Notas).
fn build_main_window(handle: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    let port = panel::port();
    // A transparência é decidida AGORA, na criação (o macOS não deixa trocar
    // depois). Padrão: janela OPACA. Opaco + `transparent(true)` aborta no macOS.
    let transparent = read_transparent_pref();

    // Injeta o tema escolhido ANTES de qualquer script da página (splash sem flash).
    let boot_theme = read_boot_theme();
    let boot_theme_script = format!(
        "window.__SUPER_NOTEPAD_BOOT_THEME__={theme:?};\
         try{{var t={theme:?};\
         if(t===\"system\"){{t=window.matchMedia&&window.matchMedia(\"(prefers-color-scheme: light)\").matches?\"light\":\"dark\";}}\
         document.documentElement.setAttribute(\"data-boot-theme\",t===\"light\"?\"light\":\"dark\");}}catch(e){{}}",
        theme = boot_theme,
    );
    let mut builder = WebviewWindowBuilder::new(handle, "main", WebviewUrl::default())
        .title("Super Note")
        .initialization_script(&boot_theme_script)
        .inner_size(1280.0, 840.0)
        .min_inner_size(900.0, 600.0)
        .center()
        .resizable(true);
    builder = apply_seamless_chrome(builder);

    builder = if transparent {
        builder
            .transparent(true)
            .background_color(tauri::window::Color(0x13, 0x13, 0x16, 0x00))
    } else {
        builder.background_color(tauri::window::Color(0x13, 0x13, 0x16, 0xFF))
    };

    let window = builder
        // Navegação na própria janela (link `_self`, redirect, JS).
        .on_navigation(move |url| {
            if links::is_internal(url, port) {
                return true;
            }
            links::open_in_browser(url);
            false
        })
        // `window.open` / `target="_blank"`: painel abre em janela desktop nova.
        .on_new_window({
            let nw_handle: tauri::AppHandle = handle.clone();
            move |url, _features| {
                if matches!(url.scheme(), "http" | "https") && links::is_internal(&url, port) {
                    open_internal_window(nw_handle.clone(), port, url);
                    return NewWindowResponse::Deny;
                }
                links::open_in_browser(&url);
                NewWindowResponse::Deny
            }
        })
        .build()?;

    // O desfoque só é visível na janela transparente.
    if transparent {
        apply_backdrop_blur(&window);
    }
    enable_spellcheck(&window);

    // Sem segundo plano: fechar a janela encerra o app (comportamento padrão do
    // Tauri quando a última janela fecha). O Super Note é um app de primeiro
    // plano — não fica rodando escondido nem tem bandeja.

    Ok(window)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .menu(|handle| build_app_menu(handle))
        .on_menu_event(|app, event| match event.id.as_ref() {
            "settings" => emit_menu_action(app, "settings"),
            "menu-new-note" => emit_menu_action(app, "new-note"),
            "menu-new-folder" => emit_menu_action(app, "new-folder"),
            "menu-toggle-list" => emit_menu_action(app, "toggle-list"),
            "menu-focus-search" => emit_menu_action(app, "focus-search"),
            "menu-open-file" => menu_open_file(app),
            _ => {}
        })
        .setup(|app| {
            let handle = app.handle();
            let port = panel::port();

            // A capability da origem remota precisa existir ANTES de a webview
            // navegar para o painel, senão o primeiro `invoke` já cai.
            match notify::register_panel_origin(handle, port) {
                Ok(()) => notify::debug_log("origem do painel autorizada no IPC"),
                Err(err) => eprintln!("[sn-desktop] {err}"),
            }

            // A janela principal é construída em código (não pelo tauri.conf.json)
            // porque os desvios de navegação só existem no builder. Extraída para
            // `build_main_window` para poder ser RECRIADA no reabrir (dock macOS).
            let _window = build_main_window(handle)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            panel::start_panel,
            panel::repair_panel,
            notify::notify,
            workspace::reveal_path,
            workspace::open_terminal,
            set_window_title,
            start_window_drag,
            pick_save_path,
            pick_folder_path,
            toggle_window_maximize,
            minimize_window,
            close_window,
            open_os_settings
        ])
        .build(tauri::generate_context!())
        .expect("falha ao inicializar o Super Note Desktop")
        .run(|app, event| match event {
            tauri::RunEvent::Exit => panel::stop_panel(),
            // macOS: clicar no ícone do dock.
            //
            // Só reabrimos a home quando NÃO há nenhuma janela visível (modo
            // segundo plano / tudo escondido). Havendo janela aberta, o próprio
            // macOS já traz as janelas do app para a frente preservando a ordem
            // — forçar foco na "main" aqui roubava o topo da janela que o
            // usuário estava usando (ex.: o chat) e pulava de volta para a home.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                if !has_visible_windows {
                    show_main_window(app);
                }
            }
            _ => {
                let _ = app;
            }
        });
}
