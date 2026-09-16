import { Extension, InputRule } from "@tiptap/core";

// Digitar "- " (ou "* "/"+ ") no INÍCIO de um item de lista vira SUBLISTA:
// aninha o item sob o anterior (sink), como "- " cria uma lista no topo. Sem
// isto o traco ficava literal ("• -"). Vale para bullet (listItem) e checkbox
// (taskItem). So dispara quando ha um item anterior para aninhar; senao deixa
// o "- " seguir o fluxo normal.

function sinkRule(itemType: string): InputRule {
  return new InputRule({
    find: /^([-*+])\s$/,
    handler: ({ state, range, chain }) => {
      const { $from } = state.selection;

      // Profundidade do item de lista que contem o cursor.
      let itemDepth = -1;
      for (let d = $from.depth; d > 0; d -= 1) {
        if ($from.node(d).type.name === itemType) {
          itemDepth = d;
          break;
        }
      }
      if (itemDepth < 0) return null; // nao esta neste tipo de item

      // Precisa de um item ANTERIOR na mesma lista para aninhar sob ele.
      const indexInList = $from.index(itemDepth - 1);
      if (indexInList <= 0) return null;

      // Apaga o "- " digitado e aninha o item (vira sublista).
      chain().deleteRange(range).sinkListItem(itemType).run();
      return;
    },
  });
}

export const SublistShortcut = Extension.create({
  name: "sublistShortcut",
  addInputRules() {
    return [sinkRule("listItem"), sinkRule("taskItem")];
  },
});
