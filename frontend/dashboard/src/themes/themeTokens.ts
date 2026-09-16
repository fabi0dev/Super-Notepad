/**
 * Canonical Super Note palette for the web dashboard.
 */

/**
 * Verde-jade da marca (o corvo) — 6.7:1 sobre o canvas quase preto.
 *
 * O hex vem direto do logo, não de uma escolha de paleta. Isso tem um custo
 * conhecido: o acento agora divide família de matiz com `success`
 * ({@link APP_SUCCESS_DARK}, `#10B981` — 7° de distância em HSL). Num chip
 * pequeno, «primary» e «sucesso» ficam praticamente iguais, que é exatamente
 * o problema que a paleta violeta anterior existia para evitar.
 *
 * Onde os dois puderem aparecer lado a lado, separe por forma ou posição —
 * não confie no matiz. Se a ambiguidade incomodar, o caminho é deslocar
 * `success` para um verde mais folha (~130°), não mexer na marca.
 */
export const APP_ACCENT = "#FF8A3D" as const;
/**
 * Primary sobre fundo claro. NÃO é o mesmo hex do escuro: `#FF8A3D` no branco
 * dá 2.8:1 e não passa nem como texto nem sob texto branco.
 *
 * Este é o verde mais CLARO que ainda passa (4.8:1), e não o mais contrastado
 * possível. A versão anterior mirava 7.2:1 — o contraste do violeta escuro
 * que existia antes — e o resultado era um verde quase preto, que não se
 * reconhecia como o jade da marca. Contraste é piso, não meta.
 */
export const APP_ACCENT_LIGHT = "#BF5710" as const;

/**
 * Verde de PREENCHIMENTO sólido (nav ativo, botão `bg-primary`) — o verde
 * escuro, com branco por cima (7.2:1).
 *
 * Precisa ser um token separado de {@link APP_ACCENT} porque os dois têm
 * exigências OPOSTAS de contraste: como texto sobre o canvas quase preto o
 * verde tem que ser claro (`#C05E15` ali dá 2.6:1 e some); como fundo de
 * texto branco tem que ser escuro. Nenhum verde único satisfaz as duas — daí
 * `text-primary` usar o acento e `bg-primary` sólido usar este.
 * No tema claro a tensão não existe e os dois são o mesmo hex.
 */
export const APP_ACCENT_FILL_DARK = "#C05E15" as const;
export const APP_ACCENT_FILL_LIGHT = "#BF5710" as const;
export const APP_ACCENT_FG_DARK = "#FFFFFF" as const;
export const APP_ACCENT_FG_LIGHT = "#FFFFFF" as const;
export const APP_ACCENT_GLOW_DARK = "rgba(255, 138, 61, 0.25)" as const;
export const APP_ACCENT_GLOW_LIGHT = "rgba(198, 42, 49, 0.14)" as const;
export const APP_SECONDARY_ACCENT = "#F47178" as const;
export const APP_SECONDARY_ACCENT_LIGHT = "#A81F27" as const;
export const APP_WARM_GLOW_DARK = "rgba(255, 138, 61, 0.07)" as const;
export const APP_WARM_GLOW_LIGHT = "rgba(198, 42, 49, 0.08)" as const;
export const APP_SELECTION_BG = "rgba(255, 138, 61, 0.16)" as const;
export const APP_SELECTION_BG_LIGHT = "rgba(198, 42, 49, 0.12)" as const;

/**
 * Cor de AÇÃO afirmativa (adicionar, salvar, conectar, entrar na conferência).
 *
 * A marca é vermelha, mas vermelho num botão de CTA lê como destrutivo
 * ("apagar"). O verde-esmeralda diz "positivo / ir". `#047857` dá 5:1 com
 * branco por cima e, por ser um verde escuro, funciona igual sobre canvas
 * claro e escuro — por isso é ÚNICO (não varia por tema), ao contrário do
 * acento da marca. Destrutivo continua em {@link APP_DESTRUCTIVE}/vermelho;
 * marca/seleção/hoje continuam no acento. Espelhado em `--action` no index.css.
 */
export const APP_ACTION = "#047857" as const;
export const APP_ACTION_HOVER = "#0A8A63" as const;
export const APP_ACTION_FG = "#FFFFFF" as const;

/** Subtle primary tint for icon badges and chips (not full `bg-primary`). */
export const APP_PRIMARY_MUTED_BG = "rgba(255, 138, 61, 0.10)" as const;
// OPACO no tema claro: com "Fundo transparente" ligado, um tint translúcido
// deixa o papel de parede (escuro) vazar por baixo do botão e o texto
// `text-primary` (#BF5710) some. A versão opaca (~ o mesmo composto sobre o
// branco) mantém a aparência e garante contraste independente da janela.
export const APP_PRIMARY_MUTED_BG_LIGHT = "#FBE9D6" as const;

/** Dashboard sidebar — item ativo: verde escuro sólido (texto branco via `text-primary-foreground`). */
export const APP_SIDEBAR_ACTIVE_BG = APP_ACCENT_FILL_DARK;
export const APP_SIDEBAR_HOVER_BG = "rgba(255, 138, 61, 0.12)" as const;
export const APP_SIDEBAR_BORDER_DARK = "rgba(255, 255, 255, 0.07)" as const;
export const APP_SIDEBAR_BORDER_LIGHT = "#E5E7EB" as const;
/** Section labels (uppercase) — quieter than body chrome. */
export const APP_SIDEBAR_LABEL_DARK = "#77777F" as const;
export const APP_SIDEBAR_LABEL_LIGHT = "#475569" as const;
/** Inactive nav / secondary chrome text. */
export const APP_SIDEBAR_FG_MUTED_DARK = "#A3A3AC" as const;
export const APP_SIDEBAR_FG_MUTED_LIGHT = "#334155" as const;
/** Nav icons — slightly brighter than muted text for scanability. */
export const APP_SIDEBAR_ICON_FG_DARK = "#ADADB2" as const;
export const APP_SIDEBAR_HOVER_BG_LIGHT = "rgba(198, 42, 49, 0.07)" as const;

/**
 * Dark surface ladder — cinza NEUTRO, cada degrau ACIMA do canvas.
 *
 * A escala anterior descia para o preto: canvas `#040405` com os wells de
 * código em `#000000`. Dois problemas somados:
 *
 * 1. Contraste de 17,5:1 no corpo do texto. Em fundo escuro a pupila dilata
 *    e o traço claro fino borra (halação) — acima de ~15:1 não se lê melhor,
 *    só cansa mais. O tema light tem a mesma razão e é confortável porque lá
 *    o brilho está no fundo, não nas letras.
 * 2. Well de código a 1,02:1 do canvas. O painel não existia como painel, e
 *    a hierarquia acabava dependendo de sombra — que em fundo escuro quase
 *    não separa, e é justamente o que o usuário rejeita.
 *
 * Agora o canvas sobe para um cinza escuro real e cada superfície é um
 * degrau ACIMA dele. A separação vem da luminosidade, não de sombra.
 *
 * canvas `#131316` → composer/painéis `#1A1A1F` → wells `#1C1C22`
 * → cards `#212128` → hover `#282830` → borda `#2C2C34`
 */
export const APP_WEB_BG = "#131316" as const;
export const APP_WEB_FG = "#DEDEE2" as const;
export const APP_WEB_MUTED = "#A3A3AC" as const;
export const APP_WEB_BORDER = "#2C2C34" as const;
export const APP_WEB_BORDER_STRONG = "#3A3A44" as const;
export const APP_WEB_SURFACE = "#1A1A1F" as const;
export const APP_WEB_CARD = "#212128" as const;
/** Composer / bolha do usuário — um degrau acima do canvas. */
export const APP_WEB_COMPOSER_BG = "#1A1A1F" as const;
/** Wells de código — ACIMA do canvas, não abaixo. Era `#000` a 1,02:1. */
export const APP_WEB_CODE_BG = "#1C1C22" as const;
/** Chat action cards. */
export const APP_WEB_ACTION_CARD_BG = "#1E1E24" as const;
export const APP_WEB_SURFACE_HOVER = "#282830" as const;

export const APP_WEB_FOOTER_MUTED_DARK = "#A3A3AC" as const;
export const APP_WEB_FOOTER_MUTED_LIGHT = "#57534E" as const;

export const APP_WEB_FG_LIGHT = "#1A1A1A" as const;
export const APP_WEB_MUTED_LIGHT = "#3F3F46" as const;
export const APP_WEB_BORDER_LIGHT = "#D1D5DB" as const;
/** Hairline borders on light panels (tool cards, chips). */
export const APP_WEB_BORDER_SUBTLE_LIGHT = "#E5E9EF" as const;
export const APP_WEB_CARD_LIGHT = "#FFFFFF" as const;
/** Panels/cards on light canvas — stronger separation than canvas bg. */
export const APP_WEB_SURFACE_LIGHT = "#F6F8FA" as const;
/** Config modal nav — softer than {@link APP_WEB_SURFACE_LIGHT}. */
export const APP_CONFIG_NAV_BG_LIGHT = "#F6F8FA" as const;
/** Form controls on light panels — white fill on card/modal. */
export const APP_FIELD_BG_LIGHT = "#FFFFFF" as const;
/** Gateway/channel status pills on light UI (ex. «Parado»). */
export const APP_STATUS_PILL_BG_LIGHT = "#F3F4F6" as const;
export const APP_STATUS_PILL_FG_LIGHT = "#4B5563" as const;
// Um degrau ABAIXO do canvas cinza (#EDF0F4) para o hover não sumir nele —
// e visível sobre os cards brancos. Era #EEF1F5 (quase o canvas).
export const APP_WEB_SURFACE_HOVER_LIGHT = "#E4E9EF" as const;
export const APP_WEB_CODE_BG_LIGHT = "#F0F3F6" as const;
export const APP_SUCCESS_LIGHT = "#24915b" as const;
export const APP_SUCCESS_BORDER_LIGHT = "rgba(4, 120, 87, 0.18)" as const;
export const APP_SUCCESS_DARK = "#10B981" as const;

/**
 * Tone-on-tone chips (light theme) — soft desaturated bg + dark fg.
 * Success bg is the reference chroma/lightness for the other variants.
 */
export const APP_CHIP_PRIMARY_BG_LIGHT = "#D4EDE5" as const;
export const APP_CHIP_PRIMARY_FG_LIGHT = "#0B5E4B" as const;
export const APP_CHIP_SUCCESS_BG_LIGHT = "#D1E7D9" as const;
export const APP_CHIP_SUCCESS_FG_LIGHT = "#24915b" as const;
export const APP_CHIP_DESTRUCTIVE_BG_LIGHT = "#E7D1D5" as const;
export const APP_CHIP_DESTRUCTIVE_FG_LIGHT = "#8B2E35" as const;
export const APP_CHIP_WARNING_BG_LIGHT = "#E7E2D1" as const;
export const APP_CHIP_WARNING_FG_LIGHT = "#7A5C18" as const;

/** Shadcn `secondary` / `accent` surfaces. */
export const APP_THEME_SECONDARY_SURFACE_DARK = APP_WEB_SURFACE;
export const APP_THEME_ACCENT_SURFACE_DARK = APP_WEB_SURFACE_HOVER;
export const APP_THEME_SECONDARY_SURFACE_LIGHT = "#EAF6F1" as const;
export const APP_THEME_ACCENT_SURFACE_LIGHT = "#EAF6F1" as const;
