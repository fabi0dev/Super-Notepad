import { describe, expect, it } from "vitest";
import {
  assistantHasRunningWork,
  buildInteractionFooters,
  formatCompletionClock,
  formatElapsedDuration,
  formatInteractionFooter,
  getLiveTurnStartedAt,
  mergeAssistantTurnTiming,
  normalizeEpochMs,
  pickLatestTimestamp,
  shouldTickLiveInteractionFooter,
} from "./chatTurnTiming";
import type { ChatMessage } from "@/pages/ChatPage/components/types";

describe("chatTurnTiming", () => {
  it("normalizes epoch seconds to ms", () => {
    expect(normalizeEpochMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(normalizeEpochMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it("formats elapsed duration", () => {
    const base = 1_700_000_000_000;
    expect(formatElapsedDuration(base, base + 42_000)).toBe("42s");
    expect(formatElapsedDuration(base, base + 135_000)).toBe("2m 15s");
    expect(formatElapsedDuration(base, base + 3_600_000)).toBe("1h");
    expect(formatElapsedDuration(base, base + 400)).toBe("1s");
  });

  it("pickLatestTimestamp prefers later epoch regardless of unit", () => {
    expect(pickLatestTimestamp(1_700_000_000, 1_700_000_000_500)).toBe(
      1_700_000_000_500,
    );
    expect(pickLatestTimestamp(1_700_000_001_000, 1_700_000_000)).toBe(
      1_700_000_001_000,
    );
  });

  it("buildInteractionFooters prefers client turnCompletedAt", () => {
    const startedAt = 1_700_000_000_000;
    const completedAt = startedAt + 45_000;
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi", timestamp: startedAt },
      {
        id: "a1",
        role: "assistant",
        content: "hello",
        timestamp: startedAt,
        turnCompletedAt: completedAt,
      },
    ];
    const footers = buildInteractionFooters(messages, { streaming: false });
    expect(footers.get(1)?.completedAt).toBe(completedAt);
    expect(formatElapsedDuration(startedAt, completedAt)).toBe("45s");
  });

  it("mergeAssistantTurnTiming keeps client completion stamp", () => {
    const cached: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "done",
      timestamp: 1_700_000_010_000,
      turnCompletedAt: 1_700_000_010_000,
    };
    const api: ChatMessage = {
      id: "a1-api",
      role: "assistant",
      content: "done",
      timestamp: 1_700_000_000,
    };
    expect(mergeAssistantTurnTiming(cached, api)).toEqual({
      timestamp: 1_700_000_010_000,
      turnCompletedAt: 1_700_000_010_000,
    });
  });

  it("formats interaction footer compactly", () => {
    const startedAt = Date.UTC(2026, 5, 12, 14, 40, 0);
    const completedAt = startedAt + 135_000;
    expect(
      formatInteractionFooter({ startedAt, completedAt }, "UTC"),
    ).toMatch(/^2m 15s · /);
  });

  it("buildInteractionFooters maps completed assistant turns", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi", timestamp: 100 },
      { id: "a1", role: "assistant", content: "hello", timestamp: 145 },
    ];
    const footers = buildInteractionFooters(messages, { streaming: false });
    expect(footers.get(1)).toEqual({
      startedAt: 100_000,
      completedAt: 145_000,
    });
  });

  it("returns live turn start from preceding user message", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi", timestamp: 100 },
      { id: "a1", role: "assistant", content: "…", timestamp: 120 },
    ];
    expect(getLiveTurnStartedAt(messages, true)).toBe(100_000);
    expect(getLiveTurnStartedAt(messages, false)).toBeNull();
  });

  it("skips last assistant while streaming", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi", timestamp: 100 },
      { id: "a1", role: "assistant", content: "…", timestamp: 120 },
    ];
    expect(buildInteractionFooters(messages, { streaming: true }).size).toBe(0);
  });

  it("ticks live footer while last assistant has running tool cards", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi", timestamp: 100 },
      {
        id: "a1",
        role: "assistant",
        content: "Deixando rodar.",
        timestamp: 120,
        turnCompletedAt: 145,
        toolCalls: [
          {
            id: "t1",
            name: "terminal",
            args: "{}",
            status: "running",
            backgroundProcId: "proc_1",
          },
        ],
      },
    ];
    expect(assistantHasRunningWork(messages[1]!)).toBe(true);
    expect(shouldTickLiveInteractionFooter(messages, false)).toBe(true);
    expect(getLiveTurnStartedAt(messages, true)).toBe(100_000);
    expect(buildInteractionFooters(messages, { streaming: false }).size).toBe(
      0,
    );
  });

  it("formatCompletionClock returns time for same-day dates", () => {
    const now = new Date();
    now.setHours(11, 42, 0, 0);
    const label = formatCompletionClock(now.getTime(), "UTC");
    expect(label).toMatch(/\d{1,2}:\d{2}/);
  });
});
