import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const key = new PluginKey("charReveal");

/**
 * Revela suavemente o caractere recém-digitado (fade + leve deslize da
 * esquerda) — dá a sensação do texto surgindo enquanto se escreve.
 *
 * Segurança: é SÓ decoração — não toca no documento nem no cursor. No pior caso
 * é um efeito visual estranho, jamais some texto ou caret (o problema do caret
 * customizado anterior). Mantém no máximo UMA marca por vez: ao digitar o
 * próximo caractere, o anterior vira texto normal. Assim o texto já assentado
 * nunca re-anima e não há acúmulo de decorações numa nota longa.
 */
export const CharReveal = Extension.create({
  name: "charReveal",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            if (tr.getMeta(key) === "clear") return DecorationSet.empty;
            // Sem mudança no doc (seta, clique, seleção): mantém a marca atual
            // remapeada — ela só é substituída pelo próximo caractere digitado.
            if (!tr.docChanged) return old.map(tr.mapping, tr.doc);

            // Faixa REALMENTE inserida por esta transação, mapeada até o doc
            // final (percorre os steps somando o novo intervalo de cada um).
            let from: number | null = null;
            let to: number | null = null;
            const maps = tr.mapping.maps;
            maps.forEach((map, idx) => {
              map.forEach((_os, _oe, ns, ne) => {
                let f = ns;
                let t = ne;
                for (let j = idx + 1; j < maps.length; j++) {
                  f = maps[j].map(f, -1);
                  t = maps[j].map(t, 1);
                }
                if (from === null || f < from) from = f;
                if (to === null || t > to) to = t;
              });
            });

            // Só remoção (backspace), ou bloco grande (colar / aceitar
            // autocomplete): sem efeito de digitação — assenta tudo.
            if (from === null || to === null || to <= from || to - from > 24) {
              return DecorationSet.empty;
            }
            return DecorationSet.create(tr.doc, [
              Decoration.inline(from, to, { class: "note-char-in" }),
            ]);
          },
        },
        props: {
          decorations(state) {
            return key.getState(state);
          },
        },
      }),
    ];
  },
});
