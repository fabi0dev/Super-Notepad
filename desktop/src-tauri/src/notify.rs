//! Notificações nativas pedidas pelo painel.
//!
//! O painel roda numa origem REMOTA (`http://127.0.0.1:<porta>`), e o Tauri
//! recusa IPC de origem remota a menos que ela esteja declarada numa
//! capability. Como a porta é configurável, a capability não pode ser um
//! arquivo estático — ela é montada em tempo de execução com a porta real
//! (ver [`register_panel_origin`]).
//!
//! Em vez de expor o plugin de notificação inteiro para a página remota,
//! expomos UM comando nosso. A superfície fica menor e o formato da
//! notificação (título, corpo, agrupamento) fica decidido aqui, não no
//! JavaScript que veio pela rede.

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

/// Pedido vindo do painel. `tag` identifica a origem lógica do aviso (uma
/// sessão de chat, por exemplo).
///
/// - **macOS** (caminho `mac_un`): o `tag` vira o `identifier` do
///   UNUserNotificationCenter — dois avisos com o mesmo identifier fazem o SO
///   SUBSTITUIR o primeiro pelo segundo (e o `threadIdentifier` os agrupa). É
///   assim que turnos da mesma conversa deixam de empilhar.
/// - **plugin (fallback / outros SOs)**: o `show` de desktop do
///   `tauri-plugin-notification` só repassa título/corpo/ícone/som ao
///   `notify_rust` — `id`/`group` são ignorados fora do mobile —, então lá o
///   `tag` apenas agrupa (quando muito) e NÃO substitui.
#[derive(Debug, Deserialize)]
pub struct NotifyRequest {
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub tag: Option<String>,
    /// Ignora o bloqueio por foco. Só para o "testar notificação" da landing de
    /// permissões: ali o ponto é justamente ver a notificação aparecer (e
    /// disparar o pedido de permissão do SO) mesmo com a janela à frente.
    #[serde(default)]
    pub force: bool,
}

#[tauri::command]
pub fn notify(app: AppHandle, request: NotifyRequest) -> Result<(), String> {
    // Quem sabe se a janela está em uso é o app, não a página.
    //
    // Esta decisão morava no JavaScript, via `document.hasFocus()`. Numa
    // WKWebView esse valor não acompanha de forma confiável o foco da janela
    // nativa: com o app em segundo plano ele reportou a janela em uso e
    // engoliu a notificação — exatamente o caso que ela serve. Aqui a
    // resposta vem do sistema de janelas.
    if !request.force && is_window_in_use(&app) {
        debug_log("janela em foco: notificação suprimida");
        return Ok(());
    }

    let title = trim_for_display(&request.title, 120);
    let body = trim_for_display(&request.body, 400);
    let tag = request
        .tag
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty());

    // macOS: entrega pelo UNUserNotificationCenter reusando o `tag` como
    // identifier — a próxima notificação da MESMA conversa SUBSTITUI a anterior
    // em vez de empilhar. É o que o plugin não faz no desktop (ver `NotifyRequest`).
    // `catch_unwind` porque `currentNotificationCenter` entra em pânico se o app
    // não estiver empacotado (ex.: rodando fora do `.app`); nesse caso caímos no
    // plugin, que nunca deixa o chat quebrar por causa de um aviso.
    #[cfg(target_os = "macos")]
    {
        let (t, b, g) = (title.clone(), body.clone(), tag.map(str::to_owned));
        let delivered = std::panic::catch_unwind(move || {
            mac_un::deliver(&t, &b, g.as_deref())
        })
        .unwrap_or(false);
        if delivered {
            debug_log(&format!("notificação (UN) enviada: {title} — {body}"));
            return Ok(());
        }
        debug_log("UNUserNotificationCenter indisponível; caindo no plugin");
    }

    show_via_plugin(&app, &title, &body, tag)
}

/// Caminho do plugin: usado fora do macOS e como rede de segurança quando o
/// UNUserNotificationCenter não está disponível. `group` só agrupa (ver a nota
/// em `NotifyRequest`) — não substitui.
fn show_via_plugin(
    app: &AppHandle,
    title: &str,
    body: &str,
    tag: Option<&str>,
) -> Result<(), String> {
    let mut builder = app.notification().builder().title(title).body(body);
    if let Some(t) = tag {
        builder = builder.group(t);
    }
    match builder.show() {
        Ok(()) => {
            debug_log(&format!("notificação enviada: {title} — {body}"));
            Ok(())
        }
        Err(e) => {
            let message = format!("notificação recusada pelo sistema: {e}");
            eprintln!("[sn-desktop] {message}");
            Err(message)
        }
    }
}

/// Entrega nativa no macOS via UNUserNotificationCenter.
///
/// O ponto de existir é o `identifier`: quando duas notificações chegam com o
/// MESMO identifier, o SO troca a primeira pela segunda em vez de empilhar. O
/// painel manda `tag: sessao:<id>` (uma origem lógica por conversa), então cada
/// turno concluído da mesma conversa substitui o aviso anterior — resolvendo o
/// empilhamento que o plugin não trata no desktop.
#[cfg(target_os = "macos")]
mod mac_un {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Mutex, Once, OnceLock};
    use std::time::{Duration, Instant};

    use block2::RcBlock;
    use objc2::AnyThread;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNMutableNotificationContent, UNNotificationInterruptionLevel,
        UNNotificationRequest, UNUserNotificationCenter,
    };

    static AUTH_ONCE: Once = Once::new();

    /// Janela em que um novo aviso da MESMA conversa conta como re-substituição
    /// do mesmo turno: atualiza a Central EM SILÊNCIO (interruption level
    /// `Passive`), sem re-alertar. Reusar o identifier faz o SO re-alertar por
    /// padrão — e o pós-turno às vezes dispara dois "concluído" para a mesma
    /// mensagem (~30s de intervalo), o que piscava o banner duas vezes. Um turno
    /// NOVO mais tarde (ler + responder + o agente trabalhar leva bem mais que
    /// isto) cai fora da janela e volta a alertar normalmente.
    const SAME_TURN_WINDOW: Duration = Duration::from_secs(60);

    /// Último instante em que cada identifier foi postado — decide o silêncio.
    fn last_post_times() -> &'static Mutex<HashMap<String, Instant>> {
        static MAP: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
        MAP.get_or_init(|| Mutex::new(HashMap::new()))
    }

    /// Registra o post do identifier e diz se ele já havia sido postado dentro
    /// da janela do mesmo turno (→ deve atualizar em silêncio).
    fn is_same_turn_resubmit(identifier: &str) -> bool {
        let now = Instant::now();
        let mut map = last_post_times()
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let recent = map
            .get(identifier)
            .is_some_and(|prev| now.duration_since(*prev) < SAME_TURN_WINDOW);
        map.insert(identifier.to_owned(), now);
        // Poda: sem isto o mapa cresce um identifier por conversa para sempre.
        if map.len() > 128 {
            map.retain(|_, t| now.duration_since(*t) < SAME_TURN_WINDOW);
        }
        recent
    }

    /// Pede autorização UMA vez (idempotente). A permissão é do app inteiro
    /// (bundle) e já está concedida para quem vinha recebendo avisos; numa
    /// instalação nova, o prompt aparece no primeiro `notify` — que é o botão
    /// "testar notificação" da landing de permissões, disparado pelo usuário.
    fn ensure_authorization(center: &UNUserNotificationCenter) {
        AUTH_ONCE.call_once(|| {
            let handler = RcBlock::new(|_granted: Bool, _err: *mut NSError| {});
            center.requestAuthorizationWithOptions_completionHandler(
                UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
                &handler,
            );
        });
    }

    /// `true` se a notificação foi entregue ao Center. Pode entrar em pânico se
    /// o app não estiver empacotado — o chamador embrulha em `catch_unwind`.
    pub fn deliver(title: &str, body: &str, tag: Option<&str>) -> bool {
        let center = UNUserNotificationCenter::currentNotificationCenter();
        ensure_authorization(&center);

        let content =
            UNMutableNotificationContent::init(UNMutableNotificationContent::alloc());
        content.setTitle(&NSString::from_str(title));
        content.setBody(&NSString::from_str(body));

        // Sem `tag`, um id único por entrega: nunca substituir algo de outra
        // origem (e nunca "silenciar" — é sempre a primeira). Com `tag`, ele É o
        // identifier (substitui) e também agrupa.
        let identifier = match tag {
            Some(t) => {
                content.setThreadIdentifier(&NSString::from_str(t));
                // Re-substituição do mesmo turno → atualiza a Central sem
                // re-alertar (banner/som). A primeira do turno segue no nível
                // padrão (alerta).
                if is_same_turn_resubmit(t) {
                    content.setInterruptionLevel(UNNotificationInterruptionLevel::Passive);
                }
                t.to_owned()
            }
            None => format!("sn-{}", next_nonce()),
        };

        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str(&identifier),
            &content,
            None, // trigger nil = entregar agora
        );
        center.addNotificationRequest_withCompletionHandler(&request, None);
        true
    }

    /// Id único para avisos sem tag — evita colidir e substituir outro aviso.
    fn next_nonce() -> u64 {
        static N: AtomicU64 = AtomicU64::new(0);
        let c = N.fetch_add(1, Ordering::Relaxed);
        let t = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);
        t ^ c.wrapping_mul(0x9E37_79B9_7F4A_7C15)
    }
}

/// True quando o usuário está com a janela à frente — notificar aí só
/// interromperia alguém que já está vendo a resposta chegar.
fn is_window_in_use(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false)
}

/// Rastro de diagnóstico. Fica atrás de `SUPER_NOTEPAD_DESKTOP_DEBUG` porque o
/// caminho feliz não deve poluir a saída, mas quando uma notificação «não
/// aparece» a primeira pergunta é se ela chegou até aqui — sem isto não há
/// como distinguir IPC bloqueado de permissão negada pelo sistema.
pub fn debug_log(message: &str) {
    if std::env::var("SUPER_NOTEPAD_DESKTOP_DEBUG").is_ok_and(|v| !v.trim().is_empty() && v != "0") {
        eprintln!("[sn-desktop] {message}");
    }
}

/// Autoriza a origem do painel a usar o IPC.
///
/// Sem isto o `invoke` da página remota é descartado silenciosamente — a
/// notificação simplesmente nunca sai, sem erro visível em lugar nenhum.
pub fn register_panel_origin(app: &AppHandle, port: u16) -> Result<(), String> {
    let capability = serde_json::json!({
        "identifier": "painel-remoto",
        "description": "Permite ao painel servido em localhost pedir notificações nativas.",
        "windows": ["main", "panel-*"],
        "remote": {
            "urls": [
                format!("http://127.0.0.1:{port}/*"),
                format!("http://localhost:{port}/*"),
            ]
        },
        "permissions": [
            "core:default",
            "allow-notify",
            "allow-reveal-path",
            "allow-open-terminal",
            // Controles da barra de título integrada (arraste, min/max/fechar,
            // título). Sem estes, o `invoke` da página remota é recusado pelo
            // ACL em silêncio — foi o que deixou o arraste sem efeito.
            "allow-set-window-title",
            "allow-start-window-drag",
            // Diálogo "salvar como" do export do Backup.
            "allow-pick-save-path",
            // Seletor nativo de pasta ("Abrir pasta" do chat).
            "allow-pick-folder-path",
            "allow-toggle-window-maximize",
            "allow-minimize-window",
            "allow-close-window",
            // Segundo plano ao fechar + atalhos de permissão do SO (landing).
            "allow-set-keep-background",
            "allow-get-keep-background",
            "allow-open-os-settings",
            // Bolinha vermelha na barra de menus durante a gravação do Eco. Sem
            // esta permissão o invoke da página remota é recusado em silêncio e
            // a bolinha nunca aparece.
            "allow-set-eco-recording"
        ]
    });

    app.add_capability(capability.to_string())
        .map_err(|e| format!("não consegui autorizar a origem do painel: {e}"))
}

/// O centro de notificações trunca sozinho, mas um corpo gigante vindo de uma
/// resposta longa deixa o payload do IPC caro sem nada em troca.
fn trim_for_display(text: &str, limit: usize) -> String {
    let cleaned = text.trim();
    if cleaned.chars().count() <= limit {
        return cleaned.to_string();
    }

    let head: String = cleaned.chars().take(limit.saturating_sub(1)).collect();
    format!("{}…", head.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_short_text_intact() {
        assert_eq!(trim_for_display("  Turno concluído  ", 40), "Turno concluído");
    }

    #[test]
    fn truncates_long_text_with_ellipsis() {
        let long = "a".repeat(50);
        let out = trim_for_display(&long, 10);
        assert_eq!(out.chars().count(), 10);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn counts_characters_not_bytes() {
        // Acento é 2 bytes: cortar por byte partiria o caractere ao meio.
        let out = trim_for_display("ãããããããããã", 5);
        assert_eq!(out.chars().count(), 5);
    }
}
