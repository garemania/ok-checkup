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
    expect([count("mafia"), count("police"), count("doctor"), count("soldier"), count("citizen")]).toEqual([2, 1, 1, 1, 3]);
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
    expect(["마피아", "경찰", "의사", "군인", "시민"].map(wasPhrase)).toEqual(["마피아였습니다", "경찰이었습니다", "의사였습니다", "군인이었습니다", "시민이었습니다"]);
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

describe("태오 mock speech", () => {
  it("uses plain, short 반말 (no 존댓말)", async () => {
    const ai = makeAI(DEFAULT_SETTINGS, () => {});
    const s = createGame("나");
    const taeo = s.players.find((p) => p.name === "태오")!;
    for (let i = 0; i < 6; i++) {
      const { text: t } = await ai.speak(s, taeo);
      expect(t).not.toMatch(/(요|습니다|니다)[.!?~]*$/);
    }
  }, 20000);
});

describe("parseTarget", () => {
  const names = { 1: "서연", 2: "도윤", 3: "하은" };
  it("accepts ids, numeric strings, names and code fences", async () => {
    const { parseTarget } = await import("./ai");
    const c = [1, 2, 3];
    expect(parseTarget('{"target": 2, "reason": "x"}', c, names)).toBe(2);
    expect(parseTarget('{"target": "3"}', c, names)).toBe(3);
    expect(parseTarget('{"target": "도윤", "reason": "수상"}', c, names)).toBe(2);
    expect(parseTarget('```json\n{"vote": 1}\n```', c, names)).toBe(1);
    expect(parseTarget("하은을 노리겠다", c, names)).toBe(3);
    expect(parseTarget('{"vote": null}', c, names)).toBeNull();
  });
  it("rejects non-candidates", async () => {
    const { parseTarget } = await import("./ai");
    expect(parseTarget('{"target": 7}', [1, 2], names)).toBeUndefined();
    expect(parseTarget("모르겠다", [1, 2], names)).toBeUndefined();
  });
});

describe("Anthropic provider", () => {
  const cfg = { ...DEFAULT_SETTINGS, mode: "api" as const, provider: "anthropic" as const, apiKey: "k" };
  it("gives a generous max_tokens and reports why a reply was empty", async () => {
    const orig = globalThis.fetch;
    let sent: { max_tokens?: number } = {};
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ content: [{ type: "thinking" }], stop_reason: "max_tokens" }), { status: 200 });
    }) as typeof fetch;
    try {
      const { callLLM } = await import("./ai");
      await expect(callLLM(cfg, "s", "u", 150)).rejects.toThrow(/stop_reason=max_tokens.*thinking/);
      expect(sent.max_tokens).toBeGreaterThanOrEqual(1024);
    } finally { globalThis.fetch = orig; }
  });
});

describe("Anthropic thinking control", () => {
  const run = async (model: string) => {
    const orig = globalThis.fetch;
    let sent: Record<string, unknown> = {};
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const { callLLM } = await import("./ai");
      await callLLM({ ...DEFAULT_SETTINGS, mode: "api", provider: "anthropic", apiKey: "k", model }, "s", "u", 100);
    } finally { globalThis.fetch = orig; }
    return sent;
  };
  it("turns thinking off at low effort only for Haiku 5.x", async () => {
    const haiku = await run("claude-haiku-5-5");
    expect(haiku.thinking).toEqual({ type: "disabled" });
    expect(haiku.output_config).toEqual({ effort: "low" });
    const other = await run("claude-sonnet-5-5");
    expect(other.thinking).toBeUndefined();
    expect(other.output_config).toBeUndefined();
  });
});

describe("emotion", () => {
  it("parses [tag] prefixes and falls back to keywords", async () => {
    const { parseSpoken, detectEmotion } = await import("./emotion");
    expect(parseSpoken("[angry] 날 몰아가지 마.")).toEqual({ text: "날 몰아가지 마.", emotion: "angry" });
    expect(parseSpoken("[Suspicious]  서연이 수상해")).toEqual({ text: "서연이 수상해", emotion: "suspicious" });
    expect(parseSpoken("[unknown] 안녕").text).toBe("안녕");
    expect(parseSpoken("너무 억울해").emotion).toBe("angry");
    expect(detectEmotion("그냥 평범한 말")).toBe("neutral");
  });
  it("emotionOf follows the last line and shows dead faces", async () => {
    const { emotionOf } = await import("./engine");
    let s = createGame("나");
    expect(emotionOf(s, 1)).toBe("neutral");
    s = addMsg(s, 1, "x", undefined, "happy");
    s = addMsg(s, 1, "y", undefined, "scared");
    expect(emotionOf(s, 1)).toBe("scared");
    s = kill(s, 1, false);
    expect(emotionOf(s, 1)).toBe("dead");
  });
});

describe("night resolution", () => {
  const setup = (day: number) => {
    const s = { ...createGame("나"), day };
    const mafia = s.players.find((p) => p.role === "mafia")!;
    const target = s.players.find((p) => p.role === "citizen")!;
    return { s, mafia, target };
  };
  it("no one is attacked on the first night, but police still investigate", async () => {
    const { resolveNight } = await import("./engine");
    const { s, target } = setup(1);
    const police = s.players.find((p) => p.role === "police")!;
    const r = resolveNight(s, { kill: target.id, protect: null, investigate: { actor: police.id, target: target.id } });
    expect(r.state.players.every((p) => p.alive)).toBe(true);
    expect(r.result).toContain("첫 밤");
    expect(r.state.policeLog[police.id]).toHaveLength(1);
  });
  it("kills from the second night", async () => {
    const { resolveNight } = await import("./engine");
    const { s, target } = setup(2);
    const r = resolveNight(s, { kill: target.id, protect: null, investigate: null });
    expect(r.state.players[target.id].alive).toBe(false);
    expect(r.result).toContain(target.name);
  });
  it("doctor saves the target", async () => {
    const { resolveNight } = await import("./engine");
    const { s, target } = setup(2);
    const r = resolveNight(s, { kill: target.id, protect: target.id, investigate: null });
    expect(r.state.players[target.id].alive).toBe(true);
  });
  it("soldier survives one attack, then dies", async () => {
    const { resolveNight } = await import("./engine");
    const { s } = setup(2);
    const soldier = s.players.find((p) => p.role === "soldier")!;
    const r1 = resolveNight(s, { kill: soldier.id, protect: null, investigate: null });
    expect(r1.state.players[soldier.id].alive).toBe(true);
    expect(r1.state.players[soldier.id].shield).toBe(false);
    const r2 = resolveNight({ ...r1.state, day: 3 }, { kill: soldier.id, protect: null, investigate: null });
    expect(r2.state.players[soldier.id].alive).toBe(false);
  });
});

describe("trial verdict", () => {
  it("needs strictly more yes than no", async () => {
    const { tallyVerdict } = await import("./engine");
    expect(tallyVerdict({ 1: true, 2: true, 3: false }).execute).toBe(true);
    expect(tallyVerdict({ 1: true, 2: false }).execute).toBe(false);
    expect(tallyVerdict({ 1: false, 2: false, 3: true }).execute).toBe(false);
  });
  it("mock AI mafia never convicts a partner", async () => {
    const ai = makeAI(DEFAULT_SETTINGS, () => {});
    const s = createGame("나");
    const [m1, m2] = s.players.filter((p) => p.role === "mafia");
    const voter = m1.isHuman ? m2 : m1;
    const partner = voter === m1 ? m2 : m1;
    expect(await ai.verdict(s, voter, partner.id)).toBe(false);
  });
});
