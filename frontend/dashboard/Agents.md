# Web dashboard — guia para assistentes

Convenções de estrutura de arquivos em `frontend/dashboard/src/` (alias `@/` no Vite).

## Páginas (`pages/`)

Cada rota vive em **pasta + `index.tsx`**, não em `NomePage.tsx` solto na raiz de `pages/`.

```
pages/
  ChatPage/
    index.tsx              # componente da rota (export default)
    components/            # UI só desta página — cada bloco é pasta + index
      types.ts             # tipos compartilhados (exceção; pode virar types/ depois)
      ChatColumn/index.tsx
      ChatComposer/index.tsx
      ChatEmptyState/index.tsx
      ChatLoadingState/index.tsx
      ChatMessageList/index.tsx
      ChatMessageTurn/index.tsx
      ChatToolCallCard/index.tsx
```

- **Import da rota:** `import ChatPage from "@/pages/ChatPage"` resolve para `ChatPage/index.tsx`.
- **Import entre colegas na mesma página:** `import { ChatColumn } from "./components/ChatColumn"` resolve para `ChatColumn/index.tsx`.
- **Dentro de `components/Nome/index.tsx`:** importe irmãos com `../OutroNome` e tipos com `../types` (não use `./types` — o `index` está um nível abaixo da pasta `components/`).

## Componentes colocados em `PageName/components/`

Use o **mesmo padrão de pasta + `index.tsx`** que nas páginas:

- Preferido: `components/MeuBloco/index.tsx` com `export function MeuBloco` (ou `export default` se fizer sentido único).
- Evite: `components/MeuBloco.tsx` na raiz de `components/` para blocos que ganham testes, hooks ou sub-arquivos depois — a pasta já reserva o namespace.

Arquivos transversais da página (tipos compartilhados só pelo chat) podem permanecer como `components/types.ts` até precisarem de subpasta.

## Evite monólitos — extraia cedo

O `index.tsx` de uma página é **composição**: estado de alto nível + o layout que monta os blocos. Ele não é o depósito de toda a UI e lógica da rota.

- **Orçamento:** mire `index.tsx` **abaixo de ~600 linhas**. Passou de ~800, é sinal de que há blocos para extrair — faça no mesmo PR, não "depois".
- **O que sai do `index.tsx`:**
  - Blocos de UI coesos (uma linha de lista, um card, uma toolbar, um modal, um painel) → `components/<Nome>/index.tsx` com `export function <Nome>`. As closures viram **props com a mesma assinatura** — as chamadas continuam idênticas.
  - Helpers puros, constantes e tipos (formatação de data/tamanho, cor por conta, parsing, chaves de localStorage) → um `<page>Shared.ts` (ou `.tsx` se tiver JSX). Ex.: `mailShared.tsx`, `driveShared.ts`, `agendaShared.tsx`, `homeShared.ts`.
  - Estado/efeito coeso e **isolado** (busca com debounce, redimensionar sidebar, conexão OAuth, drag-and-drop) → `hooks/use<Nome>.ts`.
- **Armadilha de ordem (não ignore):** só extraia para hook o que for **realmente isolado**. Se dois `useEffect` compartilham deps e um seta um estado que o outro limpa (ex.: efeito de *reveal*/deeplink + efeito que zera seleção ao trocar `items`), **NÃO** os mova para um hook chamado no topo — isso reordena o registro dos efeitos e muda o comportamento observável. Na dúvida, mantenha no `index.tsx` na ordem original; chame hooks extraídos **depois** da definição das consts/deps que eles recebem (TDZ).
- **Regra de ouro do refactor:** extrair é mecânico e **zero mudança visual/comportamental**. Preserve os comentários. Verifique com `npx tsc -b` (limpo) e `npx vitest run` antes de considerar pronto.

## Resto do app

- Componentes globais: `src/components/`.
- Hooks compartilhados: `src/hooks/`.
- Lógica de API: `src/lib/api.ts` etc.
