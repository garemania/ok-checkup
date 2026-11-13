import { useCallback, useEffect, useRef, useState } from "react";
import { makeAI, speakLastWords } from "./ai";
import { nextTurn, openerTurn } from "./director";
import { HUMAN_ID, MAX_ACTIONS_PER_DAY, MAX_ROUNDS, MAX_WHISPERS_PER_DAY } from "./data";
import { detectClaims, interpretByRules, normalizeHuman } from "./context";
import { addMsg, alive, aliveAI, createGame, finishIfWon, kill, mafiaPartners, me, hasBatchim, nameOf, resolveNight, tallyVerdict, tallyVotes, wasPhrase } from "./engine";
import { ROLE_LABEL } from "./types";
import type { Emotion, GameState, Meaning, Player, Role, Settings } from "./types";

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

export type DayAction =
  | { kind: "suspect" | "trust" | "ask"; target: number }
  | { kind: "report"; target: number; result: "clean" | "mafia" }
  | { kind: "claim"; role: Role };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useMafiaGame(onError: (msg: string) => void) {
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [state, setState] = useState<GameState | null>(null);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [typing, setTyping] = useState<number | null>(null); // 1:1 답장 작성 중인 AI
  const [errors, setErrors] = useState<string[]>([]); // 최근 API 오류 (설정 화면에서 확인/복사)
  const [unread, setUnread] = useState<Record<number, boolean>>({});
  const ref = useRef<GameState | null>(null);
  const runId = useRef(0);
  // 대사를 한 줄씩 보여주고 사용자가 "다음"을 눌러야 넘어가게 하는 장치
  const [waiting, setWaiting] = useState(false);
  const nextResolver = useRef<(() => void) | null>(null);
  const waitNext = () =>
    new Promise<void>((resolve) => {
      nextResolver.current = resolve;
      setWaiting(true);
    });
  // 재판 중 사용자의 변론/찬반 입력을 기다리는 장치
  const [awaitingHuman, setAwaitingHuman] = useState(false);
  const humanResolver = useRef<((v: unknown) => void) | null>(null);
  const waitHuman = <T,>() =>
    new Promise<T>((resolve) => {
      humanResolver.current = resolve as (v: unknown) => void;
      setAwaitingHuman(true);
    });
  const resolveHuman = (v: unknown) => {
    const r = humanResolver.current;
    humanResolver.current = null;
    setAwaitingHuman(false);
    r?.(v);
  };
  // AI들이 대화하는 도중(다음 대기 중) 사용자가 끼어들어 한 말
  const interruptRef = useRef<string | null>(null);
  const advance = useCallback(() => {
    const r = nextResolver.current;
    nextResolver.current = null;
    setWaiting(false);
    r?.();
  }, []);

  const commit = useCallback((fn: (s: GameState) => GameState) => {
    if (!ref.current) return;
    ref.current = fn(ref.current);
    setState(ref.current);
  }, []);

  const setSettings = (s: Settings) => {
    setSettingsState(s);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  };

  const ai = useCallback(() => makeAI(settings, (e) => {
    setErrors((prev) => [`[${new Date().toLocaleTimeString("ko-KR")}] ${e.message}`, ...prev].slice(0, 5));
    onError(`API 호출 실패 → 오프라인 AI로 대체합니다. (${e.message})`);
  }), [settings, onError]);

  const alivePhaseGuard = (id: number) => runId.current === id;

  /* ---------------- 게임 시작 ---------------- */
  const startGame = () => {
    runId.current++;
    interruptRef.current = null;
    advance();
    resolveHuman(null);
    ref.current = createGame(settings.nickname);
    setState(ref.current);
    setBusy(false);
    setSpeaking(null);
    setTyping(null);
    setUnread({});
    commit((s) => addMsg(s, "system", "1일차 밤이 되었습니다. 마을에 어둠이 내립니다. 첫 밤에는 마피아의 살해만 없고, 경찰 조사 같은 능력은 정상적으로 사용할 수 있습니다.", "night"));
  };

  const quit = () => {
    runId.current++;
    interruptRef.current = null;
    advance();
    resolveHuman(null);
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
    const firstNight = s0.day === 1; // 첫 밤에는 습격/보호가 없고 경찰 조사만 한다

    const decide = async (role: "mafia" | "doctor" | "police", kind: "kill" | "protect" | "investigate") => {
      const actors = players.filter((p) => p.role === role && p.alive);
      if (!actors.length) return null;
      const human = actors.find((a) => a.isHuman);
      if (human && humanTarget !== undefined) return { actor: human.id, target: humanTarget };
      const a = actors.find((x) => !x.isHuman);
      if (!a) return null;
      return { actor: a.id, target: await engine.nightTarget(s0, a, kind) };
    };

    const [k, d, p] = await Promise.all([
      firstNight ? null : decide("mafia", "kill"),
      firstNight ? null : decide("doctor", "protect"),
      decide("police", "investigate"),
    ]);
    if (!alivePhaseGuard(id)) return;
    await sleep(600);

    const { state: after, result } = resolveNight(ref.current!, {
      kill: k ? k.target : null,
      protect: d ? d.target : null,
      investigate: p ? { actor: p.actor, target: p.target } : null,
    });
    ref.current = after;
    commit((x) => ({ ...x, lastNightResult: result, phase: "day", round: 0, votes: {}, accused: null, trialStage: null, actionsUsed: 0 }));
    commit((x) => addMsg(x, "system", `${x.day}일차 낮이 밝았습니다. ${result}`, "day"));
    commit(finishIfWon);
    if (ref.current!.phase === "day") {
      // 아침 안내를 읽고 "다음"을 누르면 한 명이 토론의 첫 마디를 꺼낸다
      await waitNext();
      if (!alivePhaseGuard(id)) return;
      const opener = openerTurn(ref.current!);
      if (opener) {
        const ok = await converse(id, 1, opener);
        if (!ok) return;
      }
    }
    setSpeaking(null);
    setBusy(false);
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

  /** 대화 한 묶음: 진행자가 고른 사람이 차례로 말한다 (3~5줄). 버튼 "대화 진행" */
  const runRound = async () => {
    const s0 = ref.current;
    if (!s0 || busy || s0.phase !== "day" || s0.round >= MAX_ROUNDS) return;
    const id = runId.current;
    setBusy(true);
    commit((x) => ({ ...x, round: x.round + 1 }));
    const lines = 3 + Math.floor(Math.random() * 3);
    const ok = await converse(id, lines);
    if (!ok) return;
    setSpeaking(null);
    setBusy(false);
  };

  /** 진행자가 정한 순서로 n줄 대화. 마지막 줄 뒤에는 멈추지 않는다. 사용자가 끼어들면 그 말을 처리하고 끝낸다. 중단되면 false */
  const converse = async (id: number, lines: number, first?: ReturnType<typeof nextTurn>): Promise<boolean> => {
    const engine = ai();
    for (let i = 0; i < lines; i++) {
      if (!alivePhaseGuard(id)) return false;
      const turn = i === 0 && first ? first : nextTurn(ref.current!);
      if (!turn) break;
      setSpeaking(turn.player.id);
      const said = await engine.speak(ref.current!, ref.current!.players[turn.player.id], turn.hint);
      if (!alivePhaseGuard(id)) return false;
      setSpeaking(null);
      commit((x) => addMsg(x, turn.player.id, said.text, undefined, said.emotion));
      if (i < lines - 1) {
        await waitNext();
        if (!alivePhaseGuard(id)) return false;
        if (await handleInterrupt(id)) return alivePhaseGuard(id);
      }
    }
    return true;
  };

  /** 대기 중 끼어든 말이 있으면 처리한다. 처리했으면 true */
  const handleInterrupt = async (id: number): Promise<boolean> => {
    const t = interruptRef.current;
    if (!t) return false;
    interruptRef.current = null;
    await humanSpeaks(id, t);
    return true;
  };


  /** 지정한 캐릭터들이 한 줄씩 말한다 (마지막 줄 전까지는 "다음"을 기다린다). 중단되면 false */
  const respond = async (id: number, items: { player: Player; hint: string }[]): Promise<boolean> => {
    const engine = ai();
    for (let i = 0; i < items.length; i++) {
      const { player, hint } = items[i];
      if (!alivePhaseGuard(id)) return false;
      setSpeaking(player.id);
      const said = await engine.speak(ref.current!, ref.current!.players[player.id], hint);
      if (!alivePhaseGuard(id)) return false;
      setSpeaking(null);
      commit((x) => addMsg(x, player.id, said.text, undefined, said.emotion));
      if (i < items.length - 1) {
        await waitNext();
        if (!alivePhaseGuard(id)) return false;
        if (await handleInterrupt(id)) return alivePhaseGuard(id);
      }
    }
    return true;
  };

  /** 조사 보고에 대한 반응 목록: 조사 대상이 먼저, 다른 두 명이 이어서 */
  const reportItems = (s0: GameState, target: number, result: "clean" | "mafia") => {
    const me0 = s0.players[HUMAN_ID].name;
    const t = s0.players[target];
    const verdict = result === "mafia" ? "마피아" : "마피아 아님(시민 쪽)";
    const tag = `[조사보고:${t.id}:${result}]`;
    const items: { player: Player; hint: string }[] = [];
    if (t.alive && !t.isHuman)
      items.push({ player: t, hint: `${tag} ${me0}가 자신이 경찰이라며 당신을 조사한 결과 "${verdict}"라고 공개 보고했습니다. 당신이 조사 대상입니다. [비공개 정보]의 당신의 실제 직업과 이 보고가 맞는지 규칙에 따라 판단해 반응하세요. 대상과 결과는 이미 나왔으니 다시 묻지 마세요.` });
    aliveAI(s0).filter((p) => p.id !== t.id).sort(() => Math.random() - 0.5).slice(0, 2).forEach((p) =>
      items.push({ player: p, hint: `${tag} ${me0}가 자신이 경찰이라며 ${t.name}님을 조사한 결과 "${verdict}"라고 공개 보고했습니다. 당신은 조사 대상이 아닙니다. 보고의 신빙성을 규칙과 당신의 직업 정보에 비추어 판단해 반응하세요. 당신이 진짜 경찰이면 즉시 반박하세요. 대상과 결과는 이미 나왔으니 다시 묻지 마세요.` }),
    );
    return items;
  };

  const claimItems = (s0: GameState, role: Role) => {
    const me0 = s0.players[HUMAN_ID].name;
    const label = ROLE_LABEL[role];
    return aliveAI(s0).sort(() => Math.random() - 0.5).slice(0, 2).map((p) => ({ player: p, hint: `[주장:${label}] ${me0}가 자신이 ${label}${hasBatchim(label) ? "이" : ""}라고 공개적으로 주장했습니다. 게임 규칙(직업 주장은 증명이 아님, 진짜 경찰은 1명)과 당신의 실제 직업에 비추어 믿을지 의심할지 근거와 함께 반응하세요.` }));
  };

  const setMeaning = (msgId: number, meaning: Meaning) =>
    commit((x) => ({ ...x, log: x.log.map((m) => (m.id === msgId ? { ...m, meaning } : m)) }));

  /** 사람 플레이어의 발언을 기록하고, 해석한 뒤, 알맞은 캐릭터들이 반응한다 (busy 상태에서 호출) */
  const humanSpeaks = async (id: number, text: string): Promise<boolean> => {
    commit((x) => addMsg(x, HUMAN_ID, text.trim()));
    const msgId = ref.current!.nextMsgId - 1;
    // 자유 발언을 직업 주장/조사 보고로 해석해 둔다 (API: LLM 해석, 실패 또는 오프라인: 규칙 기반)
    const llmMeaning = await ai().interpret(ref.current!, text.trim());
    if (!alivePhaseGuard(id)) return false;
    const wasPolice = detectClaims({ ...ref.current!, log: ref.current!.log.filter((m) => m.id !== msgId) })[HUMAN_ID] === "police";
    const meaning = llmMeaning ?? interpretByRules(text.trim(), ref.current!.players, HUMAN_ID, wasPolice);
    if (llmMeaning) setMeaning(msgId, llmMeaning);
    const cur = ref.current!;
    const me0 = cur.players[HUMAN_ID].name;
    const normalized = normalizeHuman(text, cur.players).text;
    let items: { player: Player; hint: string }[];
    if (meaning.reports?.length) {
      const r = meaning.reports[0];
      items = reportItems(cur, r.target, r.result);
    } else if (meaning.claim) {
      items = claimItems(cur, meaning.claim);
    } else {
      const mentioned = aliveAI(cur).filter((p) => normalized.includes(p.name));
      const others = aliveAI(cur).filter((p) => !mentioned.includes(p)).sort(() => Math.random() - 0.5);
      const responders = [...mentioned, ...others].slice(0, Math.max(2, mentioned.length));
      items = responders.map((p) => ({
        player: p,
        hint: `플레이어(${me0})가 방금 발언했습니다.${meaning.summary ? ` (발언 해석: ${meaning.summary})` : ""} ${mentioned.includes(p) ? "당신이 직접 언급되었으니 응답하세요." : "자연스럽게 반응하거나 의견을 덧붙이세요."}`,
      }));
    }
    return respond(id, items);
  };

  const sendPublic = async (text: string) => {
    const s0 = ref.current;
    if (!s0 || !text.trim() || !s0.players[HUMAN_ID].alive || s0.phase !== "day") return;
    if (busy) {
      // AI들이 대화하는 중 "다음"을 기다리는 동안이면 끼어든다
      if (waiting && !interruptRef.current) {
        interruptRef.current = text.trim();
        advance();
      }
      return;
    }
    const id = runId.current;
    setBusy(true);
    const ok = await humanSpeaks(id, text.trim());
    if (!ok) return;
    setSpeaking(null);
    setBusy(false);
  };

  /* ---------------- 낮 행동 (지목 / 옹호 / 추궁 / 직업 주장) ---------------- */
  const doAction = async (a: DayAction) => {
    const s0 = ref.current;
    if (!s0 || busy || s0.phase !== "day" || !s0.players[HUMAN_ID].alive || s0.actionsUsed >= MAX_ACTIONS_PER_DAY) return;
    const id = runId.current;
    const me0 = s0.players[HUMAN_ID].name;
    const shuffled = (excl: number[]) => aliveAI(s0).filter((p) => !excl.includes(p.id)).sort(() => Math.random() - 0.5);
    let text: string;
    let emotion: Emotion;
    let items: { player: Player; hint: string }[];
    if (a.kind === "claim") {
      const label = ROLE_LABEL[a.role];
      text = `저는 ${label}입니다.`;
      emotion = "neutral";
      items = claimItems(s0, a.role);
    } else if (a.kind === "report") {
      const t = s0.players[a.target];
      text = `저는 경찰입니다. 조사해 보니 ${t.name}님은 ${a.result === "mafia" ? "마피아입니다" : "마피아가 아닙니다"}.`;
      emotion = a.result === "mafia" ? "suspicious" : "neutral";
      items = reportItems(s0, a.target, a.result);
    } else {
      const t = s0.players[a.target];
      const rest = shuffled([t.id]);
      if (a.kind === "suspect") {
        text = `${t.name}님이 수상합니다. 이번 투표에서 ${t.name}님을 의심합니다.`;
        emotion = "suspicious";
        items = [{ player: t, hint: `[지목] ${me0}가 당신을 마피아로 공개 지목했습니다. 반박하거나 대응하세요.` }];
        if (rest[0]) items.push({ player: rest[0], hint: `플레이어(${me0})가 ${t.name}님을 의심한다고 공개적으로 지목했습니다. 당신의 생각을 말하세요.` });
      } else if (a.kind === "trust") {
        text = `${t.name}님은 믿어도 된다고 생각합니다.`;
        emotion = "happy";
        items = [{ player: t, hint: `[옹호] ${me0}가 당신을 믿는다고 공개적으로 말했습니다. 짧게 반응하세요.` }];
      } else {
        text = `${t.name}님, 지금까지 하신 말이 의심됩니다.`;
        emotion = "suspicious";
        items = [{ player: t, hint: `[질문] ${me0}가 당신의 지금까지의 발언이 의심된다고 공개적으로 추궁했습니다. 당신의 직업과 전략에 맞게 해명하거나 반박하세요. (밤에 무엇을 했는지 묻는 말이 아닙니다.)` }];
      }
    }
    commit((x) => ({ ...addMsg(x, HUMAN_ID, text, undefined, emotion), actionsUsed: x.actionsUsed + 1 }));
    const msgId = ref.current!.nextMsgId - 1;
    if (a.kind === "claim") setMeaning(msgId, { claim: a.role, summary: `${ROLE_LABEL[a.role]} 주장` });
    if (a.kind === "report")
      setMeaning(msgId, {
        claim: "police",
        reports: [{ target: a.target, result: a.result }],
        summary: `경찰 주장, ${s0.players[a.target].name}을(를) 조사해 "${a.result === "mafia" ? "마피아" : "마피아 아님"}"으로 보고`,
      });
    setBusy(true);
    const ok = await respond(id, items);
    if (!ok) return;
    setSpeaking(null);
    setBusy(false);
  };

  /* ---------------- 투표 ---------------- */
  const startVote = () => {
    const s = ref.current;
    if (!s || busy || s.phase !== "day") return;
    commit((x) => addMsg({ ...x, phase: "vote", votes: {} }, "system", "투표 시간입니다. 가장 의심되는 사람을 선택하세요.", "vote"));
  };

  const goNight = () =>
    commit((x) => addMsg({ ...x, phase: "night", day: x.day + 1, round: 0, whispersUsed: 0, votes: {}, accused: null, trialStage: null, actionsUsed: 0 }, "system", `${x.day + 1}일차 밤이 되었습니다.`, "night"));

  /** 최후의 변론 -> 찬반 투표 -> (처형 시) 유언. 중단되면 false */
  const runTrial = async (id: number, accusedId: number): Promise<boolean> => {
    const engine = ai();
    const nm = nameOf(ref.current!, accusedId);
    commit((x) => addMsg({ ...x, phase: "trial", accused: accusedId, trialStage: "defense" }, "system", `${nm}님이 최다 득표로 지목되었습니다. 최후의 변론을 시작합니다.`, "trial"));
    await waitNext();
    if (!alivePhaseGuard(id)) return false;

    // 최후의 변론
    if (ref.current!.players[accusedId].isHuman) {
      const text = await waitHuman<string | null>();
      if (!alivePhaseGuard(id)) return false;
      if (text && text.trim()) commit((x) => addMsg(x, HUMAN_ID, text.trim(), "trial", "sad"));
      else commit((x) => addMsg(x, "system", "변론 없이 넘어갑니다.", "trial"));
    } else {
      setSpeaking(accusedId);
      const said = await engine.speak(ref.current!, ref.current!.players[accusedId], "[재판] 당신은 최다 득표로 처형 위기에 놓였습니다. 최후의 변론을 하세요. 억울함을 호소하거나 다른 사람을 지목해도 됩니다.");
      if (!alivePhaseGuard(id)) return false;
      setSpeaking(null);
      commit((x) => addMsg(x, accusedId, said.text, "trial", said.emotion));
    }
    await waitNext();
    if (!alivePhaseGuard(id)) return false;

    // 찬반 투표
    commit((x) => addMsg({ ...x, trialStage: "verdict" }, "system", `찬반 투표를 시작합니다. 찬성이 반대보다 많으면 ${nm}님이 처형됩니다.`, "trial"));
    const voters = alive(ref.current!).filter((p) => p.id !== accusedId);
    const humanVotes = voters.some((p) => p.isHuman);
    const humanPromise = humanVotes ? waitHuman<boolean | null>() : Promise.resolve<boolean | null>(null);
    const aiVotes = await Promise.all(
      voters.filter((p) => !p.isHuman).map(async (p) => [p.id, await engine.verdict(ref.current!, p, accusedId)] as const),
    );
    const hv = await humanPromise;
    if (!alivePhaseGuard(id)) return false;
    const votes: Record<number, boolean> = Object.fromEntries(aiVotes);
    if (humanVotes) votes[HUMAN_ID] = hv === true;
    const { yes, no, execute } = tallyVerdict(votes);
    const list = voters.map((p) => `${p.name}: ${votes[p.id] ? "찬성" : "반대"}`).join("\n");
    commit((x) => addMsg(x, "system", `찬반 투표 결과\n${list}\n\n찬성 ${yes} / 반대 ${no}`, "trial"));
    await waitNext();
    if (!alivePhaseGuard(id)) return false;

    if (execute) {
      commit((x) => kill(x, accusedId, true));
      commit((x) => addMsg(x, "system", `${nm}님이 처형되었습니다. 정체는 ${wasPhrase(ROLE_LABEL[x.players[accusedId].role])}.`, "trial"));
      if (!ref.current!.players[accusedId].isHuman) {
        await waitNext();
        if (!alivePhaseGuard(id)) return false;
        setSpeaking(accusedId);
        const dead = ref.current!.players[accusedId];
        const last = await speakLastWords(engine, makeAI({ ...settings, mode: "mock" }, () => {}), ref.current!, dead);
        if (!alivePhaseGuard(id)) return false;
        setSpeaking(null);
        commit((x) => addMsg(x, accusedId, last.text, "trial", last.emotion === "neutral" ? (dead.role === "mafia" ? "smug" : "sad") : last.emotion));
      }
    } else {
      commit((x) => addMsg(x, "system", `반대가 많아 ${nm}님은 처형되지 않았습니다.`, "trial"));
    }
    commit(finishIfWon);
    return true;
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
    const { executed, counts } = tallyVotes(ref.current!, votes);
    const lines = results.map(([voter, t]) => `${nameOf(ref.current!, voter)} → ${t === null ? "기권" : nameOf(ref.current!, t)}`).join("\n");
    const tally = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${nameOf(ref.current!, Number(t))} ${n}표`).join(" / ");
    commit((x) => addMsg(x, "system", `투표 결과\n${lines}${tally ? `\n\n${tally}` : ""}`, "vote"));
    await waitNext();
    if (!alivePhaseGuard(id)) return;

    if (executed === null) {
      commit((x) => addMsg(x, "system", "동점이거나 표가 없어 아무도 지목되지 않았습니다.", "vote"));
      await waitNext();
      if (!alivePhaseGuard(id)) return;
    } else {
      const ok = await runTrial(id, executed);
      if (!ok) return;
      if (ref.current!.phase !== "gameover") {
        await waitNext();
        if (!alivePhaseGuard(id)) return;
      }
    }
    if (ref.current!.phase !== "gameover") goNight();
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
    const wmsg = (from: number, t: string, emotion?: Emotion) => (x: GameState): GameState => ({
      ...x,
      whispers: { ...x.whispers, [targetId]: [...(x.whispers[targetId] ?? []), { id: x.nextMsgId, day: x.day, from, text: t, emotion }] },
      nextMsgId: x.nextMsgId + 1,
    });
    commit(wmsg(HUMAN_ID, text.trim()));
    commit((x) => ({ ...x, whispersUsed: x.whispersUsed + 1 }));
    setTyping(targetId);
    const engine = ai();
    const s = ref.current!;
    const reply = await engine.whisper(s, s.players[targetId], text.trim());
    if (!alivePhaseGuard(id)) return;
    commit(wmsg(targetId, reply.text, reply.emotion));
    setTyping(null);
    setUnread((u) => ({ ...u, [targetId]: true }));
  };

  const clearUnread = (id: number) => setUnread((u) => ({ ...u, [id]: false }));

  const helpers = {
    human: state ? me(state) : null,
    partners: state ? mafiaPartners(state, HUMAN_ID) : [],
  };

  return {
    waiting, advance, awaitingHuman, submitDefense: (t: string | null) => resolveHuman(t), submitVerdict: (v: boolean) => resolveHuman(v), doAction, settings, setSettings, errors, clearErrors: () => setErrors([]), state, busy, speaking, typing, unread, clearUnread,
    startGame, quit, runNight, runRound, sendPublic, startVote, runVote,
    sendWhisper, whisperBlockReason, ...helpers,
  };
}
