import { useCallback, useEffect, useRef, useState } from "react";
import { makeAI } from "./ai";
import { HUMAN_ID, MAX_ROUNDS, MAX_WHISPERS_PER_DAY } from "./data";
import { addMsg, alive, aliveAI, createGame, finishIfWon, kill, mafiaPartners, me, nameOf, tallyVotes } from "./engine";
import type { GameState, Settings } from "./types";

const SETTINGS_KEY = "mafia-settings";
export const DEFAULT_SETTINGS: Settings = {
  mode: "mock",
  provider: "anthropic",
  geminiKey: "",
  geminiModel: "gemini-2.5-flash",
  apiKey: "",
  baseUrl: "https://api.anthropic.com",
  model: "claude-haiku-5-5",
  nickname: "나",
};

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useMafiaGame(onError: (msg: string) => void) {
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [state, setState] = useState<GameState | null>(null);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [typing, setTyping] = useState<number | null>(null); // 1:1 답장 작성 중인 AI
  const [unread, setUnread] = useState<Record<number, boolean>>({});
  const ref = useRef<GameState | null>(null);
  const runId = useRef(0);

  const commit = useCallback((fn: (s: GameState) => GameState) => {
    if (!ref.current) return;
    ref.current = fn(ref.current);
    setState(ref.current);
  }, []);

  const setSettings = (s: Settings) => {
    setSettingsState(s);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  };

  const ai = useCallback(() => makeAI(settings, (e) => onError(`API 호출 실패 → 오프라인 AI로 대체합니다. (${e.message})`)), [settings, onError]);

  const alivePhaseGuard = (id: number) => runId.current === id;

  /* ---------------- 게임 시작 ---------------- */
  const startGame = () => {
    runId.current++;
    ref.current = createGame(settings.nickname);
    setState(ref.current);
    setBusy(false);
    setSpeaking(null);
    setTyping(null);
    setUnread({});
    commit((s) => addMsg(s, "system", "1일차 밤이 되었습니다. 마을에 어둠이 내립니다.", "night"));
  };

  const quit = () => {
    runId.current++;
    ref.current = null;
    setState(null);
    setBusy(false);
  };

  /* ---------------- 밤 ---------------- */
  const runNight = async (humanTarget?: number) => {
    const s0 = ref.current;
    if (!s0 || busy) return;
    const id = runId.current;
    setBusy(true);
    const engine = ai();
    const players = s0.players;
    const hum = players[HUMAN_ID];

    const decide = async (role: "mafia" | "doctor" | "police", kind: "kill" | "protect" | "investigate") => {
      const actors = players.filter((p) => p.role === role && p.alive);
      if (!actors.length) return null;
      const human = actors.find((a) => a.isHuman);
      if (human && humanTarget !== undefined) return { actor: human.id, target: humanTarget };
      const a = actors.find((x) => !x.isHuman);
      if (!a) return null;
      return { actor: a.id, target: await engine.nightTarget(s0, a, kind) };
    };

    const [k, d, p] = await Promise.all([decide("mafia", "kill"), decide("doctor", "protect"), decide("police", "investigate")]);
    if (!alivePhaseGuard(id)) return;
    await sleep(600);

    let s = ref.current!;
    if (p) {
      const target = s.players[p.target];
      const inv = { target: p.target, isMafia: target.role === "mafia", day: s.day };
      s = { ...s, policeLog: { ...s.policeLog, [p.actor]: [...(s.policeLog[p.actor] ?? []), inv] } };
    }
    let result: string;
    const victim = k ? k.target : null;
    if (victim !== null && d && d.target === victim) {
      result = "밤사이 마피아의 습격이 있었지만, 의사가 누군가를 구해냈습니다. 아무도 죽지 않았습니다.";
    } else if (victim !== null) {
      s = kill(s, victim, false);
      result = `밤사이 ${nameOf(s, victim)}님이 마피아에게 살해당했습니다.`;
    } else {
      result = "평화로운 밤이 지나갔습니다.";
    }
    ref.current = s;
    commit((x) => ({ ...x, lastNightResult: result, phase: "day", round: 0, votes: {} }));
    commit((x) => addMsg(x, "system", `☀️ ${x.day}일차 낮이 밝았습니다. ${result}`, "day"));
    commit(finishIfWon);
    setBusy(false);
    void hum;
  };

  // 사망한 플레이어는 밤이 자동 진행
  useEffect(() => {
    if (state?.phase === "night" && !state.players[HUMAN_ID].alive && !busy) {
      const t = setTimeout(() => void runNight(), 1200);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.phase, state?.day, busy]);

  /* ---------------- 낮 토론 ---------------- */
  const speakerOrder = () => [...aliveAI(ref.current!)].sort(() => Math.random() - 0.5);

  const runRound = async () => {
    const s0 = ref.current;
    if (!s0 || busy || s0.phase !== "day" || s0.round >= MAX_ROUNDS) return;
    const id = runId.current;
    setBusy(true);
    const engine = ai();
    for (const p of speakerOrder()) {
      if (!alivePhaseGuard(id)) return;
      setSpeaking(p.id);
      const text = await engine.speak(ref.current!, ref.current!.players[p.id]);
      if (!alivePhaseGuard(id)) return;
      commit((x) => addMsg(x, p.id, text));
      await sleep(250);
    }
    setSpeaking(null);
    commit((x) => ({ ...x, round: x.round + 1 }));
    setBusy(false);
  };

  const sendPublic = async (text: string) => {
    const s0 = ref.current;
    if (!s0 || busy || !text.trim() || !s0.players[HUMAN_ID].alive || s0.phase !== "day") return;
    const id = runId.current;
    commit((x) => addMsg(x, HUMAN_ID, text.trim()));
    setBusy(true);
    const engine = ai();
    const cur = ref.current!;
    const mentioned = aliveAI(cur).filter((p) => text.includes(p.name));
    const others = aliveAI(cur).filter((p) => !mentioned.includes(p)).sort(() => Math.random() - 0.5);
    const responders = [...mentioned, ...others].slice(0, Math.max(2, mentioned.length));
    for (const p of responders) {
      if (!alivePhaseGuard(id)) return;
      setSpeaking(p.id);
      const reply = await engine.speak(ref.current!, ref.current!.players[p.id],
        `플레이어(${cur.players[HUMAN_ID].name})가 방금 발언했습니다. ${mentioned.includes(p) ? "당신이 직접 언급되었으니 응답하세요." : "자연스럽게 반응하거나 의견을 덧붙이세요."}`);
      if (!alivePhaseGuard(id)) return;
      commit((x) => addMsg(x, p.id, reply));
      await sleep(200);
    }
    setSpeaking(null);
    setBusy(false);
  };

  /* ---------------- 투표 ---------------- */
  const startVote = () => {
    const s = ref.current;
    if (!s || busy || s.phase !== "day") return;
    commit((x) => addMsg({ ...x, phase: "vote", votes: {} }, "system", "🗳 투표 시간입니다. 처형할 사람을 선택하세요.", "vote"));
  };

  const runVote = async (humanTarget: number | null) => {
    const s0 = ref.current;
    if (!s0 || busy || s0.phase !== "vote") return;
    const id = runId.current;
    setBusy(true);
    const engine = ai();
    const voters = alive(s0);
    const results = await Promise.all(
      voters.map(async (p) => [p.id, p.isHuman ? humanTarget : await engine.vote(s0, p)] as const),
    );
    if (!alivePhaseGuard(id)) return;
    const votes: Record<number, number | null> = Object.fromEntries(results);
    commit((x) => ({ ...x, votes }));
    for (const [voter, t] of results) {
      commit((x) => addMsg(x, "system", `${nameOf(x, voter)} → ${t === null ? "기권" : nameOf(x, t)}`, "vote"));
      await sleep(350);
      if (!alivePhaseGuard(id)) return;
    }
    const { executed } = tallyVotes(ref.current!, votes);
    if (executed === null) {
      commit((x) => addMsg(x, "system", "동점이거나 표가 없어 아무도 처형되지 않았습니다.", "vote"));
    } else {
      commit((x) => kill(x, executed, true));
      commit((x) => addMsg(x, "system", `⚖️ ${nameOf(x, executed)}님이 처형되었습니다. 정체는 ${({ mafia: "마피아", police: "경찰", doctor: "의사", citizen: "시민" })[x.players[executed].role]}였습니다.`, "vote"));
    }
    commit(finishIfWon);
    if (ref.current!.phase !== "gameover") {
      await sleep(900);
      commit((x) => addMsg({ ...x, phase: "night", day: x.day + 1, round: 0, whispersUsed: 0, votes: {} }, "system", `🌙 ${x.day + 1}일차 밤이 되었습니다.`, "night"));
    }
    setBusy(false);
  };

  /* ---------------- 1:1 대화 ---------------- */
  const whisperBlockReason = (targetId: number): string | null => {
    const s = ref.current;
    if (!s) return "게임 중이 아닙니다.";
    const t = s.players[targetId];
    if (!s.players[HUMAN_ID].alive) return "사망하여 대화할 수 없습니다.";
    if (!t.alive) return "이미 사망한 캐릭터입니다.";
    if (s.phase === "night" && !(s.players[HUMAN_ID].role === "mafia" && t.role === "mafia")) return "밤에는 마피아 동료끼리만 대화할 수 있습니다.";
    if (s.phase === "gameover") return "게임이 끝났습니다.";
    if (s.whispersUsed >= MAX_WHISPERS_PER_DAY) return `하루 1:1 대화 횟수(${MAX_WHISPERS_PER_DAY}회)를 모두 사용했습니다.`;
    return null;
  };

  const sendWhisper = async (targetId: number, text: string) => {
    if (!text.trim() || whisperBlockReason(targetId) || typing !== null) return;
    const id = runId.current;
    const wmsg = (from: number, t: string) => (x: GameState): GameState => ({
      ...x,
      whispers: { ...x.whispers, [targetId]: [...(x.whispers[targetId] ?? []), { id: x.nextMsgId, day: x.day, from, text: t }] },
      nextMsgId: x.nextMsgId + 1,
    });
    commit(wmsg(HUMAN_ID, text.trim()));
    commit((x) => ({ ...x, whispersUsed: x.whispersUsed + 1 }));
    setTyping(targetId);
    const engine = ai();
    const s = ref.current!;
    const reply = await engine.whisper(s, s.players[targetId], text.trim());
    if (!alivePhaseGuard(id)) return;
    commit(wmsg(targetId, reply));
    setTyping(null);
    setUnread((u) => ({ ...u, [targetId]: true }));
  };

  const clearUnread = (id: number) => setUnread((u) => ({ ...u, [id]: false }));

  const helpers = {
    human: state ? me(state) : null,
    partners: state ? mafiaPartners(state, HUMAN_ID) : [],
  };

  return {
    settings, setSettings, state, busy, speaking, typing, unread, clearUnread,
    startGame, quit, runNight, runRound, sendPublic, startVote, runVote,
    sendWhisper, whisperBlockReason, ...helpers,
  };
}
