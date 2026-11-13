import { HUMAN_ID } from "./data";
import { ROLE_LABEL } from "./types";
import type { ChatMsg, GameState, Player, Role } from "./types";

const ROLE_WORDS = ["경찰", "의사", "군인", "마피아", "시민"] as const;

// 자주 나오는 직업 이름 오타 (정확히 일치하는 토큰만 바꾼다)
const ROLE_TYPOS: Record<string, string> = {
  경창: "경찰", 경철: "경찰", 경참: "경찰", 겅찰: "경찰", 경챨: "경찰", 걍찰: "경찰",
  의샤: "의사", 의삳: "의사", 으사: "의사", 의싸: "의사", 이샤: "의사",
  군이: "군인", 궁인: "군인", 굴인: "군인",
  마피야: "마피아", 마피어: "마피아", 마피안: "마피아", 마퍼아: "마피아", 마피하: "마피아",
  시믿: "시민", 싱민: "시민", 시미: "시민",
};

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// 이름 오타 보정에서 제외할 흔한 호칭/단어 (예: "도사님"을 "도윤님"으로 바꾸지 않도록)
const COMMON_WORDS = new Set(["도사", "선생", "사장", "대장", "엄마", "아빠", "형님", "누나", "언니", "오빠", "하느", "하나"]);

const FIRST_PERSON = "(?:저는|제가|저|난|나는|내가|나)";
const CLAIM_END = "(?:입니다|이에요|예요|이야|이다|임|이라고|라고|이고|야|다|돼|되)";

/**
 * 사람 플레이어의 말에서 오타를 문맥에 맞게 보정한다.
 * - 직업 이름의 흔한 오타 ("경창" -> "경찰")
 * - 1인칭 직업 주장 자리의 한 글자 오타 ("나 도사 돼" -> "나 의사 돼")
 * - 이름을 부르는 자리의 한 글자 오타 ("서현님" -> "서연님")
 */
export function normalizeHuman(text: string, players: Player[]): { text: string; fixes: string[] } {
  const fixes: string[] = [];
  let out = text;

  // 1) 직업 이름 오타 (한글 경계 기준으로 토큰 단위)
  for (const [typo, right] of Object.entries(ROLE_TYPOS)) {
    const re = new RegExp(`(?<![가-힣])${typo}(?=[가-힣]?[^가-힣]|[이가은는을를도야에와과의]|$)`, "g");
    out = out.replace(re, () => { fixes.push(`${typo}→${right}`); return right; });
  }

  // 2) 1인칭 + (직업과 한 글자 다른 단어) + 주장 어미/문장 끝
  const claimRe = new RegExp(`(${FIRST_PERSON}\\s*)([가-힣]{2,3})(?=\\s*${CLAIM_END}|\\s*[.,!?~/]|\\s*$)`, "g");
  out = out.replace(claimRe, (m, pre: string, word: string) => {
    if ((ROLE_WORDS as readonly string[]).includes(word)) return m;
    const near = ROLE_WORDS.find((r) => r.length === word.length && editDistance(word, r) === 1);
    if (!near) return m;
    fixes.push(`${word}→${near}`);
    return `${pre}${near}`;
  });

  // 3) 이름을 부르는 자리(님/아/야)의 한 글자 오타
  const names = players.map((p) => p.name);
  out = out.replace(/([가-힣]{2})(?=님|아|야)/g, (m, word: string) => {
    if (names.includes(word) || COMMON_WORDS.has(word)) return m;
    const near = names.filter((n) => n.length === 2 && editDistance(word, n) === 1);
    if (near.length !== 1) return m;
    fixes.push(`${word}→${near[0]}`);
    return near[0];
  });

  return { text: out, fixes: [...new Set(fixes)] };
}

const PHASE_LABEL: Record<string, string> = { night: "밤", day: "낮", vote: "투표", trial: "재판", gameover: "종료", intro: "" };

/** AI에게 줄 대화 기록: 이 AI 본인의 발언은 "이름(당신)"으로, 사람 플레이어는 "플레이어(닉네임)"으로 표시한다 */
export function transcriptFor(s: GameState, viewer: Player, limit = 40): string {
  return s.log
    .slice(-limit)
    .map((m) => {
      const who =
        m.from === "system" ? "[진행]"
        : m.from === viewer.id ? `${viewer.name}(당신)`
        : m.from === HUMAN_ID ? `플레이어(${s.players[HUMAN_ID].name})`
        : s.players[m.from].name;
      let body = m.from === "system" ? m.text.replace(/\n+/g, " / ") : m.text;
      if (m.from === HUMAN_ID) {
        const n = normalizeHuman(m.text, s.players);
        if (n.fixes.length) body = `${n.text} (오타 보정: ${n.fixes.join(", ")} / 원문: ${m.text})`;
      }
      return `(${m.day}일차 ${PHASE_LABEL[m.phase] ?? ""}) ${who}: ${body}`;
    })
    .join("\n");
}

// 1인칭 직업 주장. 어미가 없어도 되지만 "시민을 믿어"(조사)나 "시민 아니야"(부정)는 제외
const CLAIM_RE = /(?:저는|제가|저|난|나는|내가|나)\s*(경찰|의사|군인|마피아|시민)(?:(?:입니다|이에요|예요|이야|이다|임|이라고|라고|이고|야|다|돼|되)|(?![가-힣])(?!\s*(?:아니|아님)))/;
const ROLE_BY_LABEL: Record<string, Role> = { 경찰: "police", 의사: "doctor", 군인: "soldier", 마피아: "mafia", 시민: "citizen" };

/** 대화에서 "저는 경찰입니다"처럼 스스로 직업을 밝힌 기록(마지막 주장 기준) */
export function detectClaims(s: GameState): Record<number, Role> {
  const out: Record<number, Role> = {};
  for (const m of s.log) {
    if (m.from === "system") continue;
    const hit = normalizeHuman(m.text, s.players).text.match(CLAIM_RE);
    if (hit) out[m.from] = ROLE_BY_LABEL[hit[1]];
  }
  return out;
}

export interface Report { by: number; target: number; result: "clean" | "mafia" }

/** "조사 결과 서연님은 마피아가 아닙니다" 같은 조사 보고를 찾는다 (같은 사람이 같은 대상을 다시 보고하면 마지막 것만) */
export function detectReports(s: GameState): Report[] {
  const map = new Map<string, Report>();
  for (const m of s.log) {
    if (m.from === "system") continue;
    const text = normalizeHuman(m.text, s.players).text;
    if (!/조사/.test(text)) continue;
    for (const q of s.players) {
      if (q.id === m.from) continue;
      const esc = q.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const hit = new RegExp(`${esc}\\s*(?:님)?\\s*(?:은|는|이|가)?\\s*(마피아(?:가|는)?\\s*(?:아닙니다|아니에요|아니야|아니다|아님)|마피아 아님|시민|마피아)`).exec(text);
      if (!hit) continue;
      const clean = /아닙니다|아니에요|아니야|아니다|아님|시민/.test(hit[1]);
      map.set(`${m.from}:${q.id}`, { by: m.from as number, target: q.id, result: clean ? "clean" : "mafia" });
    }
  }
  return [...map.values()];
}

/** 전체 기록에서 뽑은 핵심 사실 (최근 대화 40줄에서 밀려나도 잊지 않도록) */
export function factsBlock(s: GameState): string {
  const lines: string[] = [];
  if (s.day >= 1) lines.push("규칙 확인: 첫 밤에도 경찰 조사는 가능하다(첫 밤에 없는 것은 마피아의 살해뿐).");
  const dead = s.players.filter((p) => !p.alive).map((p) => `${p.name}${p.revealed ? `(${ROLE_LABEL[p.role]} 공개)` : "(직업 비공개)"}`);
  lines.push(`사망자: ${dead.join(", ") || "없음"}`);

  const claims = detectClaims(s);
  const claimText = Object.entries(claims).map(([id, r]) => `${s.players[Number(id)].name}=${ROLE_LABEL[r]} 주장`);
  lines.push(`직업 주장: ${claimText.join(", ") || "아직 없음"}`);

  const reports = detectReports(s).map((r) => `${s.players[r.by].name}이(가) ${s.players[r.target].name}을(를) 조사했다며 "${r.result === "mafia" ? "마피아" : "마피아 아님(시민 쪽)"}"으로 보고`);
  if (reports.length) lines.push(`조사 보고(직업 주장은 증명이 아님): ${reports.join(" / ")}`);

  for (const m of s.log) {
    if (m.from !== "system") continue;
    const t = m.text;
    if (/살해당했|처형되었|처형되지|버텨냈|구해냈|조용히 지나갔|평화로운 밤/.test(t)) {
      lines.push(`${m.day}일차 사건: ${t.replace(/\n+/g, " ")}`);
    } else if (t.startsWith("투표 결과")) {
      const votes = t.split("\n").filter((x) => x.includes("→")).map((x) => x.replace(" → ", "→")).join(", ");
      lines.push(`${m.day}일차 투표: ${votes}`);
    } else if (t.startsWith("찬반 투표 결과")) {
      const tail = t.split("\n").filter(Boolean).pop() ?? "";
      lines.push(`${m.day}일차 찬반: ${tail}`);
    }
  }
  return lines.join("\n");
}

/** 지금 답해야 할 흐름: 직전 발언과, 이 AI에게 향한 말 */
export function focusBlock(s: GameState, viewer: Player): string {
  const talk = s.log.filter((m) => m.from !== "system");
  const last = talk[talk.length - 1];
  const label = (m: ChatMsg) =>
    m.from === viewer.id ? `${viewer.name}(당신)` : m.from === HUMAN_ID ? `플레이어(${s.players[HUMAN_ID].name})` : s.players[m.from as number].name;
  const toMe = talk
    .slice(-8)
    .filter((m) => m.from !== viewer.id && addresseeOf(s, m) === viewer.id)
    .map((m) => `${label(m)}: ${m.text}`);
  const out: string[] = [];
  if (last) out.push(`[직전 발언] ${label(last)}: ${last.text}`);
  if (toMe.length) out.push(`[당신에게 향한 말]\n${toMe.join("\n")}`);
  return out.join("\n");
}

/** 발언 앞부분에서 누구를 부르고 있는지 찾는다 ("서연님, ...", "태오야 ..."). 없으면 null */
export function addresseeOf(s: GameState, m: ChatMsg): number | null {
  if (m.from === "system") return null;
  const head = normalizeHuman(m.text, s.players).text.slice(0, 18);
  let best: { id: number; at: number } | null = null;
  for (const q of s.players) {
    if (q.id === m.from) continue;
    const re = new RegExp(`${q.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(님|씨|아|야|,|，)`);
    const hit = re.exec(head);
    if (hit && (best === null || hit.index < best.at)) best = { id: q.id, at: hit.index };
  }
  return best ? best.id : null;
}

/** 자기 자신을 이름(3인칭)으로 부르는 어색한 문장인지 검사. "저 서연은 ..."처럼 1인칭 자기소개는 허용 */
export function speaksOfSelf(text: string, name: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<!저\\s)(?<![가-힣])${esc}(이|가|은|는|님|의|도)(?=[\\s,.!?~]|$)`).test(text);
}
