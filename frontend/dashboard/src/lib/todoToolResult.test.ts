import { describe, expect, it } from "vitest";
import {
  parseTodoToolResult,
  resolveLatestTodoResult,
  resolveLatestTodoToolId,
  todoProgressPercent,
} from "./todoToolResult";

describe("parseTodoToolResult", () => {
  it("parseia lista com summary", () => {
    const raw = JSON.stringify({
      todos: [
        { id: "1", content: "Pesquisar notícias", status: "completed" },
        { id: "2", content: "Compilar resumo", status: "in_progress" },
        { id: "3", content: "Notificar no Telegram", status: "pending" },
      ],
      summary: {
        total: 3,
        pending: 1,
        in_progress: 1,
        completed: 1,
        cancelled: 0,
      },
    });

    const parsed = parseTodoToolResult(raw);
    expect(parsed?.todos).toHaveLength(3);
    expect(parsed?.summary.total).toBe(3);
    expect(parsed?.todos[0]?.status).toBe("completed");
  });

  it("retorna null para JSON inválido", () => {
    expect(parseTodoToolResult("{")).toBeNull();
  });
});

describe("todoProgressPercent", () => {
  it("calcula percentual de concluídas", () => {
    expect(
      todoProgressPercent({
        total: 3,
        pending: 1,
        in_progress: 1,
        completed: 1,
        cancelled: 0,
      }),
    ).toBe(33);
  });
});

describe("resolveLatestTodoResult", () => {
  const firstSnapshot = parseTodoToolResult(
    JSON.stringify({
      todos: [{ id: "1", content: "Staging", status: "in_progress" }],
      summary: {
        total: 1,
        pending: 0,
        in_progress: 1,
        completed: 0,
        cancelled: 0,
      },
    }),
  );
  const secondSnapshot = parseTodoToolResult(
    JSON.stringify({
      todos: [{ id: "1", content: "Staging", status: "completed" }],
      summary: {
        total: 1,
        pending: 0,
        in_progress: 0,
        completed: 1,
        cancelled: 0,
      },
    }),
  );

  it("prefere todoSnapshot do turno", () => {
    expect(
      resolveLatestTodoResult({
        todoSnapshot: secondSnapshot,
        toolCalls: [
          {
            id: "todo-1",
            name: "todo",
            result: JSON.stringify({ todos: [], summary: { total: 0 } }),
          },
        ],
      })?.summary.completed,
    ).toBe(1);
  });

  it("usa última tool todo com result parseável", () => {
    const latestId = resolveLatestTodoToolId([
      {
        id: "todo-1",
        name: "todo",
        result: JSON.stringify(firstSnapshot),
      },
      {
        id: "todo-2",
        name: "todo",
        result: JSON.stringify(secondSnapshot),
      },
    ]);
    expect(latestId).toBe("todo-2");
    expect(
      resolveLatestTodoResult({
        toolCalls: [
          {
            id: "todo-1",
            name: "todo",
            result: JSON.stringify(firstSnapshot),
          },
          {
            id: "todo-2",
            name: "todo",
            result: JSON.stringify(secondSnapshot),
          },
        ],
      })?.summary.completed,
    ).toBe(1);
  });
});
