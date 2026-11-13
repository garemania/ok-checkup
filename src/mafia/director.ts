import { HUMAN_ID, TALKATIVENESS } from "./data";
import { addresseeOf } from "./context";
import type { ChatMsg, GameState, Player } from "./types";

/**
 * 대화 진행자: 실제 사람들 대화처럼 "다음에 누가 말할지"를 정한다.
 * - 직전 발언이 누군가를 부르면 그 사람이 답한다
 * - 직전 발언이 누군가를 의심하면 그 사람이 반박한다
 * - 그 외에는 말 많은 성격일수록, 오늘 덜 말한 사람일수록 자주 끼어든다 (방금 말한 두 사람은 제외)
 */
export interface Turn {
  player: Player;
  hint: string;
  reason: "opener" | "addressed" | "accused" | "free";
  proxy?: boolean; // 사람 플레이어 대신 자동으로 하는 말
}

/** 사람 플레이어 대신 말할 때 붙이는 안내: 직업·조사 결과는 절대 밝히지 않는다 */
export const proxyHint = (s: GameState, inner: string) =>
  `[대리] 당신은 사람 플레이어(${s.players[HUMAN_ID].name})를 대신해 짧게 말합니다. 직업, 조사 결과, 마피아 동료를 절대 밝히지 말고, 직업 주장이나 조사 보고도 하지 마세요. 플레이어의 진영에 유리하게, 자연스럽게. ${inner}`;

const SUSPECT_RE = /(의심|수상|마피아|찜찜|이상하|거짓|가짜)/;
// "○○님은 믿어요", "시민 쪽으로 봐요"처럼 믿는다는 말은 지목이 아니다
export const TRUST_RE = /(믿|시민 쪽|시민쪽|결백|아닌 것 같|아니라고 봐)/;

const label = (s: GameState, m: ChatMsg) => (m.from === "system" ? "진행" : m.from === HUMAN_ID ? `플레이어(${s.players[HUMAN_ID].name})` : s.players[m.from].name);

/** 오늘 낮 토론의 첫 마디 (밤 결과는 이 사람만 짧게 언급) */
export function openerTurn(s: GameState, rng = Math.random): Turn | null {
  const cands = s.players.filter((p) => p.alive && !p.isHuman);
  if (!cands.length) return null;
  const player = weightedPick(cands, (p) => TALKATIVENESS[p.name] ?? 1, rng);
  return {
    player,
    reason: "opener",
    hint: `[시작] ${s.day}일차 낮 토론의 첫 마디를 하세요. 밤 결과("${s.lastNightResult}")는 한 번만 짧게 언급하고, 오늘 이야기할 거리를 하나 던지세요. 한두 문장으로 짧게.`,
  };
}

export function nextTurn(s: GameState, rng = Math.random, opts: { allowHuman?: boolean } = {}): Turn | null {
  const alive = s.players.filter((p) => p.alive && !p.isHuman);
  if (!alive.length) return null;
  const human = s.players[HUMAN_ID];
  const humanOk = !!opts.allowHuman && human.alive;
  const talk = s.log.filter((m) => m.from !== "system" && m.day === s.day);
  const last = talk[talk.length - 1];
  const recent = talk.slice(-2).map((m) => m.from);

  // 같은 두 사람이 계속 주고받고 있는지 (A,B,A 또는 A,B,A,B)
  const froms = talk.slice(-4).map((m) => m.from);
  const pingPong = froms.length >= 3 && froms[froms.length - 1] === froms[froms.length - 3] && froms[froms.length - 1] !== froms[froms.length - 2];
  const loopPair = pingPong ? [froms[froms.length - 1], froms[froms.length - 2]] : [];
  // 최근 대화에서 같은 사람 이야기가 계속 나오는지
  const recentTexts = talk.slice(-5).map((m) => m.text);
  const overused = s.players.find((p) => recentTexts.filter((t) => t.includes(p.name)).length >= 3);

  if (last && !pingPong) {
    const who = label(s, last);
    const to = addresseeOf(s, last);
    const addressed = to !== null ? s.players[to] : null;
    if (addressed && addressed.alive && !addressed.isHuman && addressed.id !== last.from) {
      return { player: addressed, reason: "addressed", hint: `[응답] ${who}가 방금 당신에게 말했습니다: "${last.text}" 그 말에 직접, 짧게 답하세요.` };
    }
    // 누가 나(사람 플레이어)를 부르거나 의심하면 자동으로 대신 답한다
    if (humanOk && last.from !== HUMAN_ID && (addressed?.id === HUMAN_ID || (SUSPECT_RE.test(last.text) && !TRUST_RE.test(last.text) && human.name.length >= 2 && last.text.includes(human.name)))) {
      return { player: human, reason: "addressed", proxy: true, hint: proxyHint(s, `[응답] ${who}가 방금 당신에게 말했습니다: "${last.text}" 그 말에 직접, 짧게 답하세요.`) };
    }
    // 이름이 나오면서 의심하는 말이면 그 사람이 반박
    if (SUSPECT_RE.test(last.text) && !TRUST_RE.test(last.text)) {
      const accused = alive.find((p) => p.id !== last.from && last.text.includes(p.name));
      if (accused && !recent.includes(accused.id)) {
        return { player: accused, reason: "accused", hint: `[지목] ${who}가 방금 당신을 의심했습니다: "${last.text}" 반박하거나 해명하세요. 짧게.` };
      }
    }
  }

  const spokenToday = (id: number) => talk.filter((m) => m.from === id).length;
  const everyone = humanOk ? [...alive, human] : alive;
  const pool = everyone.filter((p) => !recent.includes(p.id) && !loopPair.includes(p.id));
  const cands = pool.length ? pool : alive;
  const player = weightedPick(cands, (p) => (p.isHuman ? 0.9 : TALKATIVENESS[p.name] ?? 1) / (1 + spokenToday(p.id) * 0.6), rng);
  const lastName = last ? label(s, last) : "";
  const steer = pingPong
    ? ` [전환] ${loopPair.map((id) => (id === HUMAN_ID ? "플레이어" : s.players[id as number].name)).join("와(과) ")}가 같은 얘기를 계속 주고받고 있습니다. 그 얘기를 반복하지 말고, 다른 사람이나 다른 쟁점으로 대화를 넘기거나, 정리해서 결론(예: 누구에게 투표할지)을 제안하세요.`
    : overused
      ? ` [전환] ${overused.name} 이야기는 이미 충분히 나왔습니다. 새로운 근거가 없다면 다른 사람이나 다른 쟁점을 이야기하세요.`
      : "";
  const hint = last
    ? `[반응:${lastName}] 직전 발언(${lastName}: "${last.text}")에 자연스럽게 맞장구치거나, 반박하거나, 질문하거나, 새 의견을 내세요. 이미 나온 이야기(특히 밤 결과)와 이미 답이 나온 질문은 되풀이하지 마세요. 실제 단체 채팅처럼 보통 한 문장으로 짧게.${steer}`
    : `[시작] 오늘 낮 토론에서 하고 싶은 말을 짧게 하세요.`;
  if (player.isHuman) return { player, reason: "free", proxy: true, hint: proxyHint(s, hint) };
  return { player, reason: "free", hint };
}

function weightedPick<T>(items: T[], weight: (t: T) => number, rng: () => number): T {
  const ws = items.map((t) => Math.max(0.01, weight(t)));
  let r = rng() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
