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
}

const SUSPECT_RE = /(의심|수상|마피아|찜찜|이상하|거짓|가짜)/;

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

export function nextTurn(s: GameState, rng = Math.random): Turn | null {
  const alive = s.players.filter((p) => p.alive && !p.isHuman);
  if (!alive.length) return null;
  const talk = s.log.filter((m) => m.from !== "system" && m.day === s.day);
  const last = talk[talk.length - 1];
  const recent = talk.slice(-2).map((m) => m.from);

  if (last) {
    const who = label(s, last);
    const to = addresseeOf(s, last);
    const addressed = to !== null ? s.players[to] : null;
    if (addressed && addressed.alive && !addressed.isHuman && addressed.id !== last.from) {
      return { player: addressed, reason: "addressed", hint: `[응답] ${who}가 방금 당신에게 말했습니다: "${last.text}" 그 말에 직접, 짧게 답하세요.` };
    }
    // 이름이 나오면서 의심하는 말이면 그 사람이 반박
    if (SUSPECT_RE.test(last.text)) {
      const accused = alive.find((p) => p.id !== last.from && last.text.includes(p.name));
      if (accused && !recent.includes(accused.id)) {
        return { player: accused, reason: "accused", hint: `[지목] ${who}가 방금 당신을 의심했습니다: "${last.text}" 반박하거나 해명하세요. 짧게.` };
      }
    }
  }

  const spokenToday = (id: number) => talk.filter((m) => m.from === id).length;
  const pool = alive.filter((p) => !recent.includes(p.id));
  const cands = pool.length ? pool : alive;
  const player = weightedPick(cands, (p) => (TALKATIVENESS[p.name] ?? 1) / (1 + spokenToday(p.id) * 0.6), rng);
  const lastName = last ? label(s, last) : "";
  const hint = last
    ? `[반응:${lastName}] 직전 발언(${lastName}: "${last.text}")에 자연스럽게 맞장구치거나, 반박하거나, 질문하거나, 새 의견을 내세요. 이미 나온 이야기(특히 밤 결과)는 되풀이하지 마세요. 실제 단체 채팅처럼 보통 한 문장으로 짧게.`
    : `[시작] 오늘 낮 토론에서 하고 싶은 말을 짧게 하세요.`;
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
