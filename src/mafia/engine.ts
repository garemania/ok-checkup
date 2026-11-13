import { AI_CHARS, HUMAN_CHAR, HUMAN_ID, ROLE_POOL } from "./data";
import type { ChatMsg, Emotion, GameState, Phase, Player } from "./types";

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
    look: c.look,
    role: roles[i],
    alive: true,
    isHuman: i === HUMAN_ID,
    revealed: false,
    shield: roles[i] === "soldier",
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
    doctorLog: {},
    mafiaLog: [],
    votes: {},
    accused: null,
    trialStage: null,
    actionsUsed: 0,
    autoUsed: 0,
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

export function addMsg(s: GameState, from: ChatMsg["from"], text: string, phase?: Phase, emotion?: ChatMsg["emotion"]): GameState {
  const msg: ChatMsg = { id: s.nextMsgId, day: s.day, phase: phase ?? s.phase, from, text, emotion };
  return { ...s, log: [...s.log, msg], nextMsgId: s.nextMsgId + 1 };
}

export function checkWin(s: GameState): "mafia" | "citizen" | undefined {
  const m = alive(s).filter((p) => p.role === "mafia").length;
  const c = alive(s).length - m;
  if (m === 0) return "citizen";
  if (m >= c) return "mafia";
  return undefined;
}

/** 사망 처리. reveal=true면 처형(직업 공개), false면 밤의 살해(직업 비공개) */
export function kill(s: GameState, id: number, reveal: boolean): GameState {
  return {
    ...s,
    players: s.players.map((p) =>
      p.id === id ? { ...p, alive: false, revealed: reveal || p.revealed, death: { day: s.day, cause: reveal ? "executed" : "killed" } } : p,
    ),
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
      const when = m.phase === "night" ? "밤" : m.phase === "vote" ? "투표" : m.phase === "trial" ? "재판" : "낮";
      return `(${m.day}일차 ${when}) ${who}: ${m.text}`;
    })
    .join("\n");
}

/** 받침 유무에 따라 "이었습니다"/"였습니다" 선택 */
export function hasBatchim(word: string): boolean {
  const code = word.charCodeAt(word.length - 1);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
}

export function wasPhrase(word: string): string {
  return `${word}${hasBatchim(word) ? "이었" : "였"}습니다`;
}

/** 캐릭터의 현재 표정: 사망이면 dead, 아니면 마지막 공개 발언의 감정 */
export function emotionOf(s: GameState, id: number): Emotion | "dead" {
  if (!s.players[id].alive) return "dead";
  for (let i = s.log.length - 1; i >= 0; i--) {
    const m = s.log[i];
    if (m.from === id && m.emotion) return m.emotion;
  }
  return "neutral";
}

/**
 * 밤 결과 처리. 첫 밤(1일차)에는 마피아가 습격하지 않고, 경찰 조사만 진행된다.
 * 아침 안내는 누가 죽었는지만 알려준다. 아무도 죽지 않은 이유(의사의 보호인지 군인의 방어인지)는 누구에게도 알려주지 않는다.
 */
export function resolveNight(
  s: GameState,
  a: { kill: number | null; protect: number | null; protector?: number; investigate: { actor: number; target: number } | null },
): { state: GameState; result: string } {
  let st = s;
  if (a.investigate) {
    const { actor, target } = a.investigate;
    const inv = { target, isMafia: st.players[target].role === "mafia", day: st.day };
    st = { ...st, policeLog: { ...st.policeLog, [actor]: [...(st.policeLog[actor] ?? []), inv] } };
  }
  if (st.day === 1) return { state: st, result: "첫 밤은 조용히 지나갔습니다. 마피아의 습격은 없었습니다. (경찰 조사 같은 능력은 첫 밤에도 정상적으로 사용할 수 있습니다.)" };

  let died: number | null = null;
  if (a.kill !== null) {
    const victim = st.players[a.kill];
    const blocked = a.protect === a.kill || (victim.role === "soldier" && victim.shield);
    st = { ...st, mafiaLog: [...st.mafiaLog, { day: st.day, target: victim.id, result: blocked ? "failed" : "killed" }] };
    if (a.protect !== a.kill && victim.role === "soldier" && victim.shield) {
      st = { ...st, players: st.players.map((p) => (p.id === victim.id ? { ...p, shield: false } : p)) };
    }
    if (!blocked) {
      st = kill(st, victim.id, false);
      died = victim.id;
    }
  }
  if (a.protector !== undefined && a.protect !== null) {
    const rec = { day: st.day, target: a.protect, quiet: died === null };
    st = { ...st, doctorLog: { ...st.doctorLog, [a.protector]: [...(st.doctorLog[a.protector] ?? []), rec] } };
  }
  return { state: st, result: died !== null ? `밤사이 ${st.players[died].name}님이 마피아에게 살해당했습니다.` : "밤사이 아무도 죽지 않았습니다." };
}

/** 최후 찬반 투표: 찬성이 반대보다 많아야 처형 */
export function tallyVerdict(votes: Record<number, boolean>): { yes: number; no: number; execute: boolean } {
  const vals = Object.values(votes);
  const yes = vals.filter(Boolean).length;
  const no = vals.length - yes;
  return { yes, no, execute: yes > no };
}
