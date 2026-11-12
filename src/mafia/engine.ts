import { AI_CHARS, HUMAN_CHAR, HUMAN_ID, ROLE_POOL } from "./data";
import type { ChatMsg, GameState, Phase, Player } from "./types";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export function createGame(nickname: string): GameState {
  const roles = shuffle(ROLE_POOL);
  const chars = [{ ...HUMAN_CHAR, name: nickname || HUMAN_CHAR.name }, ...AI_CHARS];
  const players: Player[] = chars.map((c, i) => ({
    id: i,
    name: c.name,
    emoji: c.emoji,
    color: c.color,
    persona: c.persona,
    speech: c.speech,
    role: roles[i],
    alive: true,
    isHuman: i === HUMAN_ID,
    revealed: false,
  }));
  return {
    phase: "night",
    day: 1,
    round: 0,
    players,
    log: [],
    whispers: {},
    whispersUsed: 0,
    investigations: [],
    policeLog: {},
    votes: {},
    lastNightResult: "",
    nextMsgId: 1,
  };
}

export const alive = (s: GameState) => s.players.filter((p) => p.alive);
export const aliveAI = (s: GameState) => alive(s).filter((p) => !p.isHuman);
export const me = (s: GameState) => s.players[HUMAN_ID];
export const nameOf = (s: GameState, id: number) => s.players[id].name;

export function mafiaPartners(s: GameState, id: number): Player[] {
  if (s.players[id].role !== "mafia") return [];
  return s.players.filter((p) => p.role === "mafia" && p.id !== id);
}

export function addMsg(s: GameState, from: ChatMsg["from"], text: string, phase?: Phase): GameState {
  const msg: ChatMsg = { id: s.nextMsgId, day: s.day, phase: phase ?? s.phase, from, text };
  return { ...s, log: [...s.log, msg], nextMsgId: s.nextMsgId + 1 };
}

export function checkWin(s: GameState): "mafia" | "citizen" | undefined {
  const m = alive(s).filter((p) => p.role === "mafia").length;
  const c = alive(s).length - m;
  if (m === 0) return "citizen";
  if (m >= c) return "mafia";
  return undefined;
}

export function kill(s: GameState, id: number, reveal: boolean): GameState {
  return {
    ...s,
    players: s.players.map((p) => (p.id === id ? { ...p, alive: false, revealed: reveal || p.revealed } : p)),
  };
}

export function finishIfWon(s: GameState): GameState {
  const w = checkWin(s);
  if (!w) return s;
  const msg = w === "citizen" ? "마피아가 모두 제거되었습니다. 시민 승리!" : "마피아가 시민과 같은 수가 되었습니다. 마피아 승리!";
  return addMsg({ ...s, phase: "gameover", winner: w, players: s.players.map((p) => ({ ...p, revealed: true })) }, "system", msg, "gameover");
}

export function tallyVotes(s: GameState, votes: Record<number, number | null>): { executed: number | null; counts: Record<number, number> } {
  const counts: Record<number, number> = {};
  Object.values(votes).forEach((t) => {
    if (t !== null && t !== undefined) counts[t] = (counts[t] ?? 0) + 1;
  });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return { executed: null, counts };
  if (entries.length > 1 && entries[0][1] === entries[1][1]) return { executed: null, counts };
  return { executed: Number(entries[0][0]), counts };
}

/** 공개 로그를 AI 프롬프트용 텍스트로 */
export function logToText(s: GameState, limit = 40): string {
  return s.log
    .slice(-limit)
    .map((m) => {
      const who = m.from === "system" ? "[시스템]" : s.players[m.from].name;
      const when = m.phase === "night" ? "밤" : m.phase === "vote" ? "투표" : "낮";
      return `(${m.day}일차 ${when}) ${who}: ${m.text}`;
    })
    .join("\n");
}
