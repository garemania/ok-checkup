import { HUMAN_ID } from "./data";
import { ROLE_LABEL } from "./types";
import type { ChatMsg, GameState, Meaning, Player, Role } from "./types";

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
const COMMON_WORDS = new Set(["도사", "선생", "사장", "대장", "엄마", "아빠", "형님", "누나", "언니", "오빠", "하느", "하나", "하늘", "서로", "지금", "민간", "유저", "태도", "도움", "오늘", "내일", "어제", "시간", "이유"]);

const FIRST_PERSON = "(?:저는|제가|저|난|나는|내가|나)";
const CLAIM_END = "(?:입니다|이에요|예요|이야|이다|임|이라고|라고|이고|인데|이니까|이라서|라서|야|다|돼|되)";

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
    const re = new RegExp(`(?<![가-힣])${typo}`, "g");
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

  // 3) 이름 자리의 한 글자 오타. 평소에는 부르는 말(님/아/야) 앞에서만,
  //    조사·직업 이야기 중이면 조사나 띄어쓰기 앞에서도 보정한다 ("서현 마피아야" -> "서연 마피아야")
  const names = players.map((p) => p.name);
  const loose = /(조사|결과|경찰|의사|군인|마피아|시민|확인)/.test(out);
  const nameSlot = loose ? /(?<![가-힣])([가-힣]{2})(?=님|아|야|은|는|이|가|을|를|\s|=|,|$)/g : /(?<![가-힣])([가-힣]{2})(?=님|아|야)/g;
  out = out.replace(nameSlot, (m, word: string) => {
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
  const meanings = new Map<number, string>();
  for (const { m, meaning } of meaningsInOrder(s)) if (meaning.summary) meanings.set(m.id, meaning.summary);
  return s.log
    .slice(-limit)
    .map((m) => {
      const who =
        m.from === "system" ? "[진행]"
        : m.from === viewer.id ? `${viewer.name}(당신)`
        : m.from === HUMAN_ID ? `플레이어(${s.players[HUMAN_ID].name})${s.players[HUMAN_ID].alive ? "" : "(현재 사망)"}`
        : `${s.players[m.from].name}${s.players[m.from].alive ? "" : "(현재 사망)"}`;
      let body = m.from === "system" ? m.text.replace(/\n+/g, " / ") : m.text;
      if (m.from === HUMAN_ID) {
        const n = normalizeHuman(m.text, s.players);
        if (n.fixes.length) body = `${n.text} (오타 보정: ${n.fixes.join(", ")} / 원문: ${m.text})`;
        const sum = meanings.get(m.id);
        if (sum) body += ` [해석: ${sum}]`;
      }
      return `(${m.day}일차 ${PHASE_LABEL[m.phase] ?? ""}) ${who}: ${body}`;
    })
    .join("\n");
}

// 1인칭 직업 주장. 어미가 없어도 되지만 "시민을 믿어"(조사)나 "시민 아니야"(부정)는 제외
const CLAIM_RE = /(?:저는|제가|저|난|나는|내가|나)\s*(경찰|의사|군인|마피아|시민)(?:(?:입니다|이에요|예요|이야|이다|임|이라고|라고|이고|인데|이니까|이라서|라서|야|다|돼|되)|(?![가-힣])(?!\s*(?:아니|아님)))/;
const ROLE_BY_LABEL: Record<string, Role> = { 경찰: "police", 의사: "doctor", 군인: "soldier", 마피아: "mafia", 시민: "citizen" };

// 조사 보고임을 알려주는 단서
const REPORT_CUE = /(조사|결과|경찰|확인해|확인했|확인함|알아냈|알아봤|봤더니|보니|해보니|했더니|검거)/;
const CLEAN_RE = /마피아\s*(?:가|는|은)?\s*(?:아니|아님|아냐|아닙|아닌)|결백|무고|시민(?!\s*연기)/;

function verdictOf(window: string): "clean" | "mafia" | null {
  if (CLEAN_RE.test(window)) return "clean";
  if (/마피아/.test(window)) return "mafia";
  return null;
}

/**
 * 규칙 기반 발언 해석: 1인칭 직업 주장과 조사 보고를 찾는다.
 * "서연 조사했는데 마피아임", "조사해보니 서연 마피아", "서연=시민"처럼 자유로운 표현도 인식한다.
 * isPoliceClaimer: 이 화자가 이전에 이미 경찰을 주장했는지
 */
const SAVE_CUE = /(보호|살렸|살려|지켰|지켜|치료)/;

export function interpretByRules(text: string, players: Player[], speaker: number, isPoliceClaimer = false, isDoctorClaimer = false): Meaning {
  const norm = normalizeHuman(text, players).text;
  const hit = norm.match(CLAIM_RE);
  const claim = hit ? ROLE_BY_LABEL[hit[1]] : undefined;
  const found = players
    .filter((q) => q.id !== speaker)
    .map((q) => ({ q, at: norm.indexOf(q.name) }))
    .filter((x) => x.at >= 0)
    .sort((x, y) => x.at - y.at);

  // 의사의 보호 보고: "○○ 보호했어", "○○ 살렸다" -> 경찰 조사로 보지 않는다
  const saves: NonNullable<Meaning["saves"]> = [];
  const doctorTalk = claim === "doctor" || isDoctorClaimer || (SAVE_CUE.test(norm) && /의사/.test(norm));
  if (SAVE_CUE.test(norm) && (doctorTalk || claim !== "police")) {
    found.forEach(({ q, at }, i) => {
      const end = i + 1 < found.length ? found[i + 1].at : norm.length;
      const around = norm.slice(Math.max(0, at - 6), Math.min(end, at + q.name.length + 14));
      if (SAVE_CUE.test(around)) saves.push({ target: q.id });
    });
  }

  const reports: NonNullable<Meaning["reports"]> = [];
  const policeTalk = claim === "police" || (isPoliceClaimer && !doctorTalk) || (REPORT_CUE.test(norm) && !saves.length && !doctorTalk);
  if (policeTalk) {
    found.forEach(({ q, at }, i) => {
      const end = i + 1 < found.length ? found[i + 1].at : norm.length;
      const after = norm.slice(at + q.name.length, Math.min(end, at + q.name.length + 18));
      let v = verdictOf(after);
      if (!v) {
        const before = norm.slice(Math.max(0, at - 8), at);
        if (/마피아\s*(?:는|은|가)?\s*$/.test(before)) v = "mafia";
      }
      if (v) reports.push({ target: q.id, result: v });
    });
  }
  const parts: string[] = [];
  if (claim) parts.push(`${ROLE_LABEL[claim]} 주장`);
  saves.forEach((r) => parts.push(`의사로서 ${players[r.target].name}을(를) 보호했다고 말함(경찰 조사가 아님)`));
  reports.forEach((r) => parts.push(`${players[r.target].name}을(를) 조사해 "${r.result === "mafia" ? "마피아" : "마피아 아님"}"으로 보고`));
  return {
    claim,
    reports: reports.length ? reports : undefined,
    saves: saves.length ? saves : undefined,
    summary: parts.length ? parts.join(", ") : undefined,
  };
}

/** 저장된 해석(LLM 또는 행동)이 있으면 그것을, 없으면 규칙 기반 해석을 쓴다 */
function meaningsInOrder(s: GameState): { m: ChatMsg; meaning: Meaning }[] {
  const policeClaimers = new Set<number>();
  const doctorClaimers = new Set<number>();
  const out: { m: ChatMsg; meaning: Meaning }[] = [];
  for (const m of s.log) {
    if (m.from === "system") continue;
    const meaning = m.meaning ?? interpretByRules(m.text, s.players, m.from, policeClaimers.has(m.from), doctorClaimers.has(m.from));
    if (meaning.claim === "police") policeClaimers.add(m.from);
    if (meaning.claim === "doctor") doctorClaimers.add(m.from);
    out.push({ m, meaning });
  }
  return out;
}

/** 대화에서 스스로 직업을 밝힌 기록(마지막 주장 기준) */
export function detectClaims(s: GameState): Record<number, Role> {
  const out: Record<number, Role> = {};
  for (const { m, meaning } of meaningsInOrder(s)) if (meaning.claim) out[m.from as number] = meaning.claim;
  return out;
}

export interface Report { by: number; target: number; result: "clean" | "mafia"; day?: number }

/** 조사 보고 목록 (같은 사람이 같은 대상을 다시 보고하면 마지막 것만) */
export function detectReports(s: GameState): Report[] {
  const map = new Map<string, Report>();
  for (const { m, meaning } of meaningsInOrder(s)) {
    for (const r of meaning.reports ?? []) {
      if (r.target === m.from) continue;
      map.set(`${m.from}:${r.target}`, { by: m.from as number, target: r.target, result: r.result, day: m.day });
    }
  }
  return [...map.values()];
}

export interface SaveClaim { by: number; target: number; day: number }

/** 의사 보호 보고 목록 (발언한 날 기준) */
export function detectSaves(s: GameState): SaveClaim[] {
  const out: SaveClaim[] = [];
  for (const { m, meaning } of meaningsInOrder(s)) for (const r of meaning.saves ?? []) out.push({ by: m.from as number, target: r.target, day: m.day });
  return out;
}

/** N일차 아침에 "의사가 누군가를 구해냈다"는 안내가 있었는지 (= N일차 밤에 의사가 습격을 막음) */
export function savedOnNight(s: GameState, day: number): boolean {
  return s.log.some((m) => m.from === "system" && m.day === day && /구해냈/.test(m.text));
}

/** 발언 하나의 해석 요약 (AI에게 보여주는 기록용) */
export function meaningSummary(s: GameState, m: ChatMsg): string | undefined {
  return meaningsInOrder(s).find((x) => x.m.id === m.id)?.meaning.summary;
}

const deathText = (p: Player) =>
  p.death
    ? `${p.death.day}일차 ${p.death.cause === "executed" ? `처형, 직업 공개: ${ROLE_LABEL[p.role]}` : "밤에 마피아에게 살해, 직업 비공개"}`
    : "사망";

/**
 * 진행자가 정리해 주는 상황판 (모든 AI에게 같은 공개 정보).
 * 생존/사망, 직업 주장, 조사 보고, 사건, 투표 기록, 그리고 공개 정보만으로 할 수 있는 추론.
 */
export function factsBlock(s: GameState): string {
  const lines: string[] = [];
  const living = s.players.filter((p) => p.alive);
  const dead = s.players.filter((p) => !p.alive);
  const claims = detectClaims(s);
  const reports = detectReports(s);

  lines.push(`생존자(${living.length}명, 이 사람들만 말하고 투표할 수 있음): ${living.map((p) => p.name + (claims[p.id] ? `(${ROLE_LABEL[claims[p.id]]} 주장)` : "")).join(", ")}`);
  lines.push(`사망자(${dead.length}명, 이미 죽어서 말도 대답도 투표도 못 함. 말을 걸지 말 것): ${dead.map((p) => `${p.name}(${deathText(p)})`).join(", ") || "없음"}`);
  lines.push("규칙 확인: 첫 밤에 하는 일은 경찰 조사뿐이다(마피아 살해 없음, 의사 보호 없음). 의사 보호는 둘째 밤부터. 밤에 살해된 사람의 직업은 공개되지 않는다.");

  if (reports.length)
    lines.push(
      `조사 보고(대상과 결과가 이미 공개됨, 다시 묻지 말 것. 직업 주장은 증명이 아님): ${reports
        .map((r) => `${s.players[r.by].name}이(가) ${s.players[r.target].name}을(를) 조사했다며 "${r.result === "mafia" ? "마피아" : "마피아 아님(시민 쪽)"}"으로 보고(${r.day}일차 발언)`)
        .join(" / ")}`,
    );

  const saves = detectSaves(s);
  if (saves.length)
    lines.push(
      `의사 보호 보고(경찰 조사가 아님, 조사 방법을 묻지 말 것): ${saves
        .map((v) => `${s.players[v.by].name}이(가) 의사로서 ${s.players[v.target].name}을(를) 보호했다고 말함(${v.day}일차 발언)`)
        .join(" / ")}`,
    );

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

  const ded = deductions(s);
  if (ded.length) lines.push(`[공개된 사실만으로 확실한 것]\n- ${ded.join("\n- ")}`);
  return lines.join("\n");
}

/** 공개 정보만으로 끌어낼 수 있는 확실한 추론 (모든 AI 공통) */
export function deductions(s: GameState): string[] {
  const out: string[] = [];
  const claims = detectClaims(s);
  const reports = detectReports(s);
  const police = Object.entries(claims).filter(([, r]) => r === "police").map(([id]) => Number(id));
  const alivePolice = police.filter((id) => s.players[id].alive);

  if (alivePolice.length >= 2) out.push(`경찰을 주장하는 생존자가 ${alivePolice.map((id) => s.players[id].name).join(", ")} 둘 이상이다. 진짜 경찰은 1명이므로 적어도 한 명은 가짜다.`);
  if (alivePolice.length === 1 && police.length === 1) out.push(`경찰을 주장한 사람은 ${s.players[alivePolice[0]].name} 한 명뿐이고 아직 맞서는 경찰 주장이 없다. 반박이 없고 보고가 공개된 사실과 어긋나지 않으면 믿을 근거가 된다.`);

  // 처형으로 공개된 직업과 어긋나는 보고/주장 -> 거짓말 확정
  for (const r of reports) {
    const t = s.players[r.target];
    if (!t.revealed) continue;
    const truth = t.role === "mafia" ? "mafia" : "clean";
    if (truth !== r.result) out.push(`${s.players[r.by].name}은(는) ${t.name}을(를) "${r.result === "mafia" ? "마피아" : "마피아 아님"}"이라 보고했지만, 처형으로 ${t.name}의 직업이 ${ROLE_LABEL[t.role]}로 공개되었다. ${s.players[r.by].name}의 경찰 주장은 거짓이다.`);
    else out.push(`${s.players[r.by].name}의 ${t.name} 조사 보고는 처형으로 공개된 직업과 일치한다. ${s.players[r.by].name}의 경찰 주장에 힘이 실린다.`);
  }
  for (const [idStr, role] of Object.entries(claims)) {
    const p = s.players[Number(idStr)];
    if (p.revealed && p.role !== role) out.push(`${p.name}은(는) ${ROLE_LABEL[role]}라고 주장했지만 처형으로 ${ROLE_LABEL[p.role]}로 공개되었다. 거짓 주장이었다.`);
  }
  // 같은 직업을 처형으로 공개된 사람이 이미 가졌다면 그 직업을 주장한 다른 사람은 가짜 (마피아 제외, 경찰/의사/군인은 1명)
  for (const p of s.players.filter((x) => x.revealed && ["police", "doctor", "soldier"].includes(x.role))) {
    for (const [idStr, role] of Object.entries(claims)) {
      const c = Number(idStr);
      if (c !== p.id && role === p.role) out.push(`진짜 ${ROLE_LABEL[p.role]}였던 ${p.name}이(가) 처형으로 공개되었으므로, 같은 직업을 주장한 ${s.players[c].name}은(는) 가짜다.`);
    }
  }
  const doctors = Object.entries(claims).filter(([, r]) => r === "doctor").map(([id]) => Number(id)).filter((id) => s.players[id].alive);
  if (doctors.length >= 2) out.push(`의사를 주장하는 생존자가 ${doctors.map((id) => s.players[id].name).join(", ")} 둘 이상이다. 진짜 의사는 1명이므로 적어도 한 명은 가짜다.`);
  for (const v of detectSaves(s)) {
    const by = s.players[v.by].name;
    const t = s.players[v.target].name;
    if (savedOnNight(s, v.day))
      out.push(`${by}은(는) ${t}을(를) 보호했다고 했고, ${v.day}일차 아침에 실제로 "의사가 누군가를 구해냈다"는 안내가 있었다. ${by}의 의사 주장이 사실이라면 ${t}은(는) 마피아의 습격 대상이었으므로 마피아가 아니다(마피아는 자기편을 습격하지 않는다). 이것은 의사의 추론이지 경찰의 조사가 아니다.`);
    else
      out.push(`${by}은(는) ${t}을(를) 보호했다고 했지만, ${v.day}일차 아침에 습격을 막았다는 안내는 없었다. 보호했다는 사실만으로는 ${t}이(가) 마피아가 아니라는 근거가 되지 않는다.`);
  }
  // 마피아 공개 수
  const mafiaDead = s.players.filter((p) => p.revealed && p.role === "mafia").length;
  out.push(`처형으로 확인된 마피아: ${mafiaDead}명. 남은 마피아: ${2 - mafiaDead}명.`);
  return out;
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
  return new RegExp(`(?<!(?:저|나)\\s)(?<![가-힣])${esc}(?![가-힣]{2})`).test(text);
}

/** 죽은 사람에게 말을 거는 문장이면 그 사람의 id */
export function addressesDead(s: GameState, text: string, speaker: number): number | null {
  const head = normalizeHuman(text, s.players).text;
  for (const q of s.players) {
    if (q.alive || q.id === speaker) continue;
    const esc = q.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`${esc}\\s*(님|씨|아|야)?\\s*[,，]`).test(head)) return q.id;
    if (new RegExp(`${esc}\\s*(님|씨)?[^.!?]{0,30}(말씀해|말해|알려|대답|해명해|설명해|주세요|해 봐|해봐|해 줘|해줘)`).test(head)) return q.id;
  }
  return null;
}

/** 처형으로 공개된 직업을 부정하는 말인지 (예: 마피아로 공개됐는데 "억울하다, 난 시민이다") */
export function deniesRevealedRole(text: string, role: Role): boolean {
  if (role === "mafia") return /(억울|마피아가?\s*아니|마피아\s*아님|결백|무고|(?:저는|난|나는|전)\s*시민|시민(?:이에요|이야|이다|입니다)|오해)/.test(text);
  return /((?:제가|내가|저는|난|나는)\s*마피아(?:였|이었|야|예요|입니다|다)|들켰)/.test(text);
}

/** 규칙에 어긋나는 말 (첫 밤의 의사 보호, 첫 밤의 조사 불가 등). 문제가 있으면 설명을 돌려준다 */
export function ruleViolations(text: string): string[] {
  const out: string[] = [];
  const firstNight = /(첫\s*밤|첫날\s*밤|첫\s*날\s*밤|1일차\s*밤|첫\s*밤에)/;
  if (firstNight.test(text) && /(보호|살렸|살려|치료|지켰)/.test(text) && !/(보호(?:가|는|도)?\s*(?:없|안\s*하|하지\s*않))/.test(text))
    out.push("첫 밤에는 의사의 보호 행동 자체가 없습니다. 첫 밤의 보호를 언급하지 마세요.");
  if (firstNight.test(text) && /조사/.test(text) && /(불가|못\s*해|못\s*하|할\s*수\s*없|안\s*돼|안\s*되)/.test(text))
    out.push("첫 밤에도 경찰 조사는 가능합니다. 조사가 불가능하다고 말하지 마세요.");
  if (/(기록|로그|상황판|핵심\s*사실|진행자|시스템|프롬프트)/.test(text))
    out.push('"기록", "상황판" 같은 게임 밖의 말을 쓰지 마세요. 게임 속 사람처럼 "어제 투표에서", "아까 ○○가 한 말"처럼 말하세요.');
  return out;
}

const bigrams = (t: string) => {
  const c = t.replace(/[^가-힣a-zA-Z0-9]/g, "");
  const set = new Set<string>();
  for (let i = 0; i < c.length - 1; i++) set.add(c.slice(i, i + 2));
  return set;
};

/** 두 문장이 얼마나 비슷한지 (글자 두 개 묶음 기준, 0~1) */
export function similarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((x) => { if (B.has(x)) inter++; });
  return inter / (A.size + B.size - inter);
}

/** 방금 나온 말(최근 4줄)이나 자기가 최근에 한 말(3줄)과 거의 같은지 */
export function isRepetitive(s: GameState, speaker: number, text: string): boolean {
  const talk = s.log.filter((m) => m.from !== "system");
  const mine = talk.filter((m) => m.from === speaker).slice(-3).map((m) => m.text);
  const recent = talk.slice(-4).map((m) => m.text);
  return [...mine, ...recent].some((t) => similarity(t, text) >= 0.45);
}

/**
 * 직업별 추리 메모: 이 AI가 자기 직업으로 알 수 있는 확실한 사실과 그로부터의 추론.
 * (공개되지 않은 정보이므로 그대로 말할지는 각자 전략적으로 판단)
 */
export function reasoningNotes(s: GameState, p: Player): string[] {
  const notes: string[] = [];
  const claims = detectClaims(s);
  const name = (id: number) => s.players[id].name;
  const others = (role: Role) => Object.entries(claims).filter(([id, r]) => r === role && Number(id) !== p.id).map(([id]) => Number(id));

  if (p.role === "police") {
    for (const r of s.policeLog[p.id] ?? []) notes.push(`내가 ${r.day}일차 밤에 조사한 ${name(r.target)}은(는) ${r.isMafia ? "마피아다(확실)" : "마피아가 아니다(확실)"}.`);
    others("police").forEach((id) => notes.push(`${name(id)}은(는) 경찰을 주장하지만 진짜 경찰은 나다. ${name(id)}은(는) 가짜이며 마피아일 가능성이 높다.`));
    for (const r of detectReports(s)) {
      if (r.by === p.id) continue;
      const mine = (s.policeLog[p.id] ?? []).find((x) => x.target === r.target);
      if (mine && (mine.isMafia ? "mafia" : "clean") !== r.result) notes.push(`${name(r.by)}의 ${name(r.target)} 보고는 내 조사 결과와 다르다. ${name(r.by)}은(는) 거짓말을 하고 있다.`);
    }
  }
  if (p.role === "doctor") {
    for (const r of s.doctorLog[p.id] ?? [])
      notes.push(r.saved ? `내가 ${r.day}일차 밤에 보호한 ${name(r.target)}이(가) 실제로 습격을 받았고 내가 살렸다. ${name(r.target)}은(는) 마피아의 표적이었으니 마피아가 아니다(확실).` : `내가 ${r.day}일차 밤에 ${name(r.target)}을(를) 보호했다(그날 그 사람은 습격받지 않았다).`);
    others("doctor").forEach((id) => notes.push(`${name(id)}은(는) 의사를 주장하지만 진짜 의사는 나다. ${name(id)}은(는) 가짜다.`));
  }
  if (p.role === "soldier") {
    if (!p.shield && p.alive) notes.push("나는 마피아의 습격을 한 번 받고 버텼다. 마피아가 나를 노렸다는 뜻이다.");
    others("soldier").forEach((id) => notes.push(`${name(id)}은(는) 군인을 주장하지만 진짜 군인은 나다. ${name(id)}은(는) 가짜다.`));
  }
  if (p.role === "mafia") {
    const partners = s.players.filter((x) => x.role === "mafia" && x.id !== p.id).map((x) => x.name);
    if (partners.length) notes.push(`동료 마피아: ${partners.join(", ")}. 동료를 대놓고 감싸면 들킨다.`);
    for (const k of s.mafiaLog)
      notes.push(`${k.day}일차 밤 우리가 노린 ${name(k.target)}: ${k.result === "killed" ? "살해 성공" : k.result === "saved" ? "의사가 막음(그 밤 의사가 그를 보호했다)" : "버텨냄(군인일 가능성이 높다)"}.`);
    (["police", "doctor"] as Role[]).forEach((r) => others(r).filter((id) => s.players[id].alive).forEach((id) => notes.push(`${name(id)}은(는) ${ROLE_LABEL[r]}을(를) 주장했다. 진짜라면 위협이 되니 밤의 표적 후보다.`)));
  }
  // 나에 대한 보고는 내 실제 직업으로 진위를 안다
  const truth = p.role === "mafia" ? "mafia" : "clean";
  for (const r of detectReports(s)) {
    if (r.target !== p.id || r.by === p.id) continue;
    if (r.result !== truth) notes.push(`${name(r.by)}이(가) 나를 "${r.result === "mafia" ? "마피아" : "마피아 아님"}"이라 보고했지만 사실과 다르다. ${name(r.by)}은(는) 진짜 경찰이 아니다.`);
    else if (p.role !== "mafia") notes.push(`${name(r.by)}이(가) 나를 마피아가 아니라고 보고했고 사실이다. ${name(r.by)}은(는) 진짜 경찰일 가능성이 높다.`);
  }
  return notes;
}
