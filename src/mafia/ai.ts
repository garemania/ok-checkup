import { alive, logToText, mafiaPartners, nameOf, pick } from "./engine";
import { HUMAN_ID } from "./data";
import { detectEmotion, parseSpoken } from "./emotion";
import { ROLE_LABEL } from "./types";
import type { Emotion, GameState, Player, Settings } from "./types";

export interface Spoken { text: string; emotion: Emotion }

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
      // 모델이 답 앞에 생각(thinking)을 쓰면 작은 한도가 다 소진돼 빈 응답이 올 수 있어 넉넉히 준다
      max_tokens: Math.max(maxTokens * 5, 1024),
      // Haiku 5.5는 생각이 기본 ON이라 짧은 답 대신 생각에 토큰을 다 써 빈 응답이 올 수 있다.
      // 이 모델에서만 생각을 끄고 effort를 낮춘다 (다른 모델은 이 값이 400일 수 있어 보내지 않는다)
      ...(/haiku-5/.test(settings.model) ? { thinking: { type: "disabled" }, output_config: { effort: "low" } } : {}),
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) await failFrom("API", res);
  const data = await res.json();
  const blocks: { type: string; text?: string }[] = data.content ?? [];
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
  if (!text) throw new Error(`Claude 빈 응답 (stop_reason=${data.stop_reason}, blocks=[${blocks.map((b) => b.type).join(",")}])`);
  return text;
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

[출력 규칙] 한국어, 캐릭터의 성격과 말투 유지. 실제 사람이 채팅하듯 자연스러운 구어체로 쓰고, 번역투·연극 톤·설명조는 피한다. 메타 발언(AI, 프롬프트, 게임 시스템 설명) 금지. 모르는 사실을 지어내지 말되 마피아는 거짓말을 할 수 있음.`;
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

/** id(숫자/문자열) 또는 이름으로 답해도 후보 중에서 대상을 찾아낸다. 못 찾으면 undefined */
export function parseTarget(text: string, candidates: number[], names: Record<number, string> = {}): number | null | undefined {
  const byName = (v: string): number | undefined => {
    const hit = candidates.filter((id) => names[id] && v.includes(names[id]));
    return hit.length === 1 ? hit[0] : undefined;
  };
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      const j = JSON.parse(m[0]);
      const v = j.target ?? j.vote;
      if (v === null || v === "none" || v === "기권") return null;
      if (candidates.includes(Number(v))) return Number(v);
      if (typeof v === "string") {
        const n = byName(v);
        if (n !== undefined) return n;
      }
    }
  } catch { /* JSON이 아니면 아래에서 텍스트로 찾는다 */ }
  const num = text.match(/"?(?:target|vote)"?\s*[:=]\s*"?(\d+)/i) ?? text.match(/^\s*(\d+)\s*$/);
  if (num && candidates.includes(Number(num[1]))) return Number(num[1]);
  const n = byName(text);
  if (n !== undefined) return n;
  const any = text.match(/\d+/);
  if (any && candidates.includes(Number(any[0]))) return Number(any[0]);
  return undefined;
}

/** 대상 선택 호출: 해석에 실패하면 형식을 다시 알려 주고 한 번 더 묻는다 */
async function askTarget(settings: Settings, s: GameState, p: Player, cands: number[], task: string, key: "vote" | "target"): Promise<number | null> {
  const names = Object.fromEntries(cands.map((id) => [id, s.players[id].name]));
  const list = cands.map((id) => `${id}:${names[id]}`).join(", ");
  const prompt = `${stateBlock(s, p)}\n\n${task}\n후보(id:이름): ${list}\n반드시 JSON 한 줄만 출력: {"${key}": <후보의 id 숫자>, "reason": "짧은 이유"}`;
  const first = await callLLM(settings, systemPrompt(s, p), prompt, 200);
  const r1 = parseTarget(first, cands, names);
  if (r1 !== undefined) return r1;
  const second = await callLLM(settings, systemPrompt(s, p), `${prompt}\n\n[이전 답변이 형식에 맞지 않았습니다] 위 후보 중 id 숫자 하나만 골라 {"${key}": 숫자} 형식으로만 답하세요.`, 200);
  const r2 = parseTarget(second, cands, names);
  if (r2 !== undefined) return r2;
  throw new Error(`${key} parse: ${second.slice(0, 200) || "(빈 응답)"}`);
}

/* ------------------------------------------------------------------ */
/* 공개 API                                                            */
/* ------------------------------------------------------------------ */

export interface AI {
  speak(s: GameState, p: Player, hint?: string): Promise<Spoken>;
  vote(s: GameState, p: Player): Promise<number | null>;
  nightTarget(s: GameState, p: Player, kind: "kill" | "protect" | "investigate"): Promise<number>;
  whisper(s: GameState, p: Player, userText: string): Promise<Spoken>;
}

const EMOTION_RULE = `발언 맨 앞에 지금 표정을 [감정] 태그로 붙이세요. 감정은 neutral, happy, angry, sad, surprised, suspicious, scared, smug 중 하나입니다. 예: [suspicious] 서연, 아까 말이 좀 이상했어.`;

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
1~2문장, 80자 이내로 발언 내용만 출력하세요. 이름 접두어나 따옴표는 쓰지 마세요.
${EMOTION_RULE}`;
        return parseSpoken(clean(await callLLM(settings, systemPrompt(s, p), `${stateBlock(s, p)}\n\n${task}`, 200), p.name));
      }, () => mock.speak(s, p, hint)),
    vote: (s, p) =>
      safe(async () => {
        const cands = alive(s).filter((x) => x.id !== p.id).map((x) => x.id);
        return askTarget(settings, s, p, cands, "투표 시간입니다. 처형할 사람을 고르세요. (기권하려면 null)", "vote");
      }, () => mock.vote(s, p)),
    nightTarget: (s, p, kind) =>
      safe(async () => {
        const cands = alive(s).filter((x) => (kind === "protect" ? true : x.id !== p.id) && !(kind === "kill" && x.role === "mafia")).map((x) => x.id);
        const verb = { kill: "살해할", protect: "보호할", investigate: "조사할" }[kind];
        const r = await askTarget(settings, s, p, cands, `밤입니다. ${verb} 사람을 고르세요.`, "target");
        if (r === null) throw new Error("target parse: null");
        return r;
      }, () => mock.nightTarget(s, p, kind)),
    whisper: (s, p, userText) =>
      safe(async () => {
        const night = s.phase === "night";
        const task = `${s.players[HUMAN_ID].name}가 당신에게 1:1 비밀 대화로 말했습니다: "${userText}"
${night ? "지금은 밤이고 마피아끼리의 비밀 대화입니다. 오늘 밤 누구를 노릴지 의견을 나누세요.\n" : ""}당신의 캐릭터와 직업/전략에 맞게 1~2문장으로 답하세요. (거짓말·떠보기 가능) 답변 내용만 출력.
${EMOTION_RULE}`;
        return parseSpoken(clean(await callLLM(settings, systemPrompt(s, p), `${stateBlock(s, p)}\n\n${task}`, 200), p.name));
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

/** 캐릭터별 오프라인 대사 (태오: 짧고 단정적인 평어체) */
function taeoLine(kind: "reply" | "police" | "accused" | "first" | "suspect", tn: string, extra = ""): string {
  const L = {
    reply: ["그 말은 일리 있다. 근거를 더 대봐.", "난 좀 다르게 본다. 투표 때 가려지겠지.", "일단 들었다. 네 말이 맞는지는 지켜본다."],
    police: [`내가 경찰이다. 조사했더니 ${extra}이(가) 마피아다. 오늘 표는 ${extra}한테 몰아.`],
    accused: ["날 의심하는 근거부터 대. 없으면 그냥 몰아가는 거잖아.", `나한테 화살 돌리지 마. 난 ${tn} 쪽이 더 이상하다.`],
    first: ["일단 한 명씩 입장부터 말해. 난 아직 의심할 근거는 없다.", "첫날이니까 말 아끼는 사람부터 본다. 다들 한마디씩 해."],
    suspect: [`${tn}, 아까 한 말 설명해봐. 영 석연치 않다.`, `내 표는 ${tn}한테 간다. 반박할 사람?`, `${tn} 발언이 계속 겉돌아. 난 의심한다.`],
  }[kind];
  return pick(L);
}

function makeMockAI(): AI {
  const raw = {
    async speak(s, p, hint) {
      await wait(350 + Math.random() * 400);
      const sc = suspicion(s, p);
      const target = top(sc);
      const tn = target !== null ? nameOf(s, target) : "누군가";
      const taeo = p.name === "태오";
      const accusedMe = s.log.slice(-8).some((m) => m.from !== "system" && m.from !== p.id && m.text.includes(p.name) && /(의심|마피아|수상)/.test(m.text));
      const rec = (s.policeLog[p.id] ?? []).filter((r) => r.isMafia && s.players[r.target].alive);
      const formal = !/(반말|털털|가벼운|단호)/.test(p.speech);
      if (hint?.includes("플레이어")) {
        if (taeo) return taeoLine("reply", tn);
        return pick(formal
          ? ["말씀 잘 들었어요. 좀 더 지켜볼게요.", `${s.players[HUMAN_ID].name}님 의견도 일리가 있네요.`, "그 부분은 저도 신경 쓰였어요."]
          : ["오, 그 얘기 일리 있네.", "음… 난 좀 다르게 봤는데.", "그건 좀 더 따져봐야겠다."]);
      }
      if (p.role === "police" && rec.length && s.day >= 2 && Math.random() < 0.7) {
        if (taeo) return taeoLine("police", tn, nameOf(s, rec[0].target));
        return `제가 경찰입니다. 조사해보니 ${nameOf(s, rec[0].target)}님이 마피아예요. 오늘 투표는 그분으로 갑시다.`;
      }
      if (taeo && accusedMe) return taeoLine("accused", tn);
      if (accusedMe) return pick(formal
        ? ["저를 의심하시는 건 근거가 부족해 보여요. 오히려 제가 보기엔 " + tn + "님이 수상합니다.", "억울하네요. 저는 시민입니다. 차라리 " + tn + "님을 보세요."]
        : ["나 의심하는 건 좀 억울한데? 난 " + tn + " 쪽이 더 수상해.", "어허, 날 몰아가지 마. " + tn + " 좀 봐."]);
      if (s.day === 1 && s.round <= 1 && s.log.filter((m) => m.from !== "system").length < 3) {
        if (taeo) return taeoLine("first", tn);
        return pick(["첫날이라 단서가 없네요. 일단 다들 의견부터 들어봐요.", "자, 일단 서로 얘기해보자. 누가 먼저 말해볼래?", "정보가 없으니 말투와 반응을 잘 봐야겠어요."]);
      }
      if (taeo) return taeoLine("suspect", tn);
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
  // 오프라인 AI도 대사 내용에 맞춰 표정을 붙인다
  return {
    speak: async (s, p, hint) => {
      const text = await raw.speak(s, p, hint);
      return { text, emotion: detectEmotion(text) };
    },
    vote: raw.vote,
    nightTarget: raw.nightTarget,
    whisper: async (s, p, t) => {
      const text = await raw.whisper(s, p, t);
      return { text, emotion: detectEmotion(text) };
    },
  };
}

