import { useEffect, useMemo, useState } from "react";
import type { ToolCallEvent } from "../types";

const PROCESS_WAIT_LIVE_LABEL_RE =
  /^wait\s+(proc_[\w]+)(?:\s+(\d+)\s*s)?$/i;

export interface ProcessWaitMeta {
  timeoutSec: number;
  sessionId?: string;
}

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function parseTimeoutValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return parseInt(value.trim(), 10);
  }
  return null;
}

const PROCESS_WAIT_LABEL_RE = /^aguardando\s+(o\s+)?processo/i;

export function parseProcessWaitSessionId(rawArgs: string): string | null {
  const args = parseJsonRecord(rawArgs);
  if (String(args?.action ?? "").trim().toLowerCase() !== "wait") return null;
  const sessionId =
    typeof args?.session_id === "string" ? args.session_id.trim() : "";
  return sessionId || null;
}

export function isProcessWaitishLabel(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return (
    PROCESS_WAIT_LIVE_LABEL_RE.test(trimmed) ||
    PROCESS_WAIT_LABEL_RE.test(trimmed)
  );
}

export function isProcessWaitTool(
  tool: Pick<ToolCallEvent, "name" | "args" | "liveLabel">,
): boolean {
  return parseProcessWaitMeta(tool) != null;
}

export function parseProcessWaitMeta(
  tool: Pick<ToolCallEvent, "name" | "args" | "liveLabel">,
): ProcessWaitMeta | null {
  if (tool.name.trim().toLowerCase() !== "process") return null;

  const args = parseJsonRecord(tool.args);
  const action = String(args?.action ?? "").trim().toLowerCase();

  if (action === "wait") {
    const timeoutSec = parseTimeoutValue(args?.timeout);
    if (!timeoutSec) return null;
    const sessionId =
      typeof args?.session_id === "string" ? args.session_id.trim() : undefined;
    return { timeoutSec, sessionId: sessionId || undefined };
  }

  const live = (tool.liveLabel ?? "").trim();
  const match = live.match(PROCESS_WAIT_LIVE_LABEL_RE);
  if (!match) return null;

  const timeoutSec = match[2] ? parseInt(match[2], 10) : null;
  return {
    timeoutSec: timeoutSec && timeoutSec > 0 ? timeoutSec : 600,
    sessionId: match[1],
  };
}

export function formatProcessWaitCountdown(remainingSec: number): string {
  const total = Math.max(0, Math.floor(remainingSec));
  if (total >= 3600) {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m > 0) {
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  return `${total}s`;
}

export function formatProcessWaitTitle(
  remainingSec: number | null,
): string {
  if (remainingSec == null) return "Aguardando o processo";
  return `Aguardando o processo · ${formatProcessWaitCountdown(remainingSec)}`;
}

export function humanizeProcessWaitLiveLabel(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (PROCESS_WAIT_LIVE_LABEL_RE.test(trimmed)) {
    return "Aguardando o processo";
  }
  return null;
}

export function useProcessWaitTitle(
  tool: ToolCallEvent,
  isRunning: boolean,
): string | null {
  const waitMeta = useMemo(
    () => (isRunning ? parseProcessWaitMeta(tool) : null),
    [isRunning, tool.args, tool.liveLabel, tool.name],
  );
  const startedAt = tool.startedAt ?? null;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!waitMeta || !isRunning) return;
    setNowMs(Date.now());
    const timerId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, [isRunning, waitMeta, tool.id]);

  if (!waitMeta || !isRunning) return null;

  const anchor = startedAt ?? nowMs;
  const elapsedSec = Math.max(0, Math.floor((nowMs - anchor) / 1000));
  const remainingSec = Math.max(0, waitMeta.timeoutSec - elapsedSec);
  return formatProcessWaitTitle(remainingSec);
}
