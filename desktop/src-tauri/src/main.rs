// Evita abrir um console extra no Windows em release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod links;
mod notify;
mod panel;
mod workspace;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri::{AppHandle, Manager, WebviewUrl};

/// "Manter em segundo plano ao fechar" ligado? Espelha o arquivo de preferência
/// e é lido pelo handler de fechamento da janela. Começa no valor persistido, no
/// `.setup()`.
static KEEP_BACKGROUND: AtomicBool = AtomicBool::new(false);

/// Ícone extra na bandeja (bolinha vermelha) enquanto o Eco está gravando —
/// clique para parar, sem abrir o menu do Super Notepad.
static ECO_RECORD_TRAY: Mutex<Option<TrayIcon>> = Mutex::new(None);

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

/// Preferência "Manter o Super Notepad rodando em segundo plano ao fechar a janela".
///
/// Guardada em `<super_notepad_home>/desktop_keep_background` ("1"/"0", padrão desligada
/// — sem ela, fechar a janela encerra o app como sempre). Quando ligada, fechar
/// a janela apenas a esconde: o servidor embutido e o agendador de tarefas
/// seguem vivos, e o ícone na bandeja traz a janela de volta ou encerra de vez.
fn keep_background_path() -> std::path::PathBuf {
    panel::super_notepad_home().join("desktop_keep_background")
}

fn read_keep_background_pref() -> bool {
    std::fs::read_to_string(keep_background_path())
        .map(|s| s.trim() == "1")
        .unwrap_or(false)
}

/// Liga/desliga o "manter em segundo plano". Vale JÁ (memória) e no próximo
/// arranque (arquivo). Chamado pela landing de permissões do painel.
#[tauri::command]
fn set_keep_background(enabled: bool) {
    KEEP_BACKGROUND.store(enabled, Ordering::Relaxed);
    let _ = std::fs::write(keep_background_path(), if enabled { "1" } else { "0" });
}

/// Estado atual do "manter em segundo plano" — a landing reflete o toggle.
#[tauri::command]
fn get_keep_background() -> bool {
    KEEP_BACKGROUND.load(Ordering::Relaxed)
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
/// plano"), recria — senão o "Abrir Super Notepad" não tinha o que mostrar e só sobrava
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
    // é a key window — o "Abrir Super Notepad" acabava só focando a janela que já
    // estava aberta em vez de mostrar a home. O toggle de always-on-top força
    // o raise acima das irmãs sem deixá-la fixada no topo.
    #[cfg(target_os = "macos")]
    {
        let _ = window.set_always_on_top(true);
        let _ = window.set_always_on_top(false);
    }
    let _ = window.set_focus();
}

/// Mostra a janela e navega o painel para uma rota via React Router (evento
/// `supernotepad:navigate` no front — pushState+popstate sintético não atualiza a SPA).
fn navigate_main(app: &tauri::AppHandle, path: &str) {
    show_main_window(app);
    if let Some(window) = app.get_webview_window("main") {
        let path_json = serde_json::to_string(path).unwrap_or_else(|_| "\"/\"".to_string());
        let script = format!(
            "window.dispatchEvent(new CustomEvent('supernotepad:navigate',{{detail:{{path:{path_json}}}}}));"
        );
        let _ = window.eval(&script);
    }
}

/// Abre (ou foca) a janela ENXUTA (`panel=1`) de um app do painel — a MESMA
/// janela própria que o launcher abre (`open_internal_window` → `panel-<slug>`),
/// e NÃO a navegação da janela principal. Navegar a principal para uma rota de
/// app (o antigo `navigate_main`) só focava a janela atual e ainda levava a
/// sidebar do Super Notepad para dentro do app (bug documentado em `openAppWindow.ts`).
/// `extra` é query opcional (ex.: `new=1`).
fn open_panel_window(app: &AppHandle, path: &str, extra: &str) {
    let port = panel::port();
    let mut qs = String::from("panel=1");
    if !extra.is_empty() {
        qs.push('&');
        qs.push_str(extra.trim_start_matches('&'));
    }
    let url_str = format!("http://127.0.0.1:{port}{path}?{qs}");
    match url_str.parse::<tauri::Url>() {
        Ok(url) => open_internal_window(app.clone(), port, url),
        Err(err) => notify::debug_log(&format!("URL de painel inválida ({path}): {err}")),
    }
}

/// Abre (ou foca) a janela do Eco com `panel=1`. `extra_query` é opcional
/// (ex.: `stop=1`) — **nunca** `record=1` ao só abrir: gravar é gesto explícito
/// no botão vermelho.
fn open_eco_window(app: &AppHandle, extra_query: &str) {
    open_panel_window(app, "/eco", extra_query);
}

/// Clique no ícone vermelho da bandeja: abre o Eco com ?stop=1 (o front finaliza).
fn request_eco_stop(app: &AppHandle) {
    open_eco_window(app, "stop=1");
}

/// Mostra/esconde o ícone vermelho ao lado do Super Notepad na barra de menus.
#[tauri::command]
fn set_eco_recording(app: AppHandle, active: bool) -> Result<(), String> {
    let mut slot = ECO_RECORD_TRAY
        .lock()
        .map_err(|_| "eco tray lock".to_string())?;
    if active {
        if slot.is_some() {
            return Ok(());
        }
        let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-record.png"))
            .map_err(|e| e.to_string())?;
        let tray = TrayIconBuilder::new()
            .icon(icon)
            .tooltip("Parar gravação Eco")
            // Cor sólida — não template (senão o macOS tingiria de cinza).
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    request_eco_stop(tray.app_handle());
                }
            })
            .build(&app)
            .map_err(|e| e.to_string())?;
        *slot = Some(tray);
    } else if let Some(tray) = slot.take() {
        let _ = tray.set_visible(false);
    }
    Ok(())
}

/// Monta o ícone da bandeja (silhueta branca template) e o menu, com clique
/// esquerdo trazendo a janela de volta.
///
/// É o que torna o "segundo plano" utilizável: com a janela escondida, a bandeja
/// traz o app de volta, leva às áreas principais ou encerra de vez (o `app.exit`
/// passa por cima do handler de fechar, então sai mesmo com o modo ligado).
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Abrir Super Notepad", true, None::<&str>)?;
    let new_chat = MenuItem::with_id(app, "new-chat", "Novo chat", true, None::<&str>)?;
    let new_note =
        MenuItem::with_id(app, "new-note", "Nova nota", true, None::<&str>)?;
    // Só abre o Eco — gravar é o botão vermelho (não auto-inicia).
    let eco = MenuItem::with_id(app, "eco", "Eco", true, None::<&str>)?;
    let mail = MenuItem::with_id(app, "mail", "E-mails", true, None::<&str>)?;
    let tasks = MenuItem::with_id(app, "tasks", "Tarefas", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &show, &sep1, &new_chat, &new_note, &eco, &sep2, &mail, &tasks, &sep3,
            &quit,
        ],
    )?;

    // Silhueta branca, marcada como template no macOS: a barra de menus tinge
    // conforme o tema (claro/escuro), como os ícones nativos.
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    let builder = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Super Notepad")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            // Apps abrem na SUA janela própria (panel), não navegando a principal.
            "new-note" => open_panel_window(app, "/notas", "new=1"),
            "eco" => open_eco_window(app, ""),
            "mail" => open_panel_window(app, "/mail", ""),
            "tasks" => open_panel_window(app, "/tarefas", ""),
            // "Abrir Super Notepad" e "Novo chat" são a própria janela principal do Super Notepad.
            "show" => navigate_main(app, "/home"),
            "new-chat" => navigate_main(app, "/chat"),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    // macOS: template faz a barra de menus tingir o ícone conforme o tema.
    #[cfg(target_os = "macos")]
    let builder = builder.icon_as_template(true);
    builder.build(app)?;
    Ok(())
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
/// Toda janela nasce como "Super Notepad"; o front resolve o título por rota (ex.:
/// "E-mail — Super Notepad") e chama isto para a barra de título nativa acompanhar.
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
        .add_filter("Backup do Super Notepad", &["zip"])
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
/// com "Super Notepad — <App>" em vez do genérico "Super Notepad". O front ainda refina depois
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
        _ => return "Super Notepad".to_string(),
    };
    format!("Super Notepad — {name}")
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
/// a janela é destruída — e o "Abrir Super Notepad" precisa reconstruí-la, senão só
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
        .title("Super Notepad")
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

    // Fechar com "manter em segundo plano" ligado apenas ESCONDE (servidor e
    // agendador seguem vivos). Desligado, fecha e destrói como sempre.
    let close_win = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            if KEEP_BACKGROUND.load(Ordering::Relaxed) {
                api.prevent_close();
                let _ = close_win.hide();
            }
        }
    });

    Ok(window)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle();
            let port = panel::port();

            // A capability da origem remota precisa existir ANTES de a webview
            // navegar para o painel, senão o primeiro `invoke` já cai.
            match notify::register_panel_origin(handle, port) {
                Ok(()) => notify::debug_log("origem do painel autorizada no IPC"),
                Err(err) => eprintln!("[sn-desktop] {err}"),
            }

            // Segundo plano: estado inicial vindo do arquivo de preferência —
            // definido ANTES de criar a janela (o handler de fechamento o lê).
            KEEP_BACKGROUND.store(read_keep_background_pref(), Ordering::Relaxed);

            // A janela principal é construída em código (não pelo tauri.conf.json)
            // porque os desvios de navegação só existem no builder. Extraída para
            // `build_main_window` para poder ser RECRIADA pelo "Abrir Super Notepad".
            let _window = build_main_window(handle)?;

            if let Err(err) = setup_tray(app) {
                eprintln!("[sn-desktop] falha ao montar a bandeja: {err}");
            }

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
            set_keep_background,
            get_keep_background,
            open_os_settings,
            set_eco_recording
        ])
        .build(tauri::generate_context!())
        .expect("falha ao inicializar o Super Notepad Desktop")
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
