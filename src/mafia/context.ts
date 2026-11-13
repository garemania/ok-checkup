import { HUMAN_ID } from "./data";
import { ROLE_LABEL } from "./types";
import type { ChatMsg, GameState, Player, Role } from "./types";

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
      const body = m.from === "system" ? m.text.replace(/\n+/g, " / ") : m.text;
      return `(${m.day}일차 ${PHASE_LABEL[m.phase] ?? ""}) ${who}: ${body}`;
    })
    .join("\n");
}

const CLAIM_RE = /(?:저는|제가|난|나는|내가)\s*(경찰|의사|군인|마피아|시민)(?:입니다|이에요|예요|이야|이다|임|이라고|라고)/;
const ROLE_BY_LABEL: Record<string, Role> = { 경찰: "police", 의사: "doctor", 군인: "soldier", 마피아: "mafia", 시민: "citizen" };

/** 대화에서 "저는 경찰입니다"처럼 스스로 직업을 밝힌 기록(마지막 주장 기준) */
export function detectClaims(s: GameState): Record<number, Role> {
  const out: Record<number, Role> = {};
  for (const m of s.log) {
    if (m.from === "system") continue;
    const hit = m.text.match(CLAIM_RE);
    if (hit) out[m.from] = ROLE_BY_LABEL[hit[1]];
  }
  return out;
}

/** 전체 기록에서 뽑은 핵심 사실 (최근 대화 40줄에서 밀려나도 잊지 않도록) */
export function factsBlock(s: GameState): string {
  const lines: string[] = [];
  const dead = s.players.filter((p) => !p.alive).map((p) => `${p.name}${p.revealed ? `(${ROLE_LABEL[p.role]} 공개)` : "(직업 비공개)"}`);
  lines.push(`사망자: ${dead.join(", ") || "없음"}`);

  const claims = detectClaims(s);
  const claimText = Object.entries(claims).map(([id, r]) => `${s.players[Number(id)].name}=${ROLE_LABEL[r]} 주장`);
  lines.push(`직업 주장: ${claimText.join(", ") || "아직 없음"}`);

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
  const head = m.text.slice(0, 18);
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
