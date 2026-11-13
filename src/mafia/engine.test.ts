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
        if (p.role === "mafia" && t !== null) expect(s.players[t].role).not.toBe("mafia");
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

describe("conversation context", () => {
  it("labels the viewer's own lines and the human player", async () => {
    const { transcriptFor } = await import("./context");
    let s = createGame("나는시민이다");
    s = addMsg(s, 1, "안녕하세요");
    s = addMsg(s, 0, "서연님은 시민이에요");
    const t = transcriptFor(s, s.players[1]);
    expect(t).toContain("서연(당신): 안녕하세요");
    expect(t).toContain("플레이어(나는시민이다): 서연님은 시민이에요");
  });

  it("detects first-person role claims only", async () => {
    const { detectClaims } = await import("./context");
    let s = createGame("나");
    s = addMsg(s, 2, "제가 경찰입니다. 조사해 보니 지후가 수상해요.");
    s = addMsg(s, 3, "도윤이 경찰이라고 했지만 믿기 어려워요.");
    s = addMsg(s, 0, "저는 의사입니다.");
    const c = detectClaims(s);
    expect(c[2]).toBe("police");
    expect(c[0]).toBe("doctor");
    expect(c[3]).toBeUndefined();
  });

  it("facts keep deaths, votes and claims after the recent-lines window", async () => {
    const { factsBlock, transcriptFor } = await import("./context");
    let s = createGame("나");
    s = addMsg(s, 2, "제가 경찰입니다.");
    s = addMsg(s, "system", "투표 결과\n서연 → 민재\n도윤 → 민재\n\n민재 2표", "vote");
    s = kill(s, 5, true);
    s = addMsg(s, "system", "민재님이 처형되었습니다. 정체는 시민이었습니다.", "trial");
    for (let i = 0; i < 60; i++) s = addMsg(s, 1, `잡담 ${i}`);
    expect(transcriptFor(s, s.players[1])).not.toContain("제가 경찰입니다");
    const f = factsBlock(s);
    expect(f).toContain("도윤(경찰 주장)");
    expect(f).toContain("서연→민재");
    expect(f).toContain("처형되었습니다");
    const { ROLE_LABEL } = await import("./types");
    expect(f).toContain(`민재(1일차 처형, 직업 공개: ${ROLE_LABEL[s.players[5].role]})`);
  });

  it("finds who is being addressed", async () => {
    const { addresseeOf } = await import("./context");
    let s = createGame("나");
    s = addMsg(s, 1, "태오, 아까 한 말 설명해 봐.");
    s = addMsg(s, 2, "그건 좀 이상한데요.");
    expect(addresseeOf(s, s.log[0])).toBe(7);
    expect(addresseeOf(s, s.log[1])).toBeNull();
  });

  it("flags third-person self reference but allows self-introduction", async () => {
    const { speaksOfSelf } = await import("./context");
    expect(speaksOfSelf("서연이 시민이라는 결과는 들었지만", "서연")).toBe(true);
    expect(speaksOfSelf("서연님, 말씀해 보세요", "서연")).toBe(true);
    expect(speaksOfSelf("저 서연은 시민입니다", "서연")).toBe(false);
    expect(speaksOfSelf("도윤님이 수상해요", "서연")).toBe(false);
  });

  it("asks again when the model refers to itself in the third person", async () => {
    const orig = globalThis.fetch;
    const replies = ["서연이 시민이라는 말은 들었는데요.", "저는 시민이라고 했잖아요. 근거부터 말씀해 주세요."];
    let n = 0;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: `[suspicious] ${replies[Math.min(n++, 1)]}` }] } }] }), { status: 200 })) as typeof fetch;
    try {
      const ai = makeAI({ ...DEFAULT_SETTINGS, mode: "api", provider: "gemini", geminiKey: "k" }, () => {});
      const s = createGame("나");
      const said = await ai.speak(s, s.players[1]);
      expect(n).toBe(2);
      expect(said.text).toBe("저는 시민이라고 했잖아요. 근거부터 말씀해 주세요.");
      expect(said.emotion).toBe("suspicious");
    } finally { globalThis.fetch = orig; }
  });
});

describe("rules awareness", () => {
  it("turns a police report into a structured fact", async () => {
    const { detectReports, factsBlock } = await import("./context");
    let s = createGame("나");
    s = addMsg(s, 0, "저는 경찰입니다. 조사해 보니 서연님은 마피아가 아닙니다.");
    s = addMsg(s, 3, "저는 경찰입니다. 조사해 보니 태오님은 마피아입니다.");
    const r = detectReports(s);
    expect(r).toContainEqual(expect.objectContaining({ by: 0, target: 1, result: "clean" }));
    expect(r).toContainEqual(expect.objectContaining({ by: 3, target: 7, result: "mafia" }));
    const f = factsBlock(s);
    expect(f).toContain("서연을(를) 조사했다며 \"마피아 아님(시민 쪽)\"");
    expect(f).toContain("조사 보고");
  });

  it("gives every AI the full rulebook including how to read police claims", async () => {
    const orig = globalThis.fetch;
    let system = "";
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      system = JSON.parse(init.body as string).systemInstruction.parts[0].text;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "[neutral] 네." }] } }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const ai = makeAI({ ...DEFAULT_SETTINGS, mode: "api", provider: "gemini", geminiKey: "k" }, () => {});
      const s = createGame("나");
      await ai.speak(s, s.players[1]);
      expect(system).toContain("진짜 경찰이 마피아를 조사하면 반드시");
      expect(system).toContain("마피아가 아니었다");
      expect(system).toContain("직업 주장은 증명이 아니다");
    } finally { globalThis.fetch = orig; }
  });

  const setup = () => {
    const s = createGame("나");
    const mafia = s.players.filter((p) => p.role === "mafia" && !p.isHuman);
    const citizen = s.players.find((p) => !p.isHuman && p.role !== "mafia" && p.role !== "police")!;
    const police = s.players.find((p) => !p.isHuman && p.role === "police");
    return { s, mafia, citizen, police };
  };

  it("a truly innocent target thanks the police reporter; a mafia target doubts them", async () => {
    const ai = makeAI(DEFAULT_SETTINGS, () => {});
    const { s, mafia, citizen } = setup();
    const tag = (id: number) => `[조사보고:${id}:clean] 플레이어가 경찰이라며 당신을 조사한 결과 "마피아 아님"이라고 보고했습니다.`;
    const thanks = await ai.speak(s, citizen, tag(citizen.id));
    expect(thanks.text).toMatch(/고맙|감사|고마워/);
    if (mafia.length) {
      const doubt = await ai.speak(s, mafia[0], tag(mafia[0].id));
      expect(doubt.text).toMatch(/수상|증거|근거|가짜/);
    }
  }, 30000);

  it("the real police AI calls out a fake police claim", async () => {
    const ai = makeAI(DEFAULT_SETTINGS, () => {});
    const { s, police, citizen } = setup();
    if (!police) return;
    const said = await ai.speak(s, police, `[조사보고:${citizen.id}:clean] 플레이어가 경찰이라며 보고했습니다.`);
    expect(said.text).toMatch(/경찰은 (나|저)/);
    const claim = await ai.speak(s, police, "[주장:경찰] 플레이어가 자신이 경찰이라고 주장했습니다.");
    expect(claim.text).toMatch(/경찰은 (나|저)/);
  }, 30000);
});

describe("typo tolerance and first-night rule", () => {
  it("fixes role-word typos in context but leaves normal words alone", async () => {
    const { normalizeHuman } = await import("./context");
    const players = createGame("나").players;
    expect(normalizeHuman("저는 경창입니다", players).text).toBe("저는 경찰입니다");
    expect(normalizeHuman("나 도사 돼", players).text).toBe("나 의사 돼");
    expect(normalizeHuman("서현님은 시민이에요", players).text).toBe("서연님은 시민이에요");
    expect(normalizeHuman("나 시간 없어", players).text).toBe("나 시간 없어");
    expect(normalizeHuman("도사님 안녕", players).fixes).toEqual([]);
  });

  it("recognises sloppy claims but not objects or negations", async () => {
    const { detectClaims } = await import("./context");
    const claim = (text: string) => {
      let s = createGame("나");
      s = addMsg(s, 2, text);
      return detectClaims(s)[2];
    };
    expect(claim("나 경창이다")).toBe("police");
    expect(claim("난 의사야")).toBe("doctor");
    expect(claim("나 도사 돼")).toBe("doctor");
    expect(claim("나는 시민을 믿어")).toBeUndefined();
    expect(claim("나 시민 아니야")).toBeUndefined();
  });

  it("shows the AI the typo correction and the first-night rule", async () => {
    const { transcriptFor, factsBlock } = await import("./context");
    let s = createGame("나");
    s = addMsg(s, 0, "서현님, 저는 경창입니다");
    const t = transcriptFor(s, s.players[2]);
    expect(t).toContain("오타 보정");
    expect(t).toContain("서연님, 저는 경찰입니다");
    expect(t).toContain("원문: 서현님, 저는 경창입니다");
    expect(factsBlock(s)).toContain("첫 밤에 하는 일은 경찰 조사뿐이다");
  });

  it("includes both rules in the rulebook sent to the model", async () => {
    const orig = globalThis.fetch;
    let system = "";
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      system = JSON.parse(init.body as string).systemInstruction.parts[0].text;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "[neutral] 네." }] } }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const ai = makeAI({ ...DEFAULT_SETTINGS, mode: "api", provider: "gemini", geminiKey: "k" }, () => {});
      const s = createGame("나");
      await ai.speak(s, s.players[1]);
      expect(system).toContain("첫날 밤에 조사했다");
      expect(system).toContain("오타");
      expect(system).toContain("기록에 없는 발언");
    } finally { globalThis.fetch = orig; }
  });
});

describe("free-form police reports", () => {
  const players = createGame("나").players;
  const rep = async (text: string, policeBefore = false) => {
    const { interpretByRules } = await import("./context");
    return interpretByRules(text, players, 0, policeBefore).reports ?? [];
  };
  it("understands natural phrasings", async () => {
    expect(await rep("서연 조사했는데 마피아임")).toEqual([{ target: 1, result: "mafia" }]);
    expect(await rep("조사해보니 도윤 시민")).toEqual([{ target: 2, result: "clean" }]);
    expect(await rep("나 경찰임. 마피아는 태오")).toEqual([{ target: 7, result: "mafia" }]);
    expect(await rep("서연=시민 확인함")).toEqual([{ target: 1, result: "clean" }]);
    expect(await rep("나 경창인데 서현 마피아야")).toEqual([{ target: 1, result: "mafia" }]);
    expect(await rep("조사 결과 서연은 마피아 아님, 지후는 마피아")).toEqual([
      { target: 1, result: "clean" },
      { target: 4, result: "mafia" },
    ]);
  });
  it("uses an earlier police claim as context, but ignores plain suspicion", async () => {
    expect(await rep("하은은 마피아 아님", true)).toEqual([{ target: 3, result: "clean" }]);
    expect(await rep("하은은 마피아 아님")).toEqual([]);
    expect(await rep("도윤님, 서연이 시민 연기하는 거 같은데요")).toEqual([]);
  });
  it("links a report to an earlier police claim across messages and tells AIs not to ask again", async () => {
    const { detectReports, factsBlock } = await import("./context");
    let s = createGame("나");
    s = addMsg(s, 0, "나 경찰임");
    s = addMsg(s, 0, "서연 마피아야");
    expect(detectReports(s)).toContainEqual({ by: 0, target: 1, result: "mafia", day: 1 });
    expect(factsBlock(s)).toContain("다시 묻지 말 것");
  });
  it("a stored LLM interpretation takes priority and shows in the transcript", async () => {
    const { detectReports, transcriptFor } = await import("./context");
    let s = createGame("나");
    s = addMsg(s, 0, "ㅅㅇ 그거임 ㅇㅇ");
    s = { ...s, log: s.log.map((m) => ({ ...m, meaning: { claim: "police" as const, reports: [{ target: 1, result: "mafia" as const }], summary: "경찰 주장, 서연=마피아 보고" } })) };
    expect(detectReports(s)).toContainEqual({ by: 0, target: 1, result: "mafia", day: 1 });
    expect(transcriptFor(s, s.players[2])).toContain("[해석: 경찰 주장, 서연=마피아 보고]");
  });
  it("parses the model's interpretation and drops invalid targets", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"claim":"경찰","reports":[{"target":1,"result":"mafia"},{"target":99,"result":"clean"}],"summary":"경찰 주장, 서연 마피아"}' }] } }] }), { status: 200 })) as typeof fetch;
    try {
      const ai = makeAI({ ...DEFAULT_SETTINGS, mode: "api", provider: "gemini", geminiKey: "k" }, () => {});
      const m = await ai.interpret(createGame("나"), "서연 조사함 마피아");
      expect(m).toEqual({ claim: "police", reports: [{ target: 1, result: "mafia" }], summary: "경찰 주장, 서연 마피아" });
    } finally { globalThis.fetch = orig; }
  });
});

describe("offline variety", () => {
  it("does not repeat a line that was just said when alternatives exist", async () => {
    const ai = makeAI(DEFAULT_SETTINGS, () => {});
    let s = createGame("나");
    const hint = "[조사보고:1:mafia] 플레이어가 경찰이라며 보고했습니다.";
    const observers = s.players.filter((p) => !p.isHuman && p.id !== 1 && p.role !== "police");
    const first = await ai.speak(s, observers[0], hint);
    s = addMsg(s, observers[0].id, first.text);
    const second = await ai.speak(s, observers[1], hint);
    expect(second.text).not.toBe(first.text);
  }, 30000);
});

describe("deaths, deductions and trust", () => {
  it("lists the living and the dead with how and when they died", async () => {
    const { factsBlock } = await import("./context");
    let s = createGame("나");
    s = kill(s, 1, true);
    s = { ...s, day: 2 };
    s = kill(s, 2, false);
    const f = factsBlock(s);
    expect(f).toMatch(/생존자\(6명/);
    expect(f).toContain("서연(1일차 처형, 직업 공개:");
    expect(f).toContain("도윤(2일차 밤에 마피아에게 살해, 직업 비공개)");
    expect(f).toContain("말을 걸지 말 것");
  });

  it("detects talking to the dead and talking about oneself", async () => {
    const { addressesDead, speaksOfSelf } = await import("./context");
    let s = createGame("나");
    s = kill(s, 1, false);
    expect(addressesDead(s, "서연 님, 도윤 님이 죽은 지금이라도 조사 결과가 있으면 말씀해 주세요", 3)).toBe(1);
    expect(addressesDead(s, "서연이 생전에 했던 말을 보면 태오가 수상해요", 3)).toBeNull();
    expect(addressesDead(s, "도윤님, 어떻게 생각하세요?", 3)).toBeNull();
    expect(speaksOfSelf("그럼 지후 살린 건 본인이네?", "지후")).toBe(true);
  });

  it("states sure deductions from public information", async () => {
    const { deductions } = await import("./context");
    let s = createGame("나");
    s = addMsg(s, 2, "제가 경찰입니다.");
    expect(deductions(s).join(" ")).toContain("반박이 없고");
    s = addMsg(s, 3, "저는 경찰입니다.");
    expect(deductions(s).join(" ")).toContain("적어도 한 명은 가짜");
    // 처형으로 공개된 직업과 어긋나는 보고는 거짓
    const target = s.players.find((p) => p.role !== "mafia" && p.id !== 2 && p.id !== 3 && !p.isHuman)!;
    s = addMsg(s, 2, `조사해 보니 ${target.name}님은 마피아입니다.`);
    s = kill(s, target.id, true);
    expect(deductions(s).join(" ")).toContain("경찰 주장은 거짓이다");
  });

  it("rewrites a line that asks a dead player for answers", async () => {
    const orig = globalThis.fetch;
    const replies = ["[suspicious] 서연 님, 조사 결과가 있으면 말씀해 주세요.", "[suspicious] 서연이 생전에 한 말을 보면 태오가 수상해요."];
    let n = 0;
    let lastPrompt = "";
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      lastPrompt = JSON.parse(init.body as string).contents[0].parts[0].text;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: replies[Math.min(n++, 1)] }] } }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const ai = makeAI({ ...DEFAULT_SETTINGS, mode: "api", provider: "gemini", geminiKey: "k" }, () => {});
      let s = createGame("나");
      s = kill(s, 1, false);
      const said = await ai.speak(s, s.players[3]);
      expect(n).toBe(2);
      expect(lastPrompt).toContain("이미 사망해서");
      expect(said.text).toBe("서연이 생전에 한 말을 보면 태오가 수상해요.");
    } finally { globalThis.fetch = orig; }
  });

  it("offline AIs give weight to an uncontested police report", async () => {
    const ai = makeAI(DEFAULT_SETTINGS, () => {});
    let s = createGame("나");
    const target = s.players.find((p) => !p.isHuman && p.role !== "mafia")!;
    s = addMsg(s, 0, `저는 경찰입니다. 조사해 보니 ${target.name}님은 마피아가 아닙니다.`);
    const voters = s.players.filter((p) => !p.isHuman && p.id !== target.id && p.role === "citizen");
    for (const v of voters) expect(await ai.vote(s, v)).not.toBe(target.id);
  }, 30000);
});

describe("last words after execution", () => {
  it("knows when a line denies the revealed role", async () => {
    const { deniesRevealedRole } = await import("./context");
    expect(deniesRevealedRole("마피아도 아닌데 죽다니 억울해요", "mafia")).toBe(true);
    expect(deniesRevealedRole("저는 시민이에요, 믿어 주세요", "mafia")).toBe(true);
    expect(deniesRevealedRole("결국 들켰네요. 하지만 끝난 건 아니에요.", "mafia")).toBe(false);
    expect(deniesRevealedRole("억울합니다. 꼭 마피아를 찾아 주세요.", "citizen")).toBe(false);
    expect(deniesRevealedRole("사실 제가 마피아였어요", "citizen")).toBe(true);
  });

  it("offline mafia last words never claim innocence", async () => {
    const { deniesRevealedRole } = await import("./context");
    const ai = makeAI(DEFAULT_SETTINGS, () => {});
    const s = createGame("나");
    const mafia = s.players.find((p) => p.role === "mafia" && !p.isHuman)!;
    for (let i = 0; i < 6; i++) {
      const w = await ai.speak(s, mafia, "[재판] 당신은 처형되었고, 직업이 \"마피아\"로 모두에게 공개되었습니다. 유언(마지막 한마디)을 하세요.");
      expect(deniesRevealedRole(w.text, "mafia")).toBe(false);
    }
  }, 30000);

  it("retries, then falls back, when the model keeps denying the revealed role", async () => {
    const { speakLastWords } = await import("./ai");
    const s = createGame("나");
    const mafia = s.players.find((p) => p.role === "mafia" && !p.isHuman)!;
    const hints: string[] = [];
    const stubborn = { speak: async (_s: unknown, _p: unknown, h?: string) => { hints.push(h ?? ""); return { text: "마피아도 아닌데 억울해요", emotion: "sad" as const }; } } as unknown as ReturnType<typeof makeAI>;
    const fallback = { speak: async () => ({ text: "결국 들켰네요.", emotion: "neutral" as const }) } as unknown as ReturnType<typeof makeAI>;
    const w = await speakLastWords(stubborn, fallback, s, mafia);
    expect(hints).toHaveLength(2);
    expect(hints[0]).toContain('직업이 "마피아"로 모두에게 공개');
    expect(hints[1]).toContain("직업을 부정하지 마세요");
    expect(w.text).toBe("결국 들켰네요.");

    const good = { speak: async () => ({ text: "잘 찾아내셨네요.", emotion: "smug" as const }) } as unknown as ReturnType<typeof makeAI>;
    expect((await speakLastWords(good, fallback, s, mafia)).text).toBe("잘 찾아내셨네요.");
  });
});

describe("first-night rules and pressing", () => {
  it("flags talk about first-night protection or a first-night investigation ban", async () => {
    const { ruleViolations } = await import("./context");
    expect(ruleViolations("의사라고 했으니 첫 밤 보호 선택은 확인이 안 되지만")).toHaveLength(1);
    expect(ruleViolations("1일차 밤엔 조사 불가라고 했잖아")).toHaveLength(1);
    expect(ruleViolations("첫 밤에는 보호가 없으니 의사 주장은 아직 확인할 게 없네")).toHaveLength(0);
    expect(ruleViolations("어젯밤 도윤님이 죽었으니 의사가 못 지킨 거네")).toHaveLength(0);
  });

  it("rewrites a line that mentions first-night protection", async () => {
    const orig = globalThis.fetch;
    const replies = ["[suspicious] 첫 밤 보호 선택은 확인이 안 되지만 지켜볼게요.", "[suspicious] 의사 주장은 둘째 밤부터 지켜볼게요."];
    let n = 0;
    let last = "";
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      last = JSON.parse(init.body as string).contents[0].parts[0].text;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: replies[Math.min(n++, 1)] }] } }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const ai = makeAI({ ...DEFAULT_SETTINGS, mode: "api", provider: "gemini", geminiKey: "k" }, () => {});
      const said = await ai.speak(createGame("나"), createGame("나").players[2]);
      expect(n).toBe(2);
      expect(last).toContain("첫 밤에는 의사의 보호 행동 자체가 없습니다");
      expect(said.text).toBe("의사 주장은 둘째 밤부터 지켜볼게요.");
    } finally { globalThis.fetch = orig; }
  });

  it("offline replies to pressing defend statements, not night actions", async () => {
    const ai = makeAI(DEFAULT_SETTINGS, () => {});
    const s = createGame("나");
    for (let i = 0; i < 5; i++) {
      const r = await ai.speak(s, s.players[1], "[질문] 플레이어가 당신의 발언이 의심된다고 추궁했습니다.");
      expect(r.text).not.toMatch(/그 시간|쉬고 있었|자고 있었/);
    }
  }, 30000);
});

describe("build info", () => {
  it("formats the update time in Korean time", async () => {
    const { formatKST, BUILD_LABEL } = await import("./buildInfo");
    expect(formatKST("2026-11-13T02:20:00Z")).toBe("2026.11.13 11:20");
    expect(formatKST("")).toBe("-");
    expect(BUILD_LABEL).toContain("업데이트");
  });
});

describe("conversation director", () => {
  it("lets the addressed person answer next", async () => {
    const { nextTurn } = await import("./director");
    let s = createGame("나");
    s = addMsg(s, 1, "태오, 아까 한 말 설명해 봐.", "day");
    const t = nextTurn(s)!;
    expect(t.player.id).toBe(7);
    expect(t.reason).toBe("addressed");
    expect(t.hint).toContain("[응답]");
  });

  it("lets the suspected person push back", async () => {
    const { nextTurn } = await import("./director");
    let s = createGame("나");
    s = addMsg(s, 2, "솔직히 민재가 제일 수상해.", "day");
    const t = nextTurn(s)!;
    expect(t.player.id).toBe(5);
    expect(t.reason).toBe("accused");
  });

  it("otherwise picks a living AI who did not just speak", async () => {
    const { nextTurn } = await import("./director");
    let s = createGame("나");
    s = kill(s, 3, false);
    s = addMsg(s, 1, "다들 어떻게 생각해요", "day");
    s = addMsg(s, 2, "음 글쎄", "day");
    for (let i = 0; i < 30; i++) {
      const t = nextTurn(s)!;
      expect([1, 2, 3, 0]).not.toContain(t.player.id);
      expect(t.hint).toContain("되풀이하지 마세요");
    }
  });

  it("opener mentions the night result once and only one person opens", async () => {
    const { openerTurn } = await import("./director");
    const s = { ...createGame("나"), phase: "day" as const, lastNightResult: "첫 밤은 조용히 지나갔습니다." };
    const t = openerTurn(s)!;
    expect(t.reason).toBe("opener");
    expect(t.hint).toContain("첫 밤은 조용히 지나갔습니다.");
    expect(t.hint).toContain("한 번만");
  });

  it("offline opener and reactions do not repeat the 'first day, no clues' line for everyone", async () => {
    const { nextTurn, openerTurn } = await import("./director");
    const ai = makeAI(DEFAULT_SETTINGS, () => {});
    let s: ReturnType<typeof createGame> = { ...createGame("나"), phase: "day", lastNightResult: "첫 밤은 조용히 지나갔습니다." };
    const op = openerTurn(s)!;
    const first = await ai.speak(s, op.player, op.hint);
    s = addMsg(s, op.player.id, first.text, "day");
    let mentions = /첫 밤|첫날|단서가 없/.test(first.text) ? 1 : 0;
    for (let i = 0; i < 5; i++) {
      const t = nextTurn(s)!;
      const said = await ai.speak(s, t.player, t.hint);
      s = addMsg(s, t.player.id, said.text, "day");
      if (/첫 밤|첫날|단서가 없/.test(said.text)) mentions++;
    }
    expect(mentions).toBeLessThanOrEqual(1);
  }, 30000);
});

describe("auto-speech for the player, directed talk, in-world wording", () => {
  it("speaks for the player when addressed, only if allowed", async () => {
    const { nextTurn } = await import("./director");
    let s = createGame("나");
    s = addMsg(s, 1, "나님, 아까 한 말 무슨 뜻이에요?", "day");
    const on = nextTurn(s, Math.random, { allowHuman: true })!;
    expect(on.player.id).toBe(0);
    expect(on.proxy).toBe(true);
    expect(on.hint).toContain("[대리]");
    expect(on.hint).toContain("직업, 조사 결과");
    for (let i = 0; i < 20; i++) expect(nextTurn(s, Math.random, { allowHuman: false })!.player.id).not.toBe(0);
  });

  it("sometimes lets the player chime in during free talk", async () => {
    const { nextTurn } = await import("./director");
    let s = createGame("나");
    s = addMsg(s, 1, "다들 어떻게 봐요", "day");
    s = addMsg(s, 2, "음 글쎄", "day");
    let human = 0;
    for (let i = 0; i < 200; i++) if (nextTurn(s, Math.random, { allowHuman: true })!.player.id === 0) human++;
    expect(human).toBeGreaterThan(5);
  });

  it("offline proxy lines never reveal role or reports", async () => {
    const { interpretByRules } = await import("./context");
    const { proxyHint } = await import("./director");
    const ai = makeAI(DEFAULT_SETTINGS, () => {});
    let s = createGame("나");
    s = { ...s, day: 3, players: s.players.map((p) => (p.id === 0 ? { ...p, role: "police" as const } : p)), policeLog: { 0: [{ target: 1, isMafia: true, day: 1 }] } };
    for (let i = 0; i < 8; i++) {
      const said = await ai.speak(s, s.players[0], proxyHint(s, "[반응:서연] 직전 발언에 반응하세요."));
      const m = interpretByRules(said.text, s.players, 0);
      expect(m.claim).toBeUndefined();
      expect(m.reports).toBeUndefined();
    }
  }, 30000);

  it("flags out-of-world words and keeps them out of the prompt headers", async () => {
    const { ruleViolations } = await import("./context");
    expect(ruleViolations("서연님, 3일차 기록 보자는 건 좋은데")).toHaveLength(1);
    expect(ruleViolations("어제 투표에서 서연님이 태오를 찍었죠")).toHaveLength(0);
    const orig = globalThis.fetch;
    let user = "";
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      user = JSON.parse(init.body as string).contents[0].parts[0].text;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "[neutral] 네." }] } }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const ai = makeAI({ ...DEFAULT_SETTINGS, mode: "api", provider: "gemini", geminiKey: "k" }, () => {});
      await ai.speak(createGame("나"), createGame("나").players[1]);
      expect(user).not.toContain("[공개 대화 기록]");
      expect(user).not.toContain("상황판");
      expect(user).toContain("[지금까지 일어난 일]");
    } finally { globalThis.fetch = orig; }
  });
});

describe("no circular conversations", () => {
  it("breaks a two-person ping-pong by bringing in someone else", async () => {
    const { nextTurn } = await import("./director");
    let s = createGame("나");
    s = addMsg(s, 7, "하은, 서연이 3일차 얘기 피하는 거 이상하지 않아?", "day");
    s = addMsg(s, 3, "태오님, 저는 아직 판단이 조심스러워요.", "day");
    s = addMsg(s, 7, "하은, 그래도 서연 얘기는 넘기기 어렵잖아.", "day");
    for (let i = 0; i < 20; i++) {
      const t = nextTurn(s, Math.random, { allowHuman: true })!;
      expect([7, 3]).not.toContain(t.player.id);
      expect(t.hint).toContain("[전환]");
    }
  });

  it("asks to move on when one person's topic keeps coming up", async () => {
    const { nextTurn } = await import("./director");
    let s = createGame("나");
    s = addMsg(s, 2, "서연이 수상해", "day");
    s = addMsg(s, 4, "서연 말은 좀 이상했지", "day");
    s = addMsg(s, 6, "서연은 아직 모르겠어요", "day");
    s = addMsg(s, 5, "음", "day");
    expect(nextTurn(s)!.hint).toContain("서연 이야기는 이미 충분히");
  });

  it("measures near-duplicate lines", async () => {
    const { similarity, isRepetitive } = await import("./context");
    expect(similarity("서연 얘기를 계속 피하는 건 넘기기 어렵잖아", "서연이 얘기를 계속 피하는 건 그냥 넘기기 어렵잖아")).toBeGreaterThan(0.45);
    expect(similarity("오늘은 민재 쪽을 보자", "서연 얘기를 계속 피하는 건 넘기기 어렵잖아")).toBeLessThan(0.2);
    let s = createGame("나");
    s = addMsg(s, 7, "서연이 3일차 얘기만 계속 피하는 건 그냥 넘기기 어렵잖아.");
    expect(isRepetitive(s, 3, "서연이 3일차 얘기를 계속 피하는 건 넘기기 어렵잖아요.")).toBe(true);
    expect(isRepetitive(s, 3, "그 얘기는 이쯤 하고 민재님도 보고 싶어요.")).toBe(false);
  });

  it("rewrites a line that repeats what was just said", async () => {
    const orig = globalThis.fetch;
    const replies = ["[suspicious] 서연이 3일차 얘기를 계속 피하는 건 넘기기 어렵잖아요.", "[neutral] 그 얘기는 충분히 했으니 민재님 생각도 듣고 싶어요."];
    let n = 0;
    globalThis.fetch = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: replies[Math.min(n++, 1)] }] } }] }), { status: 200 })) as typeof fetch;
    try {
      const ai = makeAI({ ...DEFAULT_SETTINGS, mode: "api", provider: "gemini", geminiKey: "k" }, () => {});
      let s = createGame("나");
      s = addMsg(s, 7, "서연이 3일차 얘기만 계속 피하는 건 그냥 넘기기 어렵잖아.");
      const said = await ai.speak(s, s.players[3]);
      expect(n).toBe(2);
      expect(said.text).toBe("그 얘기는 충분히 했으니 민재님 생각도 듣고 싶어요.");
    } finally { globalThis.fetch = orig; }
  });
});

describe("trust is not an accusation", () => {
  it("does not make the trusted person defend themselves", async () => {
    const { nextTurn } = await import("./director");
    let s = createGame("나");
    s = addMsg(s, 6, "하은님은 시민 쪽으로 보고 있어요. 의심은 다른 쪽에 두겠습니다.", "day");
    for (let i = 0; i < 20; i++) expect(nextTurn(s)!.reason).not.toBe("accused");
  });
});

describe("doctor reports are not police reports", () => {
  const players = createGame("나").players;
  it("reads 'I protected X' as a doctor save, not an investigation", async () => {
    const { interpretByRules } = await import("./context");
    const m = interpretByRules("나 의사인데 서연 보호했어, 마피아 아닌거 확인함", players, 0);
    expect(m.claim).toBe("doctor");
    expect(m.saves).toEqual([{ target: 1 }]);
    expect(m.reports).toBeUndefined();
    const later = interpretByRules("어젯밤 도윤 살렸어. 그러니까 도윤은 마피아 아님", players, 0, false, true);
    expect(later.saves).toEqual([{ target: 2 }]);
    expect(later.reports).toBeUndefined();
    // 경찰 보고는 그대로
    expect(interpretByRules("조사해보니 도윤 시민", players, 0).reports).toEqual([{ target: 2, result: "clean" }]);
  });

  it("explains the doctor's deduction when the morning confirms a save", async () => {
    const { factsBlock, deductions } = await import("./context");
    let s = { ...createGame("나"), day: 2 };
    s = addMsg(s, "system", "2일차 낮이 밝았습니다. 밤사이 아무도 죽지 않았습니다.", "day");
    s = addMsg(s, 0, "저는 의사예요. 어젯밤 서연 보호했어요.", "day");
    expect(factsBlock(s)).toContain("경찰 조사가 아님");
    expect(deductions(s).join(" ")).toContain("의사의 추론이지 경찰의 조사가 아니다");
  });

  it("records protection and mafia attack results", async () => {
    const { resolveNight } = await import("./engine");
    const s = { ...createGame("나"), day: 2 };
    const doc = s.players.find((p) => p.role === "doctor")!;
    const target = s.players.find((p) => p.role === "citizen")!;
    const r = resolveNight(s, { kill: target.id, protect: target.id, protector: doc.id, investigate: null });
    expect(r.state.doctorLog[doc.id]).toEqual([{ day: 2, target: target.id, quiet: true }]);
    expect(r.state.mafiaLog).toEqual([{ day: 2, target: target.id, result: "failed" }]);
    expect(r.result).toBe("밤사이 아무도 죽지 않았습니다.");
  });

  it("offline AIs: the real doctor objects, the saved person thanks, nobody asks how the 'investigation' was done", async () => {
    const ai = makeAI(DEFAULT_SETTINGS, () => {});
    const s = createGame("나");
    const doctor = s.players.find((p) => p.role === "doctor" && !p.isHuman);
    const saved = s.players.find((p) => !p.isHuman && p.role !== "mafia" && p.role !== "doctor")!;
    const hint = `[의사보고:${saved.id}:saved] 플레이어가 의사라며 보호했다고 말했습니다.`;
    if (doctor) expect((await ai.speak(s, doctor, hint)).text).toMatch(/의사는 (나|저)/);
    expect((await ai.speak(s, saved, hint)).text).toMatch(/고마|감사|덕분/);
    const observer = s.players.find((p) => !p.isHuman && p.id !== saved.id && p.role !== "doctor")!;
    for (let i = 0; i < 4; i++) expect((await ai.speak(s, observer, hint)).text).not.toMatch(/조사|경찰이/);
  }, 30000);
});

describe("role-based reasoning notes", () => {
  it("police remember their results and spot a fake police claim", async () => {
    const { reasoningNotes } = await import("./context");
    let s = createGame("나");
    const police = s.players.find((p) => p.role === "police" && !p.isHuman) ?? s.players.find((p) => p.role === "police")!;
    const other = s.players.find((p) => p.id !== police.id && !p.isHuman)!;
    s = { ...s, policeLog: { [police.id]: [{ target: other.id, isMafia: false, day: 1 }] } };
    const faker = s.players.find((p) => p.id !== police.id && p.id !== other.id && !p.isHuman)!;
    s = addMsg(s, faker.id, "제가 경찰입니다.");
    const notes = reasoningNotes(s, s.players[police.id]).join(" ");
    expect(notes).toContain(`${other.name}은(는) 마피아가 아니다(확실)`);
    expect(notes).toContain(`${faker.name}은(는) 경찰을 주장하지만 진짜 경찰은 나다`);
  });

  it("doctor and mafia know what happened at night", async () => {
    const { reasoningNotes } = await import("./context");
    let s = { ...createGame("나"), day: 2 };
    const doc = s.players.find((p) => p.role === "doctor")!;
    const mafia = s.players.find((p) => p.role === "mafia")!;
    const t = s.players.find((p) => p.role === "citizen")!;
    s = { ...s, doctorLog: { [doc.id]: [{ day: 2, target: t.id, quiet: true }] }, mafiaLog: [{ day: 2, target: t.id, result: "failed" }] };
    expect(reasoningNotes(s, doc).join(" ")).toContain("군인이 버텼을 수도 있어 확실하지 않다");
    expect(reasoningNotes(s, mafia).join(" ")).toContain("어느 쪽인지는 모른다");
  });

  it("the notes reach the model in the system prompt", async () => {
    const orig = globalThis.fetch;
    let system = "";
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      system = JSON.parse(init.body as string).systemInstruction.parts[0].text;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "[neutral] 네." }] } }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const ai = makeAI({ ...DEFAULT_SETTINGS, mode: "api", provider: "gemini", geminiKey: "k" }, () => {});
      let s = createGame("나");
      const police = s.players.find((p) => p.role === "police")!;
      s = { ...s, policeLog: { [police.id]: [{ target: (police.id % 7) + 1, isMafia: true, day: 1 }] } };
      await ai.speak(s, s.players[police.id === 0 ? 1 : police.id]);
      if (police.id !== 0) expect(system).toContain("[당신의 추리 메모");
      expect(system).toContain("의사의 보호 보고는 경찰 조사가 아니다");
      expect(system).toContain("추리하며 말하기");
    } finally { globalThis.fetch = orig; }
  });
});

describe("goals, hidden roles, abstaining", () => {
  it("each AI knows its team's goal and that roles are hidden", async () => {
    const orig = globalThis.fetch;
    let system = "";
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      system = JSON.parse(init.body as string).systemInstruction.parts[0].text;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"vote": null}' }] } }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const ai = makeAI({ ...DEFAULT_SETTINGS, mode: "api", provider: "gemini", geminiKey: "k" }, () => {});
      const s = createGame("나");
      const citizen = s.players.find((p) => !p.isHuman && p.role !== "mafia")!;
      expect(await ai.vote(s, citizen)).toBeNull();
      expect(system).toContain("마피아 2명을 모두 찾아 처형해야 승리");
      expect(system).toContain("마피아끼리만 서로 안다");
      expect(system).toContain("기권해도 된다");
      const mafia = s.players.find((p) => !p.isHuman && p.role === "mafia")!;
      await ai.vote(s, mafia);
      expect(system).toContain("마피아 수가 시민 팀 수와 같아지면 승리");
    } finally { globalThis.fetch = orig; }
  });

  it("offline citizens abstain when there is no real suspect", async () => {
    const ai = makeAI(DEFAULT_SETTINGS, () => {});
    let abstain = 0;
    for (let i = 0; i < 6; i++) {
      const s = createGame("나");
      for (const p of s.players.filter((x) => !x.isHuman && x.role !== "mafia")) if ((await ai.vote(s, p)) === null) abstain++;
    }
    expect(abstain).toBeGreaterThan(0);
  }, 30000);
});

describe("in-app API self test", () => {
  it("runs all scenarios with the offline AI and the deterministic checks pass", async () => {
    const { runSelfTest } = await import("./selftest");
    const ai = makeAI(DEFAULT_SETTINGS, () => {});
    const seen: string[] = [];
    const results = await runSelfTest(ai, ai, "나", (r) => seen.push(r.title));
    expect(results).toHaveLength(8);
    expect(seen).toHaveLength(8);
    for (const idx of [1, 2, 4, 5, 7]) {
      for (const c of results[idx].checks) expect(`${results[idx].title} / ${c.label}: ${c.ok}`).toContain(": true");
    }
  }, 60000);
});

describe("obvious remarks, repeated interrogation, mentions vs addressing", () => {
  it("does not treat a mention as addressing", async () => {
    const { addresseeOf } = await import("./context");
    let s = createGame("나");
    s = addMsg(s, 6, "도윤님이 죽었다니 믿기지가 않아요... 서연님에 이어 또 한 명이 가다니");
    s = addMsg(s, 6, "태오야 너는 어떻게 생각해?");
    s = addMsg(s, 6, "서연님 어제 누구 찍으셨어요?");
    expect(addresseeOf(s, s.log[0])).toBeNull();
    expect(addresseeOf(s, s.log[1])).toBe(7);
    expect(addresseeOf(s, s.log[2])).toBe(1);
  });

  it("flags stating the obvious about mafia targets", async () => {
    const { ruleViolations } = await import("./context");
    expect(ruleViolations("마피아가 노리는 사람이 계속 시민 쪽 같아서 더 답답하네요.")).toHaveLength(1);
    expect(ruleViolations("마피아가 시민만 노리는 것 같아요")).toHaveLength(1);
    expect(ruleViolations("도윤이 어제 태오를 의심했는데 바로 당했네요.")).toHaveLength(0);
  });

  it("flags asking the same person the same thing again the same day", async () => {
    const { repeatsQuestion } = await import("./context");
    let s = { ...createGame("나"), day: 2 };
    s = addMsg(s, 7, "하은, 어제 왜 서연한테 투표했어?", "day");
    s = addMsg(s, 3, "그냥 느낌이었어요...", "day");
    expect(repeatsQuestion(s, 2, "하은님, 어제 왜 서연한테 투표하셨어요?")).toBe(true);
    expect(repeatsQuestion(s, 2, "하은님 대답은 들었으니, 민재님 생각은 어때요?")).toBe(false);
    expect(repeatsQuestion(s, 2, "민재님은 어제 누구 찍었어요?")).toBe(false);
  });
});

describe("abstain when unsure", () => {
  it("offline citizens abstain on a day with no evidence at all", async () => {
    const ai = makeAI(DEFAULT_SETTINGS, () => {});
    for (let i = 0; i < 3; i++) {
      const s = createGame("나");
      for (const p of s.players.filter((x) => !x.isHuman && x.role !== "mafia")) expect(await ai.vote(s, p)).toBeNull();
    }
  }, 30000);

  it("but they do vote when there is a real reason", async () => {
    const ai = makeAI(DEFAULT_SETTINGS, () => {});
    let s = createGame("나");
    const target = s.players.find((p) => !p.isHuman && p.role === "mafia")!;
    s = addMsg(s, 0, `저는 경찰입니다. 조사해 보니 ${target.name}님은 마피아입니다.`);
    s = addMsg(s, 2, `${target.name} 정말 수상해요. 마피아 같아요.`);
    const citizens = s.players.filter((p) => !p.isHuman && p.role !== "mafia" && p.id !== 2);
    let votedTarget = 0;
    for (const p of citizens) if ((await ai.vote(s, p)) === target.id) votedTarget++;
    expect(votedTarget).toBeGreaterThan(0);
  }, 30000);

  it("a low-confidence model vote becomes an abstention", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"vote": 3, "confidence": 40, "reason": "그냥 느낌"}' }] } }] }), { status: 200 })) as typeof fetch;
    try {
      const ai = makeAI({ ...DEFAULT_SETTINGS, mode: "api", provider: "gemini", geminiKey: "k" }, () => {});
      const s = createGame("나");
      expect(await ai.vote(s, s.players.find((p) => !p.isHuman && p.role !== "mafia")!)).toBeNull();
    } finally { globalThis.fetch = orig; }
  });
});

describe("morning announcement hides why nobody died", () => {
  it("doctor save and soldier shield produce the same message", async () => {
    const { resolveNight } = await import("./engine");
    const s = { ...createGame("나"), day: 2 };
    const doc = s.players.find((p) => p.role === "doctor")!;
    const soldier = s.players.find((p) => p.role === "soldier")!;
    const citizen = s.players.find((p) => p.role === "citizen")!;
    const saved = resolveNight(s, { kill: citizen.id, protect: citizen.id, protector: doc.id, investigate: null });
    const shielded = resolveNight(s, { kill: soldier.id, protect: citizen.id, protector: doc.id, investigate: null });
    expect(saved.result).toBe("밤사이 아무도 죽지 않았습니다.");
    expect(shielded.result).toBe("밤사이 아무도 죽지 않았습니다.");
    expect(shielded.state.players[soldier.id].shield).toBe(false);
    // 의사는 둘 다 "그 밤 아무도 죽지 않음"까지만 안다
    expect(saved.state.doctorLog[doc.id]).toEqual([{ day: 2, target: citizen.id, quiet: true }]);
    expect(shielded.state.doctorLog[doc.id]).toEqual([{ day: 2, target: citizen.id, quiet: true }]);
    // 마피아도 실패 이유는 모른다
    expect(saved.state.mafiaLog[0].result).toBe("failed");
    expect(shielded.state.mafiaLog[0].result).toBe("failed");
  });

  it("everyone is told that the reason is unknown", async () => {
    const { deductions } = await import("./context");
    let s = { ...createGame("나"), day: 2 };
    s = addMsg(s, "system", "2일차 낮이 밝았습니다. 밤사이 아무도 죽지 않았습니다.", "day");
    expect(deductions(s).join(" ")).toContain("어느 쪽인지는 아무도 모른다");
  });
});
