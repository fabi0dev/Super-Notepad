//! Para onde cada navegação deve ir.
//!
//! A janela do app não tem barra de endereço nem botão de voltar. Uma
//! navegação para fora do painel, portanto, é um beco sem saída: o usuário
//! ficaria com um site qualquer ocupando o app e nenhuma forma de voltar
//! senão fechar e reabrir. Por isso tudo que não for o painel sai para o
//! navegador do sistema.
//!
//! Links com `target="_blank"` — que é como o painel renderiza links de
//! markdown — nem chegam a navegar: o WKWebView pede uma janela nova e, sem
//! ninguém para atendê-lo, não faz nada. Era o que deixava todo link das
//! respostas morto dentro do app.

use std::process::{Command, Stdio};

use tauri::Url;

/// Esquemas que podem ser entregues ao SO.
///
/// A lista é fechada de propósito: `file://` abriria arquivos locais e
/// esquemas customizados podem acionar outros apps instalados. O conteúdo
/// vem do painel, que é local — mas o texto dentro dele vem de um modelo e
/// de páginas que ele leu, e isso não é confiável.
const OPENABLE_SCHEMES: [&str; 3] = ["http", "https", "mailto"];

/// True quando a URL é conteúdo do próprio app e deve carregar na janela.
///
/// Só `http(s)` é julgado por host e porta. `tauri://` (a tela de
/// inicialização), `about:` e `data:` são do app por construção.
pub fn is_internal(url: &Url, port: u16) -> bool {
    match url.scheme() {
        "http" | "https" => {
            let host_ok = matches!(url.host_str(), Some("127.0.0.1") | Some("localhost"));
            host_ok && url.port() == Some(port)
        }
        _ => true,
    }
}

/// Entrega a URL ao navegador padrão. Silencioso em caso de falha: não há
/// nada de útil a dizer ao usuário se o SO recusar abrir um link.
pub fn open_in_browser(url: &Url) {
    if !OPENABLE_SCHEMES.contains(&url.scheme()) {
        crate::notify::debug_log(&format!("link ignorado (esquema {}): {url}", url.scheme()));
        return;
    }

    crate::notify::debug_log(&format!("abrindo no navegador: {url}"));

    // Cada plataforma tem seu lançador do "handler padrão". No Windows é o
    // builtin `start` do cmd — e o 1º argumento entre aspas de `start` é o
    // TÍTULO da janela, então passamos um título vazio antes da URL para a URL
    // não ser engolida como título.
    #[cfg(target_os = "windows")]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut c = Command::new("cmd");
        c.args(["/C", "start", "", url.as_str()])
            .creation_flags(CREATE_NO_WINDOW);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(url.as_str());
        c
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(url.as_str());
        c
    };

    let _ = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(raw: &str) -> Url {
        Url::parse(raw).expect("url de teste inválida")
    }

    #[test]
    fn panel_urls_stay_in_the_window() {
        assert!(is_internal(&url("http://127.0.0.1:9000/"), 9000));
        assert!(is_internal(&url("http://127.0.0.1:9000/chat?token=x"), 9000));
        assert!(is_internal(&url("http://localhost:9000/"), 9000));
    }

    #[test]
    fn app_own_schemes_stay_in_the_window() {
        // A tela de inicialização é servida pelo protocolo interno do Tauri.
        assert!(is_internal(&url("tauri://localhost"), 9000));
        assert!(is_internal(&url("about:blank"), 9000));
    }

    #[test]
    fn other_sites_are_external() {
        assert!(!is_internal(&url("https://docs.exemplo.com/guia"), 9000));
        assert!(!is_internal(&url("http://exemplo.com"), 9000));
    }

    #[test]
    fn another_port_on_loopback_is_external() {
        // Outro serviço local não é o painel; carregá-lo na janela seria o
        // mesmo beco sem saída de um site remoto.
        assert!(!is_internal(&url("http://127.0.0.1:8080/"), 9000));
    }

    #[test]
    fn port_follows_the_configured_one() {
        assert!(is_internal(&url("http://127.0.0.1:9310/"), 9310));
        assert!(!is_internal(&url("http://127.0.0.1:9000/"), 9310));
    }

    #[test]
    fn openable_schemes_are_a_closed_list() {
        assert!(OPENABLE_SCHEMES.contains(&"http"));
        assert!(OPENABLE_SCHEMES.contains(&"https"));
        assert!(OPENABLE_SCHEMES.contains(&"mailto"));
        assert!(!OPENABLE_SCHEMES.contains(&"file"));
        assert!(!OPENABLE_SCHEMES.contains(&"javascript"));
    }
}
