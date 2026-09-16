type DiffTag = " " | "+" | "-";

interface DiffOp {
  tag: DiffTag;
  line: string;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

function diffLineOps(oldLines: string[], newLines: string[]): DiffOp[] {
  const rows = oldLines.length;
  const cols = newLines.length;
  const matrix: number[][] = Array.from({ length: rows + 1 }, () =>
    Array(cols + 1).fill(0),
  );

  for (let row = 1; row <= rows; row += 1) {
    for (let col = 1; col <= cols; col += 1) {
      if (oldLines[row - 1] === newLines[col - 1]) {
        matrix[row][col] = matrix[row - 1][col - 1] + 1;
      } else {
        matrix[row][col] = Math.max(matrix[row - 1][col], matrix[row][col - 1]);
      }
    }
  }

  const ops: DiffOp[] = [];
  let row = rows;
  let col = cols;
  while (row > 0 || col > 0) {
    if (
      row > 0 &&
      col > 0 &&
      oldLines[row - 1] === newLines[col - 1]
    ) {
      ops.unshift({ tag: " ", line: oldLines[row - 1] ?? "" });
      row -= 1;
      col -= 1;
      continue;
    }
    if (col > 0 && (row === 0 || matrix[row][col - 1] >= matrix[row - 1][col])) {
      ops.unshift({ tag: "+", line: newLines[col - 1] ?? "" });
      col -= 1;
      continue;
    }
    ops.unshift({ tag: "-", line: oldLines[row - 1] ?? "" });
    row -= 1;
  }
  return ops;
}

function groupDiffHunks(ops: DiffOp[]): DiffOp[][] {
  const hunks: DiffOp[][] = [];
  let current: DiffOp[] = [];
  let changed = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    hunks.push(current);
    current = [];
    changed = 0;
  };

  for (const op of ops) {
    current.push(op);
    if (op.tag !== " ") changed += 1;
    if (changed > 0 && current.length > 24) {
      flush();
    }
  }
  flush();
  return hunks.length > 0 ? hunks : [ops];
}

function hunkHeader(hunk: DiffOp[]): string {
  let oldStart = 0;
  let oldCount = 0;
  let newStart = 0;
  let newCount = 0;
  let oldLine = 0;
  let newLine = 0;

  for (const op of hunk) {
    if (op.tag === " ") {
      oldLine += 1;
      newLine += 1;
      if (oldCount === 0 && newCount === 0) {
        oldStart = oldLine;
        newStart = newLine;
      }
      oldCount += 1;
      newCount += 1;
      continue;
    }
    if (op.tag === "-") {
      oldLine += 1;
      if (oldCount === 0 && newCount === 0) oldStart = oldLine;
      oldCount += 1;
      continue;
    }
    newLine += 1;
    if (oldCount === 0 && newCount === 0) newStart = newLine;
    newCount += 1;
  }

  const safeOldStart = Math.max(1, oldStart || 1);
  const safeNewStart = Math.max(1, newStart || 1);
  return `@@ -${safeOldStart},${Math.max(oldCount, 1)} +${safeNewStart},${Math.max(newCount, 1)} @@`;
}

/** Build unified diff text compatible with ChatActionDiff. */
export function buildMarkdownUnifiedDiff(
  oldText: string,
  newText: string,
  filePath: string,
): string {
  const oldNormalized = (oldText ?? "").trim();
  const newNormalized = (newText ?? "").trim();
  if (!oldNormalized || oldNormalized === newNormalized) return "";

  const oldLines = splitLines(oldNormalized);
  const newLines = splitLines(newNormalized);
  const ops = diffLineOps(oldLines, newLines);
  if (ops.every((op) => op.tag === " ")) return "";

  const fileName = (filePath.split("/").pop() || "plan.md").trim() || "plan.md";
  const hunks = groupDiffHunks(ops);
  const lines = [`--- a/${fileName}`, `+++ b/${fileName}`];

  for (const hunk of hunks) {
    if (hunk.every((op) => op.tag === " ")) continue;
    lines.push(hunkHeader(hunk));
    for (const op of hunk) {
      lines.push(`${op.tag}${op.line}`);
    }
  }

  return lines.join("\n");
}
