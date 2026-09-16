import { beforeEach, describe, expect, it } from "vitest";
import {
  clearNotifications,
  getNotifications,
  pushNotification,
  reconcileReminderNotifications,
  removeAllSessionNotifications,
  removeNotificationsForEcoRecording,
  removeNotificationsForReminder,
  removeNotificationsForSession,
} from "./notificationCenter";

describe("removeNotificationsForSession", () => {
  beforeEach(() => clearNotifications());

  it("apaga só os avisos da conversa apagada, mantém os outros", () => {
    pushNotification({ title: "a", body: "1", target: "/chat?resume=abc", kind: "turn" });
    pushNotification({ title: "b", body: "2", target: "/chat?resume=xyz", kind: "delivery" });
    pushNotification({ title: "c", body: "3", target: "/lembretes", kind: "reminder" });

    removeNotificationsForSession("abc");

    const alvos = getNotifications().map((n) => n.target);
    expect(alvos).not.toContain("/chat?resume=abc");
    expect(alvos).toContain("/chat?resume=xyz");
    expect(alvos).toContain("/lembretes");
  });

  it("casa mesmo com query extra no destino e id que precisa de encode", () => {
    pushNotification({ title: "a", body: "1", target: "/chat?resume=s%201&x=2", kind: "turn" });
    removeNotificationsForSession("s 1"); // encodeURIComponent("s 1") = "s%201"
    expect(getNotifications()).toHaveLength(0);
  });

  it("id vazio é no-op", () => {
    pushNotification({ title: "a", body: "1", target: "/chat?resume=abc", kind: "turn" });
    removeNotificationsForSession("");
    expect(getNotifications()).toHaveLength(1);
  });
});

describe("removeAllSessionNotifications", () => {
  beforeEach(() => clearNotifications());

  it("apaga TODOS os avisos de conversa, preserva os de outros domínios", () => {
    pushNotification({ title: "a", body: "1", target: "/chat?resume=abc", kind: "delivery" });
    pushNotification({ title: "b", body: "2", target: "/chat?resume=xyz", kind: "turn" });
    pushNotification({ title: "m", body: "3", target: "/mail", kind: "mail" });
    pushNotification({ title: "e", body: "4", target: "/eco/gravacoes/r1", kind: "info" });

    removeAllSessionNotifications();

    const alvos = getNotifications().map((n) => n.target);
    expect(alvos).toEqual(expect.arrayContaining(["/mail", "/eco/gravacoes/r1"]));
    expect(alvos.some((t) => (t || "").includes("resume="))).toBe(false);
  });
});

describe("lembretes: remoção e reconciliação", () => {
  beforeEach(() => clearNotifications());

  it("removeNotificationsForReminder tira só o lembrete pelo id (dedupKey)", () => {
    pushNotification({ title: "Lembrete: a", body: "", target: "/lembretes", kind: "reminder", dedupKey: "reminder:r1" });
    pushNotification({ title: "Lembrete: b", body: "", target: "/lembretes", kind: "reminder", dedupKey: "reminder:r2" });
    removeNotificationsForReminder("r1");
    const keys = getNotifications().map((n) => n.dedupKey);
    expect(keys).toEqual(["reminder:r2"]);
  });

  it("reconcile remove os que sumiram da lista, mantém os vivos e outros domínios", () => {
    pushNotification({ title: "Lembrete: a", body: "", target: "/lembretes", kind: "reminder", dedupKey: "reminder:r1" });
    pushNotification({ title: "Lembrete: b", body: "", target: "/lembretes", kind: "reminder", dedupKey: "reminder:r2" });
    pushNotification({ title: "chat", body: "", target: "/chat?resume=s", kind: "delivery" });
    // r2 foi apagado (não está em liveIds); r1 continua vivo (concluído ou não)
    reconcileReminderNotifications(new Set(["r1"]));
    const keys = getNotifications().map((n) => n.dedupKey ?? n.target);
    expect(keys).toContain("reminder:r1");
    expect(keys).not.toContain("reminder:r2");
    expect(keys).toContain("/chat?resume=s"); // outro domínio intacto
  });
});

describe("removeNotificationsForEcoRecording", () => {
  beforeEach(() => clearNotifications());

  it("apaga só o aviso da gravação apagada", () => {
    pushNotification({ title: "r", body: "pronto", target: "/eco/gravacoes/rec1", kind: "info" });
    pushNotification({ title: "s", body: "pronto", target: "/eco/gravacoes/rec2", kind: "info" });
    pushNotification({ title: "c", body: "chat", target: "/chat?resume=abc", kind: "turn" });

    removeNotificationsForEcoRecording("rec1");

    const alvos = getNotifications().map((n) => n.target);
    expect(alvos).not.toContain("/eco/gravacoes/rec1");
    expect(alvos).toContain("/eco/gravacoes/rec2");
    expect(alvos).toContain("/chat?resume=abc");
  });
});
