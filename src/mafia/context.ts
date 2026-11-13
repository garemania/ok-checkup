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
const CLAIM_RE = /(?:저는|제가|저|난|나는|내가|나)\s*(경찰|의사|군인|마피아|시민)(?:(?:입니다|이에요|예요|이야|이다|임|이라고|라고|이고|야|다|돼|되)|(?![가-힣])(?!\s*(?:아니|아님)))/;
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
export function interpretByRules(text: string, players: Player[], speaker: number, isPoliceClaimer = false): Meaning {
  const norm = normalizeHuman(text, players).text;
  const hit = norm.match(CLAIM_RE);
  const claim = hit ? ROLE_BY_LABEL[hit[1]] : undefined;
  const reports: NonNullable<Meaning["reports"]> = [];
  if (claim === "police" || isPoliceClaimer || REPORT_CUE.test(norm)) {
    const found = players
      .filter((q) => q.id !== speaker)
      .map((q) => ({ q, at: norm.indexOf(q.name) }))
      .filter((x) => x.at >= 0)
      .sort((x, y) => x.at - y.at);
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
  reports.forEach((r) => parts.push(`${players[r.target].name}을(를) 조사해 "${r.result === "mafia" ? "마피아" : "마피아 아님"}"으로 보고`));
  return { claim, reports: reports.length ? reports : undefined, summary: parts.length ? parts.join(", ") : undefined };
}

/** 저장된 해석(LLM 또는 행동)이 있으면 그것을, 없으면 규칙 기반 해석을 쓴다 */
function meaningsInOrder(s: GameState): { m: ChatMsg; meaning: Meaning }[] {
  const policeClaimers = new Set<number>();
  const out: { m: ChatMsg; meaning: Meaning }[] = [];
  for (const m of s.log) {
    if (m.from === "system") continue;
    const meaning = m.meaning ?? interpretByRules(m.text, s.players, m.from, policeClaimers.has(m.from));
    if (meaning.claim === "police") policeClaimers.add(m.from);
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
  lines.push("규칙 확인: 첫 밤에도 경찰 조사는 가능하다(첫 밤에 없는 것은 마피아의 살해뿐). 밤에 살해된 사람의 직업은 공개되지 않는다.");

  if (reports.length)
    lines.push(
      `조사 보고(대상과 결과가 이미 공개됨, 다시 묻지 말 것. 직업 주장은 증명이 아님): ${reports
        .map((r) => `${s.players[r.by].name}이(가) ${s.players[r.target].name}을(를) 조사했다며 "${r.result === "mafia" ? "마피아" : "마피아 아님(시민 쪽)"}"으로 보고(${r.day}일차 발언)`)
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
  if (ded.length) lines.push(`[공개 정보로 확실히 말할 수 있는 것]\n- ${ded.join("\n- ")}`);
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
