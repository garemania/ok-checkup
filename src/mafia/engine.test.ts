import { describe, expect, it } from "vitest";
import { makeAI } from "./ai";
import { HUMAN_ID } from "./data";
import { addMsg, alive, checkWin, createGame, kill, mafiaPartners, tallyVotes } from "./engine";
import { DEFAULT_SETTINGS } from "./useMafiaGame";

describe("engine", () => {
  it("creates 8 players with the right role distribution", () => {
    const s = createGame("나");
    expect(s.players).toHaveLength(8);
    const count = (r: string) => s.players.filter((p) => p.role === r).length;
    expect([count("mafia"), count("police"), count("doctor"), count("citizen")]).toEqual([2, 1, 1, 4]);
    expect(s.players[HUMAN_ID].isHuman).toBe(true);
  });

  it("detects win conditions", () => {
    let s = createGame("나");
    expect(checkWin(s)).toBeUndefined();
    s.players.filter((p) => p.role === "mafia").forEach((m) => (s = kill(s, m.id, true)));
    expect(checkWin(s)).toBe("citizen");

    s = createGame("나");
    const citizens = s.players.filter((p) => p.role !== "mafia");
    citizens.slice(0, 4).forEach((c) => (s = kill(s, c.id, false)));
    expect(alive(s)).toHaveLength(4);
    expect(checkWin(s)).toBe("mafia");
  });

  it("tallies votes, ties execute nobody", () => {
    const s = createGame("나");
    expect(tallyVotes(s, { 0: 3, 1: 3, 2: 4 }).executed).toBe(3);
    expect(tallyVotes(s, { 0: 3, 1: 4 }).executed).toBeNull();
    expect(tallyVotes(s, { 0: null, 1: null }).executed).toBeNull();
  });

  it("only mafia know their partners", () => {
    const s = createGame("나");
    s.players.forEach((p) => {
      expect(mafiaPartners(s, p.id)).toHaveLength(p.role === "mafia" ? 1 : 0);
    });
  });

  it("addMsg appends with increasing ids", () => {
    let s = createGame("나");
    s = addMsg(s, "system", "a");
    s = addMsg(s, 1, "b");
    expect(s.log.map((m) => m.id)).toEqual([1, 2]);
  });
});

describe("mock AI", () => {
  const ai = makeAI(DEFAULT_SETTINGS, () => {});
  it("votes never target self or the dead; mafia never vote their partner", async () => {
    for (let i = 0; i < 5; i++) {
      const s = createGame("나");
      const ais = s.players.filter((p) => !p.isHuman);
      for (const p of ais) {
        const t = await ai.vote(s, p);
        expect(t).not.toBe(p.id);
        if (p.role === "mafia") expect(s.players[t as number].role).not.toBe("mafia");
      }
    }
  }, 30000);
  it("night targets are valid", async () => {
    const s = createGame("나");
    const m = s.players.find((p) => p.role === "mafia" && !p.isHuman) ?? s.players.find((p) => p.role === "mafia")!;
    const t = await ai.nightTarget(s, m, "kill");
    expect(s.players[t].role).not.toBe("mafia");
  });
});

describe("Gemini provider", () => {
  it("builds the request and parses the reply", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: " 안녕하세요 " }] } }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const { callLLM } = await import("./ai");
      const out = await callLLM({ ...DEFAULT_SETTINGS, mode: "api", provider: "gemini", geminiKey: "k" }, "sys", "usr", 100);
      expect(out).toBe("안녕하세요");
      expect(calls[0].url).toContain("/models/gemini-2.5-flash:generateContent");
      expect((calls[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k");
      const body = JSON.parse(calls[0].init.body as string);
      expect(body.systemInstruction.parts[0].text).toBe("sys");
      expect(body.contents[0].parts[0].text).toBe("usr");
      expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(0);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("wasPhrase", () => {
  it("picks 이었/였 by final consonant", async () => {
    const { wasPhrase } = await import("./engine");
    expect(["마피아", "경찰", "의사", "시민"].map(wasPhrase)).toEqual(["마피아였습니다", "경찰이었습니다", "의사였습니다", "시민이었습니다"]);
  });
});

describe("API resilience", () => {
  const gem = { ...DEFAULT_SETTINGS, mode: "api" as const, provider: "gemini" as const, geminiKey: "k" };
  const ok = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 });

  it("retries 429 and then succeeds", async () => {
    const orig = globalThis.fetch;
    let n = 0;
    globalThis.fetch = (async () => (++n < 3 ? new Response("{}", { status: 429, headers: { "retry-after": "0" } }) : ok())) as typeof fetch;
    try {
      const { callLLM } = await import("./ai");
      expect(await callLLM(gem, "s", "u", 50)).toBe("ok");
      expect(n).toBe(3);
    } finally { globalThis.fetch = orig; }
  });

  it("does not retry a daily quota error", async () => {
    const orig = globalThis.fetch;
    let n = 0;
    globalThis.fetch = (async () => { n++; return new Response('{"error":{"message":"GenerateRequestsPerDayPerProjectPerModel"}}', { status: 429 }); }) as typeof fetch;
    try {
      const { callLLM } = await import("./ai");
      await expect(callLLM(gem, "s", "u", 50)).rejects.toThrow(/429/);
      expect(n).toBe(1);
    } finally { globalThis.fetch = orig; }
  });

  it("limits concurrent requests", async () => {
    const orig = globalThis.fetch;
    let running = 0, peak = 0;
    globalThis.fetch = (async () => {
      running++; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 20));
      running--; return ok();
    }) as typeof fetch;
    try {
      const { callLLM } = await import("./ai");
      await Promise.all(Array.from({ length: 7 }, () => callLLM(gem, "s", "u", 50)));
      expect(peak).toBeLessThanOrEqual(2);
    } finally { globalThis.fetch = orig; }
  });
});
