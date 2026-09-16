import { beforeEach, describe, expect, it } from "vitest";

import {
  clearLiveMessageCacheForTests,
  getChatCacheKey,
  readCachedMessages,
  serializeMessagesForCache,
  writeCachedMessages,
} from "./chatMessageCache";
import type { ChatMessage } from "./components/types";

describe("chatMessageCache live previews", () => {
  beforeEach(() => {
    clearLiveMessageCacheForTests();
    sessionStorage.clear();
  });

  it("keeps blob preview URLs in the live read path after write", () => {
    const sid = "sess-blob";
    const messages: ChatMessage[] = [
      {
        id: "user-1",
        role: "user",
        content: "O que ver?",
        attachments: [
          {
            id: "att-1",
            name: "shot.png",
            kind: "image",
            previewUrl: "blob:http://localhost/fake",
          },
        ],
      },
    ];

    writeCachedMessages(sid, messages);
    const live = readCachedMessages(sid);
    expect(live[0]?.attachments?.[0]?.previewUrl).toBe(
      "blob:http://localhost/fake",
    );

    const storedRaw = sessionStorage.getItem(getChatCacheKey(sid));
    expect(storedRaw).toBeTruthy();
    const stored = JSON.parse(storedRaw!) as ChatMessage[];
    expect(stored[0]?.attachments).toBeUndefined();
  });

  it("serializeMessagesForCache drops blob-only attachments", () => {
    const serialized = serializeMessagesForCache([
      {
        id: "user-1",
        role: "user",
        content: "foto",
        attachments: [
          {
            id: "att-1",
            name: "a.png",
            kind: "image",
            previewUrl: "blob:http://localhost/x",
          },
        ],
      },
    ]);
    expect(serialized[0]?.attachments).toBeUndefined();
  });

  it("serializeMessagesForCache keeps /api/chat attachment URLs", () => {
    const serialized = serializeMessagesForCache([
      {
        id: "user-1",
        role: "user",
        content: "foto",
        attachments: [
          {
            id: "att-1",
            name: "a.png",
            kind: "image",
            url: "/api/chat/images/web_x.png",
            previewUrl: "blob:http://localhost/x",
          },
        ],
      },
    ]);
    expect(serialized[0]?.attachments?.[0]?.url).toBe(
      "/api/chat/images/web_x.png",
    );
    expect(serialized[0]?.attachments?.[0]?.previewUrl).toBe(
      "/api/chat/images/web_x.png",
    );
  });

  it("falls back to sessionStorage after live cache is cleared", () => {
    const sid = "sess-reload";
    writeCachedMessages(sid, [
      {
        id: "user-1",
        role: "user",
        content: "oi",
        attachments: [
          {
            id: "att-1",
            name: "a.png",
            kind: "image",
            url: "/api/chat/images/web_x.png",
            previewUrl: "/api/chat/images/web_x.png",
          },
        ],
      },
    ]);
    clearLiveMessageCacheForTests();
    const restored = readCachedMessages(sid);
    expect(restored[0]?.attachments?.[0]?.url).toBe(
      "/api/chat/images/web_x.png",
    );
  });
});
