import { alive, mafiaPartners, nameOf, pick } from "./engine";
import { TRUST_RE } from "./director";
import { addressesDead, deniesRevealedRole, detectClaims, isRepetitive, reasoningNotes, ruleViolations, detectReports, factsBlock, focusBlock, speaksOfSelf, transcriptFor } from "./context";
import { HUMAN_ID } from "./data";
import { detectEmotion, parseSpoken } from "./emotion";
import { ROLE_LABEL } from "./types";
import type { Emotion, GameState, Meaning, Player, Role, Settings } from "./types";

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

const RULEBOOK = `[게임 규칙 전체]
1. 구성과 승리: 마피아 2, 경찰 1, 의사 1, 군인 1, 시민 3(총 8명). 마피아가 전멸하면 시민 팀 승리, 마피아 수가 시민 팀 수 이상이면 마피아 승리.
2. 진행: 1일차 밤(마피아의 살해만 없음. 경찰 조사 등 다른 능력은 첫 밤에도 정상적으로 사용 가능) -> 낮(토론과 행동) -> 투표(최다 득표자 지목, 동점이면 무효) -> 최후의 변론 -> 찬반 투표(찬성이 반대보다 많으면 처형, 직업 공개, 유언) -> 밤(마피아 살해, 의사 보호, 경찰 조사) -> 다음 낮.
   중요: "첫 밤에는 살해가 없다"는 것은 마피아의 습격이 없다는 뜻이지 경찰의 조사가 불가능하다는 뜻이 아니다. 따라서 경찰이 "첫날 밤에 조사했다"고 보고하는 것은 규칙상 정상이며 의심 근거가 아니다.
   첫 밤에 하는 일은 경찰의 조사뿐이다. 의사는 첫 밤에 보호를 하지 않고(보호 행동 자체가 없다), 마피아는 살해하지 않으며, 시민과 군인은 원래 밤에 하는 일이 없다. 따라서 "첫 밤에 누구를 보호했냐", "첫 밤 보호 선택" 같은 말은 규칙에 없는 이야기이므로 하지 않는다. 의사의 보호는 둘째 밤부터 있다.
   시민과 군인은 밤에 아무 행동도 하지 않으므로, 그들에게 "밤에 뭘 했냐"고 묻는 것은 의미가 없다.
3. 직업과 그 한계:
 - 마피아: 동료를 알고 있다. 밤마다 시민 팀 1명을 살해한다. 낮에는 시민인 척 연기하며 경찰/의사를 사칭해도 된다.
 - 경찰: 밤마다 1명을 조사해 그 사람이 "마피아인지 아닌지"만 알 수 있다. 정확한 직업(의사/군인/시민)은 알 수 없다. 대화에서 "X는 시민이다"라고 보고하면 "조사했더니 X는 마피아가 아니었다"는 뜻이다. 진짜 경찰은 단 1명이다.
 - 의사: 밤마다 1명을 보호한다(자기 자신 가능). 마피아가 노린 사람과 같으면 그 사람이 죽지 않는다.
 - 군인: 마피아의 습격을 한 번 버틴다.
 - 시민: 특별한 능력이 없다.
4. 죽음:
 - 죽은 사람은 더 이상 말하지도, 대답하지도, 투표하지도, 능력을 쓰지도 못한다. 죽은 사람에게 질문하거나 대답·해명을 요구하지 않는다. 대화는 살아 있는 사람끼리만 한다.
 - 죽은 사람이 살아 있을 때 한 말과 투표는 그대로 증거로 쓸 수 있다("서연이 생전에 ~라고 했다"처럼 과거형으로 말한다).
 - 처형된 사람은 직업이 공개되고, 밤에 살해된 사람은 직업이 공개되지 않는다. 처형되어 직업이 공개된 사람은(유언을 포함해) 그 직업을 부정하지 않는다. 마피아로 공개되었다면 더 이상 결백을 주장하지 않는다. 사망자 수와 경위는 [지금까지 일어난 일]의 "사망자"를 기준으로 말하고, 틀리게 말하지 않는다(예: 누가 죽었는데 "아무도 안 죽었다"고 하지 않는다).
5. 직업 주장과 조사 보고를 해석하는 법:
 - "저는 경찰이고 A를 조사했더니 시민(마피아 아님)이었다"는 "A는 마피아가 아니다"라는 경찰의 조사 보고다. 진짜 경찰이면 사실이고, 가짜 경찰(마피아나 거짓말하는 시민)이면 거짓일 수 있다. 직업 주장은 증명이 아니다.
 - 경찰을 주장하는 사람이 2명 이상이면 적어도 한 명은 가짜다.
 - 진위 판단의 열쇠: 진짜 경찰이 마피아를 조사하면 반드시 "마피아"로 나온다. 따라서 A가 실제 마피아인데 "A는 마피아가 아니다"라고 보고한 사람은 진짜 경찰이 아니다. 반대로 A가 실제 시민 팀인데 "A는 마피아다"라고 보고한 사람도 진짜 경찰이 아니다. 당신은 자기 자신의 실제 직업을 알고 있으므로, 자신이 조사 대상으로 보고되면 그 보고가 사실과 맞는지 바로 알 수 있다.
 - 당신이 시민 팀이고 "마피아 아님"으로 보고되었다면: 그 사람이 진짜 경찰일 가능성이 높다는 뜻이다. 고마워하고 신뢰하되, 상대가 마피아의 사칭일 수 있다는 점도 염두에 둔다.
 - 당신이 시민 팀인데 "마피아"로 보고되었다면: 그 사람은 가짜 경찰이다. 이유를 들어 강하게 반박한다.
 - 당신이 진짜 경찰인데 누가 경찰을 주장하면: 그 사람은 가짜다. 즉시 반박하고 필요하면 조사 결과를 공개한다.
 - 당신이 마피아라면: 자신이 "마피아 아님"으로 보고되었을 때 상대가 진짜 경찰일 리 없다는 것을 알지만, 연기를 위해 그 보고를 받아들이거나 "가짜 경찰"이라고 몰아붙이는 것 중 유리한 쪽을 고른다.
 - 의심스러운 사람은 의심해도 된다. 단, 이유(모순되는 말, 누가 누구에게 투표했는지, 이미 공개된 직업, 주장 간의 충돌)를 말한다. 믿을 때도 근거를 말한다.
 - 처형된 사람의 직업은 공개되므로 과거의 주장과 대조해 거짓말을 가려낼 수 있다.
 - 의사의 보호 보고는 경찰 조사가 아니다. "○○를 보호했다/살렸다"는 의사의 말이다. 그날 아침 "의사가 누군가를 구해냈다"는 안내가 있었다면, 보호받은 사람은 마피아의 습격 대상이었으므로 마피아가 아니다(마피아는 자기편을 습격하지 않는다). 의사가 이를 근거로 "○○는 마피아가 아니다"라고 하는 것은 정상적인 추론이다. 의사에게 "조사를 어떻게 했냐", "경찰이냐"고 묻지 않는다.
 - 이미 나온 조사 보고(대상과 결과)를 두고 "누구를 조사했냐", "결과가 뭐냐"고 다시 묻지 않는다. 그 보고를 사실로 받아들일지 거짓으로 볼지를 판단해 반응한다.
 - "언제 조사했냐"는 따질 필요가 없다. 경찰은 매 밤 한 명씩 조사하므로 보고된 조사는 지난밤(들) 중 하나에 한 것이다. 조사 횟수가 지난 밤의 수보다 많을 때만 모순이다.
 - 플레이어가 "말했잖아", "아까 말했지" 등으로 이전 발언을 가리키면 앞선 대화에서 그 발언을 찾아 이어서 이해한다.
6. 믿음과 의심의 균형:
 - 모든 것을 의심하지 않는다. 근거가 있으면 믿는다. 예: 맞서는 주장이 없는 경찰 주장, 공개된 사실과 맞아떨어지는 보고, 처형으로 직업이 확인된 일, 일관된 투표와 발언.
 - 믿을 때는 "~이니까 일단 믿겠다", "~님은 시민 쪽으로 본다"처럼 이유와 함께 분명히 말하고, 믿는 사람과 힘을 합쳐 다른 용의자를 찾는다.
 - 의심할 때도 구체적인 근거(모순, 주장 충돌, 누가 누구에게 투표했는지, 공개된 직업과의 불일치)를 댄다. 근거 없는 의심을 반복하지 않는다.
 - [공개된 사실만으로 확실한 것]에 있는 추론은 사실로 받아들인다.
 - 누가 정보를 공개했다는 이유만으로 의심하지 않는다. 주장이 공개된 사실과 맞으면 일단 그럴듯하게 받아들이고, 반박할 근거(맞서는 주장, 사실과의 모순)가 있을 때만 의심한다. 말을 했다고 몰아가지 말고, 같은 사람을 근거 없이 계속 몰아붙이지 않는다.
8. 목표와 정보: 시민 팀(경찰, 의사, 군인, 시민)은 마피아를 모두 찾아 처형해야 이긴다. 마피아는 정체를 숨기고 시민 팀을 줄여 수가 같아지면 이긴다. 다른 사람의 직업은 아무도 모른다(마피아끼리만 서로 안다). AI든 사람이든 모두 같은 조건이니, 직업을 아는 척하지 말고 대화와 사실로 추리한다.
9. 투표: 확실히 의심 가는 사람이 없으면 기권해도 된다. 근거 없이 아무나 찍지 않는다. 의심 가는 사람이 있으면 그 이유를 바탕으로 투표한다.
7. 추리하며 말하기: [당신의 추리 메모]와 [공개된 사실만으로 확실한 것]을 근거로, 지금 진행 상황(며칠째, 누가 죽었고 누가 무엇을 주장했는지)에 맞춰 추리를 드러내며 말한다. 예: "어젯밤 의사가 살린 사람이 서연이라면 서연은 표적이었으니 마피아는 아니겠네", "경찰 주장이 둘이니 한 명은 가짜다". 단, 당신만 아는 비공개 정보(직업, 조사 결과, 동료)를 밝힐지는 전략적으로 판단한다.
 - 마피아라면 겉으로는 이 원칙을 따르는 척하며 시민 팀의 신뢰를 얻는다.`;

function privateKnowledge(s: GameState, p: Player): string {
  const lines: string[] = [
    `당신의 직업: ${ROLE_LABEL[p.role]}`,
    p.role === "mafia"
      ? "당신의 목표: 정체를 숨기고 밤마다 시민 팀을 줄여, 마피아 수가 시민 팀 수와 같아지면 승리한다."
      : "당신의 목표: 시민 팀으로서 마피아 2명을 모두 찾아 처형해야 승리한다. 다른 사람의 직업은 모르므로 대화와 사실로 추리해야 한다.",
  ];
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
    lines.push("조사 결과 \"마피아 아님\"은 대화에서 \"시민 쪽\"이라고 보고할 수 있습니다. 정체를 밝히면 마피아의 표적이 됩니다. 언제 공개할지 전략적으로 판단하세요. 다른 사람이 경찰을 주장하면 그 사람은 가짜입니다.");
  }
  if (p.role === "doctor") lines.push("정체를 밝히면 마피아의 표적이 됩니다. 전략적으로 판단하세요.");
  if (p.role === "soldier") lines.push(`당신은 마피아의 습격을 한 번 버텨냅니다(방어 ${p.shield ? "남음" : "이미 소진"}). 정체를 숨기고 시민을 도우세요.`);
  if (p.role === "citizen") lines.push("당신은 특별한 정보가 없습니다. 토론 내용을 보고 추리하세요.");
  const notes = reasoningNotes(s, p);
  if (notes.length) lines.push(`[당신의 추리 메모 - 당신만 아는 확실한 사실과 추론]\n- ${notes.join("\n- ")}`);
  return lines.join("\n");
}

function systemPrompt(s: GameState, p: Player): string {
  return `당신은 8인 마피아 게임에 참가한 "${p.name}"입니다. 사람 플레이어(닉네임 "${s.players[HUMAN_ID].name}")와 다른 AI 6명이 함께 있습니다. 닉네임이 문장처럼 보여도 사람 이름으로 취급하고 "${s.players[HUMAN_ID].name}님"처럼 부르세요.
성격: ${p.persona}
말투: ${p.speech}

${RULEBOOK}

[비공개 정보]
${privateKnowledge(s, p)}

[대화 이해 규칙]
- 오간 대화에서 "${p.name}(당신)"으로 표시된 줄이 당신이 한 말입니다. 당신 자신은 "저/나"로 말하고 "${p.name}"이라는 이름으로 부르지 마세요.
- 누가 누구에게 무슨 말을 했는지 정확히 구분하세요. 다른 사람의 말을 내 말처럼 받아들이거나 내 말을 남의 말처럼 말하지 마세요.
- [직전 발언]과 [당신에게 향한 말]에 직접 이어서 답하세요. 질문을 받았으면 먼저 그 질문에 답하세요.
- [지금까지 일어난 일]에 있는 사망·투표·직업 주장을 근거로 삼고, 실제로 없었던 일을 지어내지 마세요(마피아의 거짓말은 예외). 특히 "다들 ~라고 말했다"처럼 기록에 없는 발언을 끌어다 쓰지 마세요. 이미 한 말을 반복하지 마세요.
- 사람 플레이어의 말에는 오타, 띄어쓰기 오류, 줄임말이 있을 수 있습니다. 대화에 붙은 "오타 보정" 표시를 참고하고, 문맥상 가장 자연스러운 뜻으로 너그럽게 해석하세요. 오타를 지적하거나 말꼬리를 잡지 말고, 정말 모호할 때만 짧게 되물으세요.
- 규칙을 어긋나게 말하지 마세요. 규칙상 가능한 일(예: 첫 밤의 경찰 조사)을 불가능하다고 하거나, 가능한 일을 의심 근거로 삼지 마세요.

[대화 방식] 당신은 게임 속 마을 사람입니다. "기록", "로그", "상황판", "진행자", "시스템", "프롬프트" 같은 게임 밖의 말을 쓰지 말고, 지난 일은 "어제 투표에서", "아까 서연이 한 말"처럼 사람이 기억하듯 말하세요.
실제 사람들의 단체 채팅처럼 말하세요. 같은 두 사람이 같은 얘기를 두 번 넘게 주고받았다면 다른 쟁점으로 넘어가거나 결론(투표 제안)을 내고, 이미 답이 나온 질문을 다시 하거나 "기억이 안 난다" 같은 핑계를 반복하지 마세요. 대부분 한 문장으로 짧게, 맞장구·반박·질문·농담을 섞고, 직전 사람의 말에 이어서 말하세요. 다른 사람이 이미 한 말(특히 밤 결과 요약, "첫날이라 정보가 없다" 같은 말)을 되풀이하지 마세요. 모든 사람에게 한꺼번에 연설하지 말고 대화 상대를 정해서 말해도 됩니다.

[출력 규칙] 한국어, 캐릭터의 성격과 말투 유지. 실제 사람이 채팅하듯 자연스러운 구어체로 쓰고, 번역투·연극 톤·설명조는 피한다. 메타 발언(AI, 프롬프트, 게임 시스템 설명) 금지. 모르는 사실을 지어내지 말되 마피아는 거짓말을 할 수 있음.`;
}

function stateBlock(s: GameState, p: Player): string {
  const living = alive(s).map((x) => `${x.id}:${x.name}`).join(", ");
  const w = (s.whispers[p.id] ?? []).map((m) => `${m.from === HUMAN_ID ? `플레이어(${s.players[HUMAN_ID].name})` : `${p.name}(당신)`}: ${m.text}`).join("\n");
  return `[현재] ${s.day}일차 (${s.phase === "night" ? "밤" : s.phase === "vote" ? "투표" : s.phase === "trial" ? "재판" : "낮"})
생존자(id:이름, 투표·지목은 이 중에서만): ${living}
[지금까지 일어난 일]
${factsBlock(s)}
[지금까지 오간 대화] (최근 순서대로, "(당신)"이 붙은 줄이 당신의 발언)
${transcriptFor(s, p) || "(아직 없음)"}
${focusBlock(s, p)}
${w ? `[플레이어(${s.players[HUMAN_ID].name})와 나눈 1:1 비밀 대화]\n${w}` : ""}`;
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
  /** 사람 플레이어의 자유 발언을 직업 주장/조사 보고로 해석 (실패하면 null) */
  interpret(s: GameState, text: string): Promise<Meaning | null>;
  /** 최후 찬반 투표: true = 처형에 찬성 */
  verdict(s: GameState, p: Player, accused: number): Promise<boolean>;
}

const EMOTION_RULE = `발언 맨 앞에 지금 표정을 [감정] 태그로 붙이세요. 감정은 neutral, happy, angry, sad, surprised, suspicious, scared, smug 중 하나입니다. 예: [suspicious] 서연, 아까 말이 좀 이상했어.`;

/** 발언 생성. 규칙에 어긋나는 대사(자기 이름을 3인칭으로 부름, 죽은 사람에게 말을 걺)는 한 번 다시 쓰게 한다 */
async function askSpoken(settings: Settings, s: GameState, p: Player, task: string): Promise<Spoken> {
  const prompt = `${stateBlock(s, p)}\n\n${task}`;
  const problems = (text: string): string[] => {
    const out: string[] = [];
    if (speaksOfSelf(text, p.name)) out.push(`당신 자신(${p.name})을 이름으로 불렀습니다. 당신은 ${p.name}입니다. 자신은 "저/나"로 말하세요.`);
    const dead = addressesDead(s, text, p.id);
    out.push(...ruleViolations(text));
    if (isRepetitive(s, p.id, text)) out.push("방금 나온 말(또는 당신이 최근에 한 말)과 거의 같습니다. 같은 얘기를 되풀이하지 말고 새로운 근거, 다른 사람, 다른 쟁점, 또는 결론을 말하세요.");
    if (dead !== null) out.push(`${s.players[dead].name}은(는) 이미 사망해서 말도 대답도 할 수 없습니다. 죽은 사람에게 묻거나 대답을 요구하지 말고 살아 있는 사람에게 말하세요. (생전의 발언을 근거로 언급하는 것은 괜찮습니다.)`);
    return out;
  };
  let spoken = parseSpoken(clean(await callLLM(settings, systemPrompt(s, p), prompt, 200), p.name));
  const issues = problems(spoken.text);
  if (issues.length) {
    const again = await callLLM(settings, systemPrompt(s, p), `${prompt}\n\n[다시 쓰기] 방금 쓴 답변 "${spoken.text}"에는 문제가 있습니다:\n- ${issues.join("\n- ")}\n직전 발언과 [지금까지 일어난 일]에 맞게 다시 쓰세요.`, 200);
    spoken = parseSpoken(clean(again, p.name));
  }
  return spoken;
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
보통 한 문장으로 짧게(60자 안팎), 길어도 두 문장까지. 가능하면 근거를 붙여 추리하듯 말하세요. 발언 내용만 출력하세요. 이름 접두어나 따옴표는 쓰지 마세요.
${EMOTION_RULE}`;
        return askSpoken(settings, s, p, task);
      }, () => mock.speak(s, p, hint)),
    vote: (s, p) =>
      safe(async () => {
        const cands = alive(s).filter((x) => x.id !== p.id).map((x) => x.id);
        return askTarget(settings, s, p, cands, "투표 시간입니다. 처형할(가장 마피아 같은) 사람을 고르세요. 확실한 근거가 있는 의심 대상이 없다면 기권하세요(vote에 null).", "vote");
      }, () => mock.vote(s, p)),
    nightTarget: (s, p, kind) =>
      safe(async () => {
        const cands = alive(s).filter((x) => (kind === "protect" ? true : x.id !== p.id) && !(kind === "kill" && x.role === "mafia")).map((x) => x.id);
        const verb = { kill: "살해할", protect: "보호할", investigate: "조사할" }[kind];
        const r = await askTarget(settings, s, p, cands, `밤입니다. ${verb} 사람을 고르세요.`, "target");
        if (r === null) throw new Error("target parse: null");
        return r;
      }, () => mock.nightTarget(s, p, kind)),
    interpret: async (s, text) => {
      try {
        const me = s.players[HUMAN_ID];
        const names = s.players.filter((x) => !x.isHuman).map((x) => `${x.id}:${x.name}`).join(", ");
        const sys = `당신은 마피아 게임의 대화 해석기입니다. 사람 플레이어의 발언 하나를 읽고, 그 안에 담긴 "직업 주장"과 "경찰 조사 보고"를 구조화합니다.
- 오타, 띄어쓰기 오류, 줄임말, 반말을 너그럽게 문맥으로 해석합니다.
- 직업 주장: 자기 직업을 밝히는 말(예: "나 경찰임", "저 의사예요").
- 조사 보고: 누군가를 조사했더니 마피아다/마피아가 아니다(시민이다)라는 말. 예: "서연 조사했는데 마피아임" -> 서연=mafia, "조사해보니 도윤 시민" -> 도윤=clean, "하은은 마피아 아님" -> 하은=clean.
- 이전 기록에서 이미 경찰을 주장한 사람이 "X 마피아야"라고 말하면 조사 보고로 봅니다.
- 의사 보호 보고: "X를 보호했다/살렸다/지켰다"는 의사의 말이며 경찰 조사가 아닙니다. 이 경우 saves에 넣고 reports에는 넣지 마세요. 의사가 "보호했는데 마피아 아닌 걸 알았다"고 하면 saves로 봅니다.
- 해당 내용이 없으면 claim은 null, reports는 빈 배열입니다. 추측으로 만들어 내지 마세요.`;
        const user = `[이전 기록]\n${transcriptFor(s, me, 20)}\n\n[해석할 플레이어 발언] "${text}"\n[후보(id:이름)] ${names}\nJSON 한 줄만 출력: {"claim": null 또는 "경찰"|"의사"|"군인"|"마피아"|"시민", "reports": [{"target": id, "result": "mafia" 또는 "clean"}], "saves": [{"target": id}], "summary": "한 줄 해석"}`;
        const t = await callLLM(settings, sys, user, 300);
        const m = t.match(/\{[\s\S]*\}/);
        if (!m) return null;
        const j = JSON.parse(m[0]);
        const roleBy: Record<string, Role> = { 경찰: "police", 의사: "doctor", 군인: "soldier", 마피아: "mafia", 시민: "citizen" };
        const reports = (Array.isArray(j.reports) ? j.reports : [])
          .map((r: { target: unknown; result: unknown }) => ({ target: Number(r.target), result: r.result === "mafia" ? "mafia" : "clean" }) as const)
          .filter((r: { target: number }) => Number.isInteger(r.target) && r.target > 0 && r.target < s.players.length);
        const saves = (Array.isArray(j.saves) ? j.saves : [])
          .map((r: { target: unknown }) => ({ target: Number(r.target) }))
          .filter((r: { target: number }) => Number.isInteger(r.target) && r.target > 0 && r.target < s.players.length);
        return {
          claim: typeof j.claim === "string" ? roleBy[j.claim] : undefined,
          reports: reports.length ? reports : undefined,
          saves: saves.length ? saves : undefined,
          summary: typeof j.summary === "string" && j.summary.trim() ? j.summary.trim().slice(0, 120) : undefined,
        };
      } catch {
        return null; // 해석은 보조 기능이라 실패해도 규칙 기반 해석으로 대체
      }
    },
    verdict: (s, p, accused) =>
      safe(async () => {
        const task = `${s.players[accused].name}에 대한 최종 찬반 투표입니다. 처형에 찬성하면 {"execute": true}, 반대하면 {"execute": false} JSON 한 줄만 출력하세요.`;
        const t = await callLLM(settings, systemPrompt(s, p), `${stateBlock(s, p)}\n\n${task}`, 120);
        const m = t.match(/"execute"\s*:\s*(true|false)/i);
        if (!m) throw new Error(`verdict parse: ${t.slice(0, 120) || "(빈 응답)"}`);
        return m[1].toLowerCase() === "true";
      }, () => mock.verdict(s, p, accused)),
    whisper: (s, p, userText) =>
      safe(async () => {
        const night = s.phase === "night";
        const task = `${s.players[HUMAN_ID].name}가 당신에게 1:1 비밀 대화로 말했습니다: "${userText}"
${night ? "지금은 밤이고 마피아끼리의 비밀 대화입니다. 오늘 밤 누구를 노릴지 의견을 나누세요.\n" : ""}당신의 캐릭터와 직업/전략에 맞게 1~2문장으로 답하세요. (거짓말·떠보기 가능) 답변 내용만 출력.
${EMOTION_RULE}`;
        return askSpoken(settings, s, p, task);
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
    const mentionsMe = m.text.includes(viewer.name) && /(의심|마피아|수상)/.test(m.text) && !TRUST_RE.test(m.text);
    if (mentionsMe && sc[m.from] !== undefined) sc[m.from] += 2;
    s.players.forEach((t) => {
      if (t.id !== m.from && m.text.includes(t.name) && /(마피아|의심|수상)/.test(m.text) && sc[t.id] !== undefined && viewer.role !== "mafia") sc[t.id] += 0.7;
    });
    if (viewer.role === "mafia" && /(경찰|조사)/.test(m.text) && /(제가|내가|저는)/.test(m.text) && sc[m.from] !== undefined) sc[m.from] += 3;
  });
  // 공개된 조사 보고 반영: 경찰 주장이 하나뿐이면 보고를 꽤 믿고, 둘 이상이면 덜 믿는다
  const claims = detectClaims(s);
  const policeClaimers = Object.entries(claims).filter(([, r]) => r === "police").map(([id]) => Number(id)).filter((id) => s.players[id].alive);
  for (const r of detectReports(s)) {
    if (r.target === viewer.id) {
      // 나에 대한 보고: 사실과 다르면 보고자는 가짜 경찰
      const truth = viewer.role === "mafia" ? "mafia" : "clean";
      if (truth !== r.result && sc[r.by] !== undefined) sc[r.by] += viewer.role === "mafia" ? 1 : 4;
      continue;
    }
    if (viewer.role === "police" && r.by !== viewer.id && sc[r.by] !== undefined) { sc[r.by] += 4; continue; } // 진짜 경찰이 보기엔 가짜
    const weight = policeClaimers.length <= 1 ? 2.5 : 1;
    if (sc[r.target] !== undefined) sc[r.target] += r.result === "mafia" ? weight : -weight;
  }
  if (viewer.role === "mafia") mafiaPartners(s, viewer.id).forEach((pt) => { if (sc[pt.id] !== undefined) sc[pt.id] -= 100; });
  return sc;
}

/** 가장 믿을 만한 사람 (의심 점수가 가장 낮은 생존자) */
const least = (sc: Record<number, number>): number | null => {
  const e = Object.entries(sc).sort((a, b) => a[1] - b[1]);
  return e.length ? Number(e[0][0]) : null;
};

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
      if (hint?.startsWith("[대리]")) {
        // 사람 플레이어 대신 하는 말: 직업·조사 결과는 절대 말하지 않는다
        const name = target !== null ? nameOf(s, target) : "다른 분";
        if (/\[응답\]/.test(hint) && /(의심|수상|마피아|거짓|가짜)/.test(hint))
          return pick([
            "저는 아니에요. 왜 그렇게 보셨는지 근거부터 듣고 싶네요.",
            "저를 의심하는 건 이해하지만, 제 말은 처음부터 일관됐어요.",
            "제가 수상하다면 어느 부분인지 콕 집어 주세요. 설명할게요.",
            `저보다는 ${name}님 쪽을 먼저 보는 게 맞다고 생각해요.`,
            "괜히 저한테 시선 돌리는 것 같은데요. 다른 분들 얘기도 들어 봐요.",
          ]);
        if (/\[응답\]/.test(hint))
          return pick([
            "음, 저도 아직 확신은 없어요. 조금 더 들어볼게요.",
            "그 말 일리 있네요. 저도 비슷하게 보고 있어요.",
            `저는 ${name}님 얘기를 더 듣고 싶어요.`,
            "좋은 질문이네요. 저는 투표 흐름을 같이 보고 있어요.",
          ]);
        return pick([
          `저는 ${name}님 말이 좀 걸려요.`,
          "다들 너무 한 사람만 몰지 말고 투표 흐름도 같이 봐요.",
          `${name}님, 아까 한 말 조금만 더 설명해 주실래요?`,
          "지금까지 얘기 들어 보니 아직은 판단을 아껴 둘게요.",
          `${name}님은 말이 계속 바뀌는 것 같아요.`,
          "조용한 분들 얘기도 좀 듣고 싶네요.",
        ]);
      }
      const taeo = p.name === "태오";
      const informal = /(반말|털털|가벼운|단호|평어)/.test(p.speech);
      if (hint?.startsWith("[재판]")) {
        if (hint.includes("변론")) {
          return pick(informal
            ? ["난 마피아가 아니야. 내 표를 이렇게 날리면 진짜 마피아만 좋아져.", "억울하다. 한 번만 더 생각해 봐. 나를 처형하면 후회한다.", "근거도 없이 나를 몰아가네. 그래도 마지막으로 말한다. 난 시민이다."]
            : ["저는 마피아가 아닙니다. 지금 저를 처형하면 진짜 마피아만 웃게 됩니다.", "정말 억울합니다. 한 번만 다시 생각해 주세요.", "근거 없이 지목되었지만, 저는 시민이라는 것을 마지막으로 말씀드립니다."]);
        }
        // 유언: 처형으로 직업이 공개된 뒤이므로 공개된 직업에 맞게 말한다
        if (p.role === "mafia") {
          return pick(informal
            ? ["결국 들켰네. 그래도 아직 끝난 건 아니다.", "여기까지군. 남은 밤을 조심하는 게 좋을 거야.", "잘 찾아냈네. 하지만 내가 전부는 아니야."]
            : ["결국 들켰네요. 그래도 아직 끝난 건 아니에요.", "여기까지네요. 남은 밤들을 조심하시는 게 좋을 거예요.", "잘 찾아내셨네요. 하지만 저 혼자가 아니라는 건 아시죠?"]);
        }
        return pick(informal
          ? ["여기까지네. 남은 사람들, 진짜 마피아를 꼭 잡아 줘.", "내 몫은 여기까지다. 잘 부탁한다."]
          : ["여기까지인가 봅니다. 남은 분들이 꼭 마피아를 찾아내 주세요.", "제 몫은 여기까지네요. 부탁드립니다."]);
      }
      const rep = hint?.match(/^\[조사보고:(\d+):(clean|mafia)\]/);
      if (rep) {
        const tid = Number(rep[1]);
        const res = rep[2];
        const targetIsMafia = s.players[tid].role === "mafia";
        if (p.id === tid) {
          if (p.role === "mafia") {
            return pick(res === "clean"
              ? (informal ? ["나를 조사했다고? 마피아가 아니라니 고맙긴 한데, 갑자기 경찰이라니 영 수상한데.", "경찰이 진짜 있다면 증거부터 대 봐."] : ["저를 조사하셨다고요? 마피아가 아니라니 감사하지만, 갑작스러운 경찰 주장은 수상하네요.", "진짜 경찰이시라면 근거를 보여 주세요."])
              : (informal ? ["나를 마피아로 몰아? 그 사람이야말로 가짜 경찰이다.", "근거도 없이 나를 지목하네. 가짜 경찰 아니냐?"] : ["저를 마피아로 지목하다니요. 그쪽이 가짜 경찰 같습니다.", "근거도 없이 몰아가시네요. 오히려 가짜 경찰이 의심스럽습니다."]));
          }
          return pick(res === "clean"
            ? (informal ? ["조사해 줘서 고맙다. 난 진짜 시민이야. 이제 믿을 사람이 생겼네.", "내가 마피아가 아니라는 걸 확인해 줘서 고맙다."] : ["조사해 주셔서 감사합니다. 저는 정말 마피아가 아닙니다.", "결과를 공유해 주셔서 고마워요. 이제 서로 믿고 마피아를 찾죠."])
            : (informal ? ["난 마피아가 아니야. 그 경찰이 가짜다. 내가 시민인 건 내가 제일 잘 알아.", "나를 마피아로 몰다니, 가짜 경찰이 확실하다."] : ["저는 마피아가 아닙니다. 그렇게 보고한 쪽이 가짜 경찰이에요.", "저를 마피아로 몬 걸 보니 그쪽이 거짓말을 하는 겁니다."]));
        }
        if (p.role === "police") {
          return informal ? "잠깐, 경찰은 나야. 저 사람은 가짜 경찰이다." : "잠시만요, 경찰은 저입니다. 저분은 가짜 경찰이에요.";
        }
        const consistent = (res === "mafia") === targetIsMafia;
        void consistent; // 관찰자는 진위를 알 수 없다
        return pick(res === "mafia"
          ? (informal ? ["경찰 보고라면 그 사람을 의심해 볼 만하네. 다만 진짜 경찰인지는 더 지켜보자.", "경찰이 지목했다니 일단 기억해 둔다. 반박이 나오는지 보자."] : ["경찰의 조사 보고라면 그분을 의심해 볼 만하네요. 진짜 경찰인지는 지켜보겠습니다.", "마피아로 지목되었군요. 반박이 나오는지 보죠."])
          : (informal ? ["경찰이 조사했는데 마피아가 아니라니, 일단 그 사람은 믿고 다른 사람을 보자.", "마피아가 아니라는 보고네. 그럼 남은 사람 중에서 찾아야겠다."] : ["경찰이 조사했는데 마피아가 아니라면, 그분은 일단 믿고 다른 분들을 살펴보죠.", "마피아가 아니라는 보고군요. 남은 분들 중에서 찾아야겠네요."]));
      }
      const saveRep = hint?.match(/^\[의사보고:(\d+):(saved|unsaved)\]/);
      if (saveRep) {
        const tid = Number(saveRep[1]);
        const confirmed = saveRep[2] === "saved";
        const tn2 = nameOf(s, tid);
        if (p.role === "doctor") return informal ? "잠깐, 의사는 나야. 저 사람은 가짜 의사다." : "잠시만요, 의사는 저예요. 저분은 가짜 의사예요.";
        if (p.id === tid) {
          if (p.role === "mafia") return pick(!informal ? ["저를 지켜 주셨다니 감사해요. 덕분에 살았네요.", "보호해 주셨다니 다행이에요."] : ["날 지켜 줬다니 고맙네. 덕분에 살았다.", "보호해 줬다니 다행이다."]);
          return pick(!informal ? ["저를 지켜 주셔서 감사해요. 저는 확실히 마피아가 아니에요.", "덕분에 살았네요. 이제 저도 의사분을 믿을게요."] : ["날 지켜 줘서 고마워. 난 확실히 마피아 아니야.", "덕분에 살았다. 이제 의사 말은 믿을게."]);
        }
        if (confirmed)
          return pick(!informal
            ? [`어젯밤 의사가 구한 사람이 ${tn2}님이라면 ${tn2}님은 마피아 표적이었으니 시민 쪽이겠네요.`, `의사가 막은 습격이 ${tn2}님이었다면 이야기가 맞아요. ${tn2}님은 믿어도 될 것 같아요.`]
            : [`어젯밤 살린 게 ${tn2}라면 ${tn2}는 표적이었으니 시민 쪽이겠네.`, `의사가 막은 게 ${tn2}였으면 말이 맞아. ${tn2}는 믿어도 되겠다.`]);
        return pick(!informal ? [`보호했다는 건 알겠어요. 다만 그날 습격이 막힌 건 아니라서 ${tn2}님이 확실히 시민이라고 하긴 어렵네요.`] : [`지켰다는 건 알겠어. 근데 그날 습격을 막은 건 아니니까 ${tn2}가 확실히 시민이라곤 못 하겠다.`]);
      }
      const claimed = hint?.match(/^\[주장:(경찰|의사|군인|마피아|시민)\]/);
      if (claimed) {
        if (claimed[1] === "경찰" && p.role === "police") return informal ? "경찰은 나야. 저 사람은 가짜다." : "경찰은 저입니다. 저분은 가짜예요.";
        if (claimed[1] === "경찰") return pick(informal ? ["경찰이라고? 누구를 조사했는지부터 말해 봐.", "경찰이라면 조사 결과를 공개해야지. 안 하면 못 믿는다."] : ["경찰이시라면 누구를 조사했는지 말씀해 주세요.", "경찰이 맞다면 조사 결과를 공개해 주셔야 믿을 수 있어요."]);
      }
      if (hint?.startsWith("[지목]")) {
        return pick(informal
          ? ["나를 지목해? 근거부터 대 봐. 난 아니야.", "왜 나야? 그쪽이 더 수상한데."]
          : ["저를 지목하시는 근거가 무엇인가요? 저는 아닙니다.", "지목은 받아들이기 어렵네요. 오히려 다른 분이 더 의심스럽습니다."]);
      }
      if (hint?.startsWith("[질문]")) {
        return pick(informal
          ? ["내 말 중에 뭐가 의심스러운지 짚어 봐. 그럼 설명해 줄게.", "의심하는 건 자유지만 근거는 대야지. 내 말은 처음부터 일관됐어."]
          : ["제 말 중에 어떤 부분이 의심스러운지 짚어 주시면 설명드릴게요.", "의심은 이해하지만, 제 발언은 처음부터 일관됐다고 생각해요. 근거를 말씀해 주세요."]);
      }
      if (hint?.startsWith("[옹호]")) {
        return pick(informal ? ["고맙다. 나도 널 믿는다.", "그래, 그렇게 봐 주니 든든하네."] : ["감사합니다. 저도 믿고 있어요.", "그렇게 봐 주셔서 고맙습니다."]);
      }
      if (hint?.startsWith("[주장]")) {
        return pick(informal
          ? ["그 말이 사실이라면 증명해 봐. 믿기는 어렵다.", "직업 공개라... 일단 지켜보자. 거짓이면 바로 들통난다."]
          : ["그 말이 사실인지 지켜보겠습니다. 거짓이라면 곧 드러나겠죠.", "직업을 밝히셨군요. 믿을 근거가 더 필요합니다."]);
      }
      const accusedMe = s.log.slice(-8).some((m) => m.from !== "system" && m.from !== p.id && m.text.includes(p.name) && /(의심|마피아|수상)/.test(m.text) && !TRUST_RE.test(m.text));
      const rec = (s.policeLog[p.id] ?? []).filter((r) => r.isMafia && s.players[r.target].alive);
      const formal = !/(반말|털털|가벼운|단호)/.test(p.speech);
      if (hint?.includes("플레이어") && !hint.startsWith("[")) {
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
        ? ["저를 의심하시는 건 근거가 부족해 보여요. 오히려 제가 보기엔 " + tn + "님이 수상합니다.", "억울하네요. 저는 시민입니다. 차라리 " + tn + "님을 보세요.", "제 어느 말이 수상했는지 짚어 주세요. 해명할게요.", "저를 몰아가는 흐름이 오히려 이상해요. " + tn + "님은 왜 조용하시죠?"]
        : ["나 의심하는 건 좀 억울한데? 난 " + tn + " 쪽이 더 수상해.", "어허, 날 몰아가지 마. " + tn + " 좀 봐.", "내 말 중에 뭐가 걸렸는지 말해 봐. 해명할게.", "날 몰아가는 게 더 수상하다. " + tn + "는 왜 조용해?"]);
      if (hint?.startsWith("[시작]")) {
        // 토론의 첫 마디: 밤 결과는 이 사람만 짧게 언급
        const victim = s.players.find((x) => x.death?.day === s.day && x.death.cause === "killed");
        if (taeo) return victim ? `${victim.name}가 당했다. 시간 끌지 말고 한 명씩 의심 가는 사람 말해.` : taeoLine("first", tn);
        if (victim) return pick(formal ? [`${victim.name}님이 당했네요. 누가 의심되는지 하나씩 말해 봐요.`, `${victim.name}님이 죽다니... 어젯밤 누가 노렸을지 생각해 보죠.`] : [`${victim.name}가 당했네. 누가 의심되는지 하나씩 말해 보자.`, `${victim.name}가 죽다니... 누가 노렸을지 생각해 보자.`]);
        if (s.day === 1) return pick(formal ? ["첫 밤은 조용히 지나갔네요. 일단 다들 한마디씩 해 볼까요?", "아직 단서가 없으니 서로 얘기부터 해 봐요."] : ["첫 밤은 조용했네. 일단 한마디씩 해 보자.", "아직 단서가 없으니까 얘기부터 해 보자."]);
        return pick(formal ? ["다행히 어젯밤엔 아무도 안 죽었네요. 그래도 방심하지 말죠.", "조용한 밤이었네요. 그럼 어제 투표부터 다시 볼까요?"] : ["어젯밤엔 아무도 안 죽었네. 그래도 방심은 금물이야.", "조용한 밤이었네. 어제 투표부터 다시 보자."]);
      }
      if (hint?.startsWith("[응답]")) {
        const q = hint.match(/"([^"]*)"/)?.[1] ?? "";
        if (/(의심|수상|마피아|거짓|가짜)/.test(q)) return pick(formal ? ["저를 왜 그렇게 보세요? 근거를 말씀해 주시면 해명할게요.", "저는 아니에요. 그렇게 보신 이유가 궁금하네요."] : ["나를 왜 그렇게 봐? 근거를 대 봐.", "난 아니야. 왜 그렇게 생각했는데?"]);
        if (/\?|요\?|까\?/.test(q)) return pick(formal ? ["음, 저는 아직 확신은 없어요. 조금 더 지켜보려고요.", "좋은 질문이네요. 저는 투표 흐름을 보고 있어요."] : ["음, 아직 확신은 없어. 좀 더 보자.", "글쎄, 난 투표 흐름을 보고 있어."]);
        return pick(formal ? ["네, 저도 그렇게 생각해요.", "그 말 일리 있네요."] : ["ㅇㅇ 나도 그렇게 봐.", "그 말 일리 있네."]);
      }
      if (hint?.includes("[전환]")) {
        // 같은 얘기가 돌고 있으면 최근에 나오지 않은 사람으로 화제를 돌린다
        const recentText = s.log.slice(-5).map((m) => m.text).join(" ");
        const fresh = Object.entries(sc).sort((a, b) => b[1] - a[1]).map(([id]) => s.players[Number(id)]).find((x) => !recentText.includes(x.name));
        const other = fresh ? fresh.name : tn;
        return pick(formal
          ? [`그 얘기는 이쯤 하고, 저는 ${other}님도 좀 보고 싶어요.`, `정리하면 아직 확실한 건 없네요. 오늘은 ${other}님 쪽을 한번 보는 게 어때요?`, `계속 같은 얘기만 도는 것 같아요. ${other}님은 어떻게 생각하세요?`]
          : [`그 얘긴 이쯤 하고, 난 ${other}도 좀 봐야 한다고 봐.`, `정리하면 확실한 건 없네. 오늘은 ${other} 쪽을 보자.`, `같은 얘기만 돈다. ${other}는 어떻게 생각해?`]);
      }
      const reacting = hint?.match(/^\[반응:([^\]]+)\]/)?.[1];
      if (reacting && Math.random() < 0.35) {
        // 짧은 맞장구/반문 (실제 대화처럼)
        const who = reacting.startsWith("플레이어") ? s.players[HUMAN_ID].name : reacting;
        return pick(formal
          ? [`${who}님 말도 일리 있네요.`, `음... ${who}님, 그건 좀 성급한 것 같아요.`, `${who}님 말에 동의해요. ${tn}님도 좀 보고 싶고요.`]
          : [`${who} 말도 일리 있네.`, `음... ${who}, 그건 좀 성급한데?`, `${who} 말에 동의. ${tn}도 좀 봐야겠고.`]);
      }
      // 가끔은 믿는 사람을 밝힌다 (모두를 의심하지 않도록)
      const partners = new Set(mafiaPartners(s, p.id).map((x) => x.id));
      const trusted = least(Object.fromEntries(Object.entries(sc).filter(([id]) => !partners.has(Number(id))))); // 마피아는 동료를 감싸지 않는다
      if (trusted !== null && (sc[trusted] < -1 || Math.random() < 0.3)) {
        const t2 = nameOf(s, trusted);
        return pick(formal
          ? [`저는 ${t2}님은 믿어도 된다고 봐요. 지금까지 말이 일관됐거든요. 다른 분들을 보죠.`, `${t2}님은 시민 쪽으로 보고 있어요. 의심은 다른 쪽에 두겠습니다.`]
          : [`난 ${t2}는 믿는다. 말이 계속 일관됐어. 딴 사람을 보자.`, `${t2}는 시민 쪽 같아. 의심은 다른 데 두자.`]);
      }
      if (taeo) return taeoLine("suspect", tn);
      const lines = formal
        ? [`${tn}님의 발언이 계속 모호했던 것 같아요. 조금 의심스럽습니다.`, `저는 ${tn}님이 마피아일 가능성이 높다고 봐요.`, `${tn}님, 아까 하신 말이 좀 걸리는데 설명해 주실래요?`]
        : [`${tn} 좀 이상하지 않아? 난 의심돼.`, `${tn} 쪽이 영 찜찜하다. 해명해봐.`, `솔직히 ${tn}가 제일 수상해 보여.`];
      return pick(lines);
    },
    async vote(s, p) {
      await wait(150 + Math.random() * 250);
      const sc = suspicion(s, p);
      const t = top(sc);
      // 시민 팀은 의심 근거가 약하면 기권한다 (기본 점수는 0~2의 무작위)
      if (t !== null && p.role !== "mafia" && sc[t] < 1.8) return null;
      return t;
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
    async verdict(s, p, accused) {
      await wait(120 + Math.random() * 200);
      if (p.role === "mafia") {
        if (mafiaPartners(s, p.id).some((x) => x.id === accused)) return false;
        return true; // 시민 쪽을 처형하는 데 찬성
      }
      const sc = suspicion(s, p);
      const known = (s.policeLog[p.id] ?? []).find((r) => r.target === accused);
      if (known) return known.isMafia;
      return top(sc) === accused || (sc[accused] ?? 0) > 1.6 || Math.random() < 0.35;
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
      // 최근에 누가 이미 한 말과 똑같은 문장은 피한다 (몇 번 다시 고른다)
      let text = await raw.speak(s, p, hint);
      for (let i = 0; i < 5 && isRepetitive(s, p.id, text); i++) text = await raw.speak(s, p, hint);
      return { text, emotion: detectEmotion(text) };
    },
    vote: raw.vote,
    nightTarget: raw.nightTarget,
    verdict: raw.verdict,
    interpret: async () => null, // 오프라인에서는 규칙 기반 해석만 사용
    whisper: async (s, p, t) => {
      const text = await raw.whisper(s, p, t);
      return { text, emotion: detectEmotion(text) };
    },
  };
}


/**
 * 처형된 캐릭터의 유언. 직업이 공개된 뒤이므로 공개된 직업에 맞게 말하게 하고,
 * 직업을 부정하면(예: 마피아인데 "억울하다, 난 시민") 한 번 다시 묻고, 그래도 어긋나면 fallback(오프라인) 문장을 쓴다.
 */
export async function speakLastWords(engine: AI, fallback: AI, s: GameState, dead: Player): Promise<Spoken> {
  const roleLabel = ROLE_LABEL[dead.role];
  const guide = dead.role === "mafia"
    ? "더 이상 정체를 숨길 수 없습니다. 결백이나 억울함을 주장하지 말고, 남은 동료가 누구인지는 드러내지 않은 채 짧게 인정하거나 도발하는 유언을 하세요."
    : "억울함이나 남은 사람들에게 당부하는 말을 짧게 하세요.";
  const hint = `[재판] 당신은 처형되었고, 직업이 "${roleLabel}"로 모두에게 공개되었습니다. ${guide} 유언(마지막 한마디)을 하세요.`;
  let last = await engine.speak(s, dead, hint);
  if (!deniesRevealedRole(last.text, dead.role)) return last;
  last = await engine.speak(s, dead, `${hint} [주의] 방금 유언 "${last.text}"은(는) 공개된 직업(${roleLabel})과 맞지 않습니다. 직업을 부정하지 마세요.`);
  if (!deniesRevealedRole(last.text, dead.role)) return last;
  return fallback.speak(s, dead, hint);
}
