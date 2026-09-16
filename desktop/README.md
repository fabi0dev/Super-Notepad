# Super Notepad Desktop

Janela nativa (Tauri v2) para o Super Notepad. **Não** é uma segunda
implementação do frontend: o app sobe o backend Python
(`python -m super_notepad --no-open --port <porta>`), que serve o SPA e as
rotas de notas, e aponta a webview para ele.

Requer o backend deste repo já preparado (`./install.sh` na raiz cria o venv e
compila o frontend).

## O que o app faz

1. Resolve o interpretador Python — `SUPER_NOTEPAD_PYTHON` → o campo `python`
   do `~/.super-notepad/desktop.json` → o venv ao lado do backend
   (`backend/.venv/bin/python`) → `python3` do PATH. Um app aberto pelo Finder
   não herda o PATH do seu `.zshrc`, por isso o caminho gravado no
   `desktop.json` pelo `install.sh` é o que torna a descoberta determinística.
2. Sobe o backend em foreground na porta escolhida e espera a porta abrir
   (o backend grava a URL de acesso em `~/.super-notepad/desktop_url.txt`).
3. Manda a webview para essa URL (que carrega o token de sessão). Daí em diante
   é o app de notas de sempre.
4. Ao fechar a janela, encerra o backend — a menos que `keep_panel` esteja
   ligado.

## Rodar (desenvolvimento)

```bash
cd desktop && pnpm install && pnpm tauri dev
```

Apontando para o backend deste repo com hot-reload:

```bash
cd desktop
SUPER_NOTEPAD_PYTHON=../backend/.venv/bin/python \
SUPER_NOTEPAD_BACKEND_DIR=../backend \
pnpm tauri dev
```

Para gerar o `.app` e o `.dmg`:

```bash
cd desktop && pnpm build
```

O resultado sai em `src-tauri/target/release/bundle/`. O bundle **não é
assinado nem notarizado** — abre normalmente na máquina que o compilou; em
outra máquina o Gatekeeper reclama.

Pré-requisitos: Rust (`rustup`) e Xcode Command Line Tools no macOS.

**macOS 13.3 é o mínimo real** e está declarado no bundle. Não é
conservadorismo: o frontend usa Tailwind v4 (`oklch`, `@property`), que pede
Safari 16.4, e a WKWebView acompanha a versão do sistema.

## Configuração

Config opcional em `~/.super-notepad/desktop.json` (respeita `SUPER_NOTEPAD_HOME`).
Arquivo ausente ou com campos vazios cai na descoberta automática, então o app
abre mesmo sem ele.

```json
{
  "python": "/Users/voce/.../backend/.venv/bin/python",
  "backend_dir": "/Users/voce/.../backend",
  "port": 9010,
  "keep_panel": false
}
```

É um JSON (e não o `desktop.json` ser YAML) porque quem lê é o Rust — evita
carregar um parser de YAML dentro do app.

Variáveis de ambiente vencem o arquivo, para depuração:

| Variável | Efeito |
|----------|--------|
| `SUPER_NOTEPAD_PYTHON` | Caminho do interpretador Python, pulando a descoberta |
| `SUPER_NOTEPAD_BACKEND_DIR` | Diretório que contém o pacote `super_notepad` (a pasta `backend/`) |
| `SUPER_NOTEPAD_HOME` | Home dos dados (padrão `~/.super-notepad`) |
| `SUPER_NOTEPAD_DESKTOP_PORT` | Porta do backend (padrão `9010`) |
| `SUPER_NOTEPAD_DESKTOP_DEBUG` | `1` registra as etapas de arranque e cada notificação enviada |

## Ícones

`src-tauri/icons/` foi gerado a partir de
`frontend/dashboard/public/favicon.png` (500×500). Para regerar a partir de
uma arte melhor — o ideal é uma fonte 1024×1024:

```bash
cd desktop && pnpm icons
```

## Detalhes que valem saber

- **Abrir o app reinicia o backend** na porta configurada, para carregar código
  novo.
- **A primeira execução é lenta** se `backend/super_notepad/web_dist` estiver
  ausente ou defasado — gere o bundle com `pnpm build` no frontend antes. A tela
  de inicialização mostra só um spinner; limites de tempo impedem uma espera
  infinita (a porta tem 1 min para abrir). Estourando, o app mostra o erro em
  vez de girar para sempre.
- **A janela não tem barra de navegação**, e por isso tudo que não for o app
  sai para o navegador do sistema (`links.rs`). Só `http`, `https` e `mailto`
  são entregues ao SO.
- **Comando novo exige duas coisas, não uma.** A webview é uma origem REMOTA,
  então um `invoke` só passa se (1) o comando estiver declarado em `build.rs`
  (o que gera a permissão `allow-<comando>`) e (2) a capability da origem
  conceder essa permissão. Faltando qualquer uma, o Tauri responde
  «Command X not allowed by ACL» **só para o JavaScript**. A capability é
  montada em tempo de execução (`register_panel_origin`) porque a porta é
  configurável.
- **Quem decide o foco é o Rust, não a página.** `document.hasFocus()` não
  acompanha de forma confiável o foco da janela nativa numa WKWebView. O comando
  `notify` pergunta ao sistema de janelas (`is_focused()`) e suprime lá.
- **`SUPER_NOTEPAD_DESKTOP_DEBUG=1`** é o primeiro lugar a olhar quando uma
  notificação «não aparece»: ele distingue IPC bloqueado de recusa do sistema.
- **O host da URL é reescrito para `127.0.0.1`.** Numa WKWebView um domínio
  `http://` puro cai no App Transport Security, que recusa a navegação **sem
  emitir erro**, deixando a janela parada na inicialização. O bundle declara
  `exceptionDomain` para o loopback.
