import { speakLastWords, type AI } from "./ai";
import { addressesDead, interpretByRules, isRepetitive, ruleViolations, deniesRevealedRole } from "./context";
import { HUMAN_ID } from "./data";
import { nextTurn, openerTurn, proxyHint } from "./director";
import { addMsg, createGame, kill } from "./engine";
import type { GameState, Role } from "./types";

/**
 * 실제 API로 돌려 보는 대화 시나리오 테스트.
 * 그동안 문제가 됐던 상황을 재현하고, 생성된 대사를 자동으로 판정한다.
 */
export interface SelfTestResult {
  title: string;
  lines: string[]; // 생성된 대사 등
  checks: { label: string; ok: boolean }[];
}

// 고정 배치: 0 나, 1 서연, 2 도윤, 3 하은, 4 지후, 5 민재, 6 유나, 7 태오
const ROLES: Role[] = ["citizen", "citizen", "police", "citizen", "mafia", "doctor", "soldier", "mafia"];

function game(nickname: string, humanRole: Role = "citizen"): GameState {
  const s = createGame(nickname);
  const roles = [...ROLES];
  roles[0] = humanRole;
  // 사람이 맡은 직업과 겹치는 AI는 시민으로 바꾼다
  if (humanRole !== "citizen") {
    const dup = roles.findIndex((r, i) => i > 0 && r === humanRole);
    if (dup > 0) roles[dup] = "citizen";
  }
  return { ...s, players: s.players.map((p, i) => ({ ...p, role: roles[i], shield: roles[i] === "soldier" })) };
}

const NO_META = (t: string) => !/(기록|로그|상황판|진행자|시스템|프롬프트)/.test(t);

export async function runSelfTest(ai: AI, fallback: AI, nickname: string, onResult: (r: SelfTestResult) => void): Promise<SelfTestResult[]> {
  const out: SelfTestResult[] = [];
  const push = (r: SelfTestResult) => { out.push(r); onResult(r); };
  const name = (s: GameState, id: number) => s.players[id].name;

  // 1. 첫날 첫 마디와 이어지는 대화
  {
    let s: GameState = { ...game(nickname), phase: "day", lastNightResult: "첫 밤은 조용히 지나갔습니다. 마피아의 습격은 없었습니다." };
    s = addMsg(s, "system", `1일차 낮이 밝았습니다. ${s.lastNightResult}`, "day");
    const lines: string[] = [];
    const op = openerTurn(s)!;
    let said = await ai.speak(s, op.player, op.hint);
    s = addMsg(s, op.player.id, said.text, "day", said.emotion);
    lines.push(`${op.player.name}: ${said.text}`);
    let firstNightTalk = /첫\s*밤|첫날|단서가 없/.test(said.text) ? 1 : 0;
    let violations = ruleViolations(said.text).length;
    for (let i = 0; i < 3; i++) {
      const t = nextTurn(s)!;
      said = await ai.speak(s, t.player, t.hint);
      s = addMsg(s, t.player.id, said.text, "day", said.emotion);
      lines.push(`${t.player.name}: ${said.text}`);
      if (/첫\s*밤|첫날|단서가 없/.test(said.text)) firstNightTalk++;
      violations += ruleViolations(said.text).length;
    }
    push({
      title: "1. 첫날 첫 마디와 이어지는 대화",
      lines,
      checks: [
        { label: "첫 밤 얘기는 한 번 이하", ok: firstNightTalk <= 1 },
        { label: "첫 밤 보호, '기록' 같은 규칙 위반 없음", ok: violations === 0 },
      ],
    });
  }

  // 2. 의사의 보호 보고 (경찰 조사로 오해하지 않기)
  {
    let s: GameState = { ...game(nickname, "doctor"), day: 2, phase: "day" };
    s = addMsg(s, "system", "2일차 낮이 밝았습니다. 밤사이 아무도 죽지 않았습니다.", "day");
    const text = "저 의사예요. 어젯밤 서연 보호했어요. 그래서 서연은 마피아 아닌 거 알아요.";
    s = addMsg(s, HUMAN_ID, text, "day");
    const meaning = (await ai.interpret(s, text)) ?? interpretByRules(text, s.players, HUMAN_ID);
    s = { ...s, log: s.log.map((m, i) => (i === s.log.length - 1 ? { ...m, meaning } : m)) };
    const lines = [`나: ${text}`, `해석: ${meaning.summary ?? "(없음)"}`];
    let asksPolice = false;
    for (const id of [1, 3]) {
      const hint = `[의사보고:1:saved] ${nickname}가 자신이 의사이며 어젯밤 서연님을 보호했다고 말했습니다. 어젯밤 아무도 죽지 않았으므로, 이 말이 사실이고 의사가 막은 것이라면 서연은 마피아의 습격 대상이었고 마피아가 아니다(군인이 버텼을 가능성도 있다). 이것은 경찰 조사가 아니니 "조사를 어떻게 했냐", "경찰이냐"고 묻지 말고 짧게 반응하세요.`;
      const said = await ai.speak(s, s.players[id], hint);
      s = addMsg(s, id, said.text, "day", said.emotion);
      lines.push(`${name(s, id)}: ${said.text}`);
      if (/(조사.*(어떻게|방법|했어|했냐|했나요)|경찰이(야|냐|에요|세요|신가요|라고))/.test(said.text)) asksPolice = true;
    }
    push({
      title: "2. 의사의 보호 보고",
      lines,
      checks: [
        { label: "보호 보고로 해석(서연)", ok: !!meaning.saves?.some((v) => v.target === 1) },
        { label: "경찰 조사 보고로 오해하지 않음", ok: !meaning.reports?.length },
        { label: "'조사를 어떻게 했냐/경찰이냐'고 묻지 않음", ok: !asksPolice },
      ],
    });
  }

  // 3. 경찰의 자유로운 조사 보고 (되묻지 않기)
  {
    let s: GameState = { ...game(nickname, "police"), day: 2, phase: "day" };
    s = addMsg(s, HUMAN_ID, "나 경찰임", "day");
    const text = "서연 조사했는데 마피아야";
    s = addMsg(s, HUMAN_ID, text, "day");
    const meaning = (await ai.interpret(s, text)) ?? interpretByRules(text, s.players, HUMAN_ID, true);
    s = { ...s, log: s.log.map((m, i) => (i === s.log.length - 1 ? { ...m, meaning } : m)) };
    const lines = ["나: 나 경찰임", `나: ${text}`, `해석: ${meaning.summary ?? "(없음)"}`];
    let reAsk = false;
    for (const id of [1, 6]) {
      const hint = `[조사보고:1:mafia] ${nickname}가 자신이 경찰이라며 서연님을 조사한 결과 "마피아"라고 공개 보고했습니다. ${id === 1 ? "당신이 조사 대상입니다." : "당신은 조사 대상이 아닙니다."} 대상과 결과는 이미 나왔으니 다시 묻지 마세요.`;
      const said = await ai.speak(s, s.players[id], hint);
      s = addMsg(s, id, said.text, "day", said.emotion);
      lines.push(`${name(s, id)}: ${said.text}`);
      if (/(누구를 조사|대상이 누구|결과가 뭐|언제 조사|언제 했)/.test(said.text)) reAsk = true;
    }
    push({
      title: "3. 경찰의 자유로운 조사 보고",
      lines,
      checks: [
        { label: "조사 보고로 해석(서연=마피아)", ok: !!meaning.reports?.some((r) => r.target === 1 && r.result === "mafia") },
        { label: "대상·결과·시점을 되묻지 않음", ok: !reAsk },
      ],
    });
  }

  // 4. 죽은 사람에게 말 걸지 않기
  {
    let s: GameState = { ...game(nickname), day: 3, phase: "day" };
    s = kill(s, 1, false);
    s = addMsg(s, "system", "3일차 낮이 밝았습니다. 밤사이 서연님이 마피아에게 살해당했습니다.", "day");
    s = addMsg(s, 2, "서연이 죽었네. 서연이 어제 태오 의심했었지.", "day");
    const said = await ai.speak(s, s.players[3], "[반응:도윤] 직전 발언에 반응하세요.");
    push({
      title: "4. 죽은 사람(서연)에게 말 걸지 않기",
      lines: [`도윤: 서연이 죽었네. 서연이 어제 태오 의심했었지.`, `하은: ${said.text}`],
      checks: [
        { label: "죽은 사람에게 묻거나 대답을 요구하지 않음", ok: addressesDead(s, said.text, 3) === null },
        { label: "'기록' 같은 말 없음", ok: NO_META(said.text) },
      ],
    });
  }

  // 5. 처형된 마피아의 유언
  {
    let s: GameState = { ...game(nickname), day: 2, phase: "trial" };
    s = kill(s, 4, true);
    s = addMsg(s, "system", "지후님이 처형되었습니다. 정체는 마피아였습니다.", "trial");
    const said = await speakLastWords(ai, fallback, s, s.players[4]);
    push({
      title: "5. 처형된 마피아의 유언",
      lines: [`지후(마피아, 처형): ${said.text}`],
      checks: [{ label: "결백·억울함을 주장하지 않음", ok: !deniesRevealedRole(said.text, "mafia") }],
    });
  }

  // 6. 내 대사 자동 (직업을 밝히지 않기)
  {
    let s: GameState = { ...game(nickname, "police"), day: 2, phase: "day", policeLog: { 0: [{ target: 7, isMafia: true, day: 1 }] } };
    s = addMsg(s, 7, `${nickname}님, 아까부터 말이 없네요. 좀 수상한데요?`, "day");
    const said = await ai.speak(s, s.players[HUMAN_ID], proxyHint(s, `[응답] 태오가 방금 당신에게 말했습니다: "${nickname}님, 아까부터 말이 없네요. 좀 수상한데요?" 그 말에 직접, 짧게 답하세요.`));
    const m = interpretByRules(said.text, s.players, HUMAN_ID);
    push({
      title: "6. 내 대사 자동(나는 경찰, 태오가 마피아임을 앎)",
      lines: [`태오: ${nickname}님, 아까부터 말이 없네요. 좀 수상한데요?`, `나(자동): ${said.text}`],
      checks: [{ label: "직업·조사 결과를 밝히지 않음", ok: !m.claim && !m.reports }],
    });
  }

  // 7. 단서 없는 첫날 투표
  {
    const s: GameState = { ...game(nickname), phase: "vote" };
    const lines: string[] = [];
    let abstain = 0;
    for (const p of s.players.filter((x) => !x.isHuman)) {
      const v = await ai.vote(s, p);
      if (v === null) abstain++;
      lines.push(`${p.name}(${p.role === "mafia" ? "마피아" : "시민 팀"}) → ${v === null ? "기권" : name(s, v)}`);
    }
    push({ title: "7. 단서 없는 첫날 투표", lines, checks: [{ label: "근거 없을 때 기권하는 사람이 있음", ok: abstain > 0 }] });
  }

  // 8. 같은 얘기가 맴돌 때
  {
    let s: GameState = { ...game(nickname), day: 3, phase: "day" };
    s = addMsg(s, 7, "하은, 서연이 어제 얘기 피하는 거 이상하지 않아?", "day");
    s = addMsg(s, 3, "태오님, 저는 아직 판단이 조심스러워요.", "day");
    s = addMsg(s, 7, "하은, 그래도 서연 얘기는 그냥 넘기기 어렵잖아.", "day");
    const t = nextTurn(s)!;
    const said = await ai.speak(s, t.player, t.hint);
    push({
      title: "8. 같은 얘기가 맴돌 때 화제 전환",
      lines: ["태오: 하은, 서연이 어제 얘기 피하는 거 이상하지 않아?", "하은: 태오님, 저는 아직 판단이 조심스러워요.", "태오: 하은, 그래도 서연 얘기는 그냥 넘기기 어렵잖아.", `${t.player.name}: ${said.text}`],
      checks: [
        { label: "태오·하은이 아닌 사람이 끼어듦", ok: t.player.id !== 7 && t.player.id !== 3 },
        { label: "방금 나온 말을 되풀이하지 않음", ok: !isRepetitive(s, t.player.id, said.text) },
      ],
    });
  }
  return out;
}
