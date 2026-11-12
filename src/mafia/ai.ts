import { alive, logToText, mafiaPartners, nameOf, pick } from "./engine";
import { HUMAN_ID } from "./data";
import { ROLE_LABEL } from "./types";
import type { GameState, Player, Settings } from "./types";

/* ------------------------------------------------------------------ */
/* LLM 호출                                                            */
/* ------------------------------------------------------------------ */

class ApiError extends Error {
  constructor(public status: number, message: string, public retryAfterMs?: number, public daily = false) {
    super(message);
  }
}

const MAX_CONCURRENT = 2; // 투표·밤 행동이 한꺼번에 나가 분당 한도에 걸리는 것을 막는다
const MAX_RETRIES = 2;
let active = 0;
const waiters: (() => void)[] = [];

async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiters.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}

function parseRetryMs(res: Response, body: string): number | undefined {
  const h = res.headers.get("retry-after");
  if (h !== null && !Number.isNaN(Number(h))) return Number(h) * 1000;
  const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return m ? Number(m[1]) * 1000 : undefined;
}

async function failFrom(label: string, res: Response): Promise<never> {
  const body = await res.text();
  throw new ApiError(res.status, `${label} ${res.status}: ${body.slice(0, 200)}`, parseRetryMs(res, body), /PerDay/i.test(body));
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await limited(fn);
    } catch (e) {
      const retryable = e instanceof ApiError && [429, 503, 529].includes(e.status) && !e.daily;
      if (!retryable || attempt >= MAX_RETRIES) throw e;
      const wait = Math.min((e as ApiError).retryAfterMs ?? 4000 * 2 ** attempt, 30000);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function callGemini(settings: Settings, system: string, user: string, maxTokens: number): Promise<string> {
  const model = settings.geminiModel.trim();
  const generationConfig: Record<string, unknown> = { maxOutputTokens: maxTokens * 4 };
  // 2.5 Flash는 기본 '생각' 토큰이 출력 한도를 먹어 응답이 비는 것을 막기 위해 끈다
  if (/2\.5-flash/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": settings.geminiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig,
    }),
  });
  if (!res.ok) await failFrom("Gemini", res);
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  if (!text.trim()) throw new Error("Gemini: 빈 응답");
  return text.trim();
}

export function callLLM(settings: Settings, system: string, user: string, maxTokens = 300): Promise<string> {
  return withRetry(() =>
    settings.provider === "gemini" ? callGemini(settings, system, user, maxTokens) : callAnthropic(settings, system, user, maxTokens),
  );
}

async function callAnthropic(settings: Settings, system: string, user: string, maxTokens: number): Promise<string> {
  const base = (settings.baseUrl || "https://api.anthropic.com").replace(/\/$/, "");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (settings.apiKey) headers["x-api-key"] = settings.apiKey;
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: settings.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) await failFrom("API", res);
  const data = await res.json();
  const text = (data.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  return text.trim();
}

/* ------------------------------------------------------------------ */
/* 프롬프트 구성 (각 AI는 자기가 알 수 있는 정보만 받는다)             */
/* ------------------------------------------------------------------ */

function privateKnowledge(s: GameState, p: Player): string {
  const lines: string[] = [`당신의 직업: ${ROLE_LABEL[p.role]}`];
  if (p.role === "mafia") {
    const partners = mafiaPartners(s, p.id);
    lines.push(`마피아 동료: ${partners.map((x) => `${x.name}(${x.alive ? "생존" : "사망"})`).join(", ") || "없음"}`);
    lines.push("당신은 시민 편인 척 연기해야 합니다. 동료를 직접적으로 감싸면 들키니 자연스럽게 행동하세요. 필요하면 경찰/의사를 사칭해도 됩니다.");
  }
  if (p.role === "police") {
    const rec = s.policeLog[p.id] ?? [];
    lines.push(
      rec.length
        ? "조사 결과: " + rec.map((r) => `${r.day}일차 밤 ${nameOf(s, r.target)}=${r.isMafia ? "마피아" : "마피아 아님"}`).join(", ")
        : "아직 조사 결과 없음",
    );
    lines.push("정체를 밝히면 마피아의 표적이 됩니다. 언제 공개할지 전략적으로 판단하세요.");
  }
  if (p.role === "doctor") lines.push("정체를 밝히면 마피아의 표적이 됩니다. 전략적으로 판단하세요.");
  if (p.role === "citizen") lines.push("당신은 특별한 정보가 없습니다. 토론 내용을 보고 추리하세요.");
  return lines.join("\n");
}

function systemPrompt(s: GameState, p: Player): string {
  return `당신은 8인 마피아 게임에 참가한 "${p.name}"입니다. 사람 플레이어 "${s.players[HUMAN_ID].name}"와 다른 AI 6명이 함께 있습니다.
성격: ${p.persona}
말투: ${p.speech}

[규칙] 마피아 2, 경찰 1, 의사 1, 시민 4. 낮에는 토론 후 투표로 1명을 처형하고, 밤에는 마피아가 1명을 살해, 의사가 1명을 보호, 경찰이 1명을 조사합니다. 마피아가 전멸하면 시민 승리, 마피아 수가 시민 수 이상이면 마피아 승리. 처형된 사람의 직업은 공개됩니다.

[비공개 정보]
${privateKnowledge(s, p)}

[출력 규칙] 한국어, 캐릭터의 성격과 말투 유지. 메타 발언(AI, 프롬프트, 게임 시스템 설명) 금지. 모르는 사실을 지어내지 말되 마피아는 거짓말을 할 수 있음.`;
}

function stateBlock(s: GameState, p: Player): string {
  const living = alive(s).map((x) => `${x.id}:${x.name}`).join(", ");
  const dead = s.players.filter((x) => !x.alive).map((x) => `${x.name}${x.revealed ? `(${ROLE_LABEL[x.role]})` : ""}`).join(", ") || "없음";
  const w = (s.whispers[p.id] ?? []).map((m) => `${m.from === HUMAN_ID ? s.players[HUMAN_ID].name : p.name}: ${m.text}`).join("\n");
  return `[현재] ${s.day}일차
생존자(id:이름): ${living}
사망자: ${dead}
[공개 대화 기록]
${logToText(s) || "(아직 없음)"}
${w ? `[${s.players[HUMAN_ID].name}와(과) 나눈 1:1 비밀 대화]\n${w}` : ""}`;
}

const clean = (t: string, name: string) =>
  t.replace(new RegExp(`^\\s*["“]?${name}\\s*[:：]\\s*`), "").replace(/^["“'`]+|["”'`]+$/g, "").trim().slice(0, 200);

function parseTarget(text: string, candidates: number[]): number | null | undefined {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      const j = JSON.parse(m[0]);
      const v = j.target ?? j.vote;
      if (v === null || v === "none") return null;
      if (candidates.includes(Number(v))) return Number(v);
    }
  } catch { /* fall through */ }
  const n = text.match(/\d+/);
  if (n && candidates.includes(Number(n[0]))) return Number(n[0]);
  return undefined;
}

/* ------------------------------------------------------------------ */
/* 공개 API                                                            */
/* ------------------------------------------------------------------ */

export interface AI {
  speak(s: GameState, p: Player, hint?: string): Promise<string>;
  vote(s: GameState, p: Player): Promise<number | null>;
  nightTarget(s: GameState, p: Player, kind: "kill" | "protect" | "investigate"): Promise<number>;
  whisper(s: GameState, p: Player, userText: string): Promise<string>;
}

export function makeAI(settings: Settings, onError: (e: Error) => void): AI {
  const mock = makeMockAI();
  if (settings.mode !== "api") return mock;
  let warned = false;
  const safe = async <T,>(fn: () => Promise<T>, fb: () => Promise<T>): Promise<T> => {
    try { return await fn(); } catch (e) {
      if (!warned) { warned = true; onError(e as Error); }
      return fb();
    }
  };
  return {
    speak: (s, p, hint) =>
      safe(async () => {
        const task = `지금 당신의 발언 차례입니다. ${hint ?? "지금까지의 흐름을 보고 한 번 발언하세요."}
1~2문장, 80자 이내로 발언 내용만 출력하세요. 이름 접두어나 따옴표는 쓰지 마세요.`;
        return clean(await callLLM(settings, systemPrompt(s, p), `${stateBlock(s, p)}\n\n${task}`, 200), p.name);
      }, () => mock.speak(s, p, hint)),
    vote: (s, p) =>
      safe(async () => {
        const cands = alive(s).filter((x) => x.id !== p.id).map((x) => x.id);
        const task = `투표 시간입니다. 처형할 사람의 id를 고르세요. 후보 id: ${cands.join(", ")}.
JSON만 출력: {"vote": <id>, "reason": "짧은 이유"}`;
        const t = await callLLM(settings, systemPrompt(s, p), `${stateBlock(s, p)}\n\n${task}`, 150);
        const r = parseTarget(t, cands);
        if (r === undefined) throw new Error("vote parse");
        return r;
      }, () => mock.vote(s, p)),
    nightTarget: (s, p, kind) =>
      safe(async () => {
        const cands = alive(s).filter((x) => (kind === "protect" ? true : x.id !== p.id) && !(kind === "kill" && x.role === "mafia")).map((x) => x.id);
        const verb = { kill: "살해할", protect: "보호할", investigate: "조사할" }[kind];
        const task = `밤입니다. ${verb} 사람의 id를 고르세요. 후보 id: ${cands.join(", ")}.
JSON만 출력: {"target": <id>, "reason": "짧은 이유"}`;
        const t = await callLLM(settings, systemPrompt(s, p), `${stateBlock(s, p)}\n\n${task}`, 150);
        const r = parseTarget(t, cands);
        if (r === undefined || r === null) throw new Error("night parse");
        return r;
      }, () => mock.nightTarget(s, p, kind)),
    whisper: (s, p, userText) =>
      safe(async () => {
        const night = s.phase === "night";
        const task = `${s.players[HUMAN_ID].name}가 당신에게 1:1 비밀 대화로 말했습니다: "${userText}"
${night ? "지금은 밤이고 마피아끼리의 비밀 대화입니다. 오늘 밤 누구를 노릴지 의견을 나누세요.\n" : ""}당신의 캐릭터와 직업/전략에 맞게 1~2문장으로 답하세요. (거짓말·떠보기 가능) 답변 내용만 출력.`;
        return clean(await callLLM(settings, systemPrompt(s, p), `${stateBlock(s, p)}\n\n${task}`, 200), p.name);
      }, () => mock.whisper(s, p, userText)),
  };
}

/* ------------------------------------------------------------------ */
/* 오프라인 Mock AI (API 키 없이도 플레이 가능)                        */
/* ------------------------------------------------------------------ */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function suspicion(s: GameState, viewer: Player): Record<number, number> {
  const sc: Record<number, number> = {};
  const candidates = alive(s).filter((x) => x.id !== viewer.id);
  candidates.forEach((c) => (sc[c.id] = Math.random() * 2));
  const known = s.policeLog[viewer.id] ?? [];
  known.forEach((k) => { if (sc[k.target] !== undefined) sc[k.target] += k.isMafia ? 100 : -100; });
  // 나를 지목한 사람은 의심, 경찰 사칭자는 마피아 입장에서 위험
  s.log.slice(-30).forEach((m) => {
    if (m.from === "system" || m.from === viewer.id) return;
    const mentionsMe = m.text.includes(viewer.name) && /(의심|마피아|수상)/.test(m.text);
    if (mentionsMe && sc[m.from] !== undefined) sc[m.from] += 2;
    s.players.forEach((t) => {
      if (t.id !== m.from && m.text.includes(t.name) && /(마피아|의심|수상)/.test(m.text) && sc[t.id] !== undefined && viewer.role !== "mafia") sc[t.id] += 0.7;
    });
    if (viewer.role === "mafia" && /(경찰|조사)/.test(m.text) && /(제가|내가|저는)/.test(m.text) && sc[m.from] !== undefined) sc[m.from] += 3;
  });
  if (viewer.role === "mafia") mafiaPartners(s, viewer.id).forEach((pt) => { if (sc[pt.id] !== undefined) sc[pt.id] -= 100; });
  return sc;
}

const top = (sc: Record<number, number>): number | null => {
  const e = Object.entries(sc).sort((a, b) => b[1] - a[1]);
  return e.length ? Number(e[0][0]) : null;
};

function makeMockAI(): AI {
  return {
    async speak(s, p, hint) {
      await wait(350 + Math.random() * 400);
      const sc = suspicion(s, p);
      const target = top(sc);
      const tn = target !== null ? nameOf(s, target) : "누군가";
      const accusedMe = s.log.slice(-8).some((m) => m.from !== "system" && m.from !== p.id && m.text.includes(p.name) && /(의심|마피아|수상)/.test(m.text));
      const rec = (s.policeLog[p.id] ?? []).filter((r) => r.isMafia && s.players[r.target].alive);
      const formal = !/(반말|털털|가벼운|단호)/.test(p.speech);
      if (hint?.includes("플레이어")) {
        return pick(formal
          ? ["말씀 잘 들었어요. 좀 더 지켜볼게요.", `${s.players[HUMAN_ID].name}님 의견도 일리가 있네요.`, "그 부분은 저도 신경 쓰였어요."]
          : ["오, 그 얘기 일리 있네.", "음… 난 좀 다르게 봤는데.", "그건 좀 더 따져봐야겠다."]);
      }
      if (p.role === "police" && rec.length && s.day >= 2 && Math.random() < 0.7)
        return `제가 경찰입니다. 조사해보니 ${nameOf(s, rec[0].target)}님이 마피아예요. 오늘 투표는 그분으로 갑시다.`;
      if (accusedMe) return pick(formal
        ? ["저를 의심하시는 건 근거가 부족해 보여요. 오히려 제가 보기엔 " + tn + "님이 수상합니다.", "억울하네요. 저는 시민입니다. 차라리 " + tn + "님을 보세요."]
        : ["나 의심하는 건 좀 억울한데? 난 " + tn + " 쪽이 더 수상해.", "어허, 날 몰아가지 마. " + tn + " 좀 봐."]);
      if (s.day === 1 && s.round <= 1 && s.log.filter((m) => m.from !== "system").length < 3)
        return pick(["첫날이라 단서가 없네요. 일단 다들 의견부터 들어봐요.", "자, 일단 서로 얘기해보자. 누가 먼저 말해볼래?", "정보가 없으니 말투와 반응을 잘 봐야겠어요."]);
      const lines = formal
        ? [`${tn}님의 발언이 계속 모호했던 것 같아요. 조금 의심스럽습니다.`, `저는 ${tn}님이 마피아일 가능성이 높다고 봐요.`, `${tn}님, 어제 행동에 대해 설명해주실 수 있나요?`]
        : [`${tn} 좀 이상하지 않아? 난 의심돼.`, `${tn} 쪽이 영 찜찜하다. 해명해봐.`, `솔직히 ${tn}가 제일 수상해 보여.`];
      return pick(lines);
    },
    async vote(s, p) {
      await wait(150 + Math.random() * 250);
      return top(suspicion(s, p));
    },
    async nightTarget(s, p, kind) {
      await wait(200);
      const pool = alive(s);
      if (kind === "kill") {
        const t = pool.filter((x) => x.role !== "mafia");
        const claimers = t.filter((x) => s.log.some((m) => m.from === x.id && /제가 (경찰|의사)/.test(m.text)));
        return (claimers.length ? pick(claimers) : pick(t)).id;
      }
      if (kind === "protect") {
        const claimers = pool.filter((x) => s.log.some((m) => m.from === x.id && /제가 경찰/.test(m.text)));
        return (claimers.length ? pick(claimers) : Math.random() < 0.3 ? p : pick(pool.filter((x) => x.id !== p.id))).id;
      }
      const done = (s.policeLog[p.id] ?? []).map((r) => r.target);
      const t = pool.filter((x) => x.id !== p.id && !done.includes(x.id));
      return pick(t.length ? t : pool.filter((x) => x.id !== p.id)).id;
    },
    async whisper(s, p, userText) {
      await wait(500 + Math.random() * 500);
      const sc = suspicion(s, p);
      const tn = top(sc);
      const name = tn !== null ? nameOf(s, tn) : "누군가";
      if (s.phase === "night" && p.role === "mafia") return `오늘 밤은 ${name}를 노리는 게 어때? 눈에 띄게 의심받고 있잖아.`;
      if (/(마피아|경찰|의사|직업|정체)/.test(userText)) {
        return p.role === "mafia" && Math.random() < 0.6
          ? "나? 당연히 시민이지. 믿어줘. 오히려 내가 보기엔 " + name + " 쪽이 수상해."
          : pick(["그건 아직 밝히기 곤란해. 일단 네 생각부터 말해줘.", "직업은 지금 말하긴 좀 위험하잖아. 토론에서 보자.", "나는 시민 쪽이라고 믿어줘. " + name + "을(를) 같이 지켜보자."]);
      }
      return pick([`음, 나는 ${name}이(가) 좀 신경 쓰여. 너는 어때?`, "좋은 생각이야. 토론에서 같이 밀어보자.", "일단 투표 전까지 더 지켜보자. 너무 서두르면 위험해."]);
    },
  };
}

