export type Emotion = "neutral" | "happy" | "angry" | "sad" | "surprised" | "suspicious" | "scared" | "smug";

export interface Look {
  hair: "short" | "long" | "bob" | "spiky" | "messy" | "bun" | "wild";
  hairColor: string;
  ears: "fox" | "bear" | "rabbit" | "cat" | "wolf" | "owl" | null;
  accessory: "none" | "shades" | "glasses" | "scar" | "headband" | "stubble" | "whiskers";
  browWidth?: number; // 눈썹 굵기
  heavyBags?: boolean; // 짙은 다크서클
}

export type Role = "mafia" | "police" | "doctor" | "soldier" | "citizen";
export type Phase = "intro" | "night" | "day" | "vote" | "trial" | "gameover";
export type TrialStage = "defense" | "verdict";

export interface Player {
  id: number;
  name: string;
  emoji: string;
  color: number; // hsl hue
  persona: string;
  speech: string; // 말투 힌트
  look: Look;
  role: Role;
  alive: boolean;
  isHuman: boolean;
  revealed: boolean; // 처형 등으로 직업 공개됨
  shield: boolean; // 군인의 방어 능력 남음
  death?: { day: number; cause: "executed" | "killed" }; // 사망 시점과 경위
}

export interface ChatMsg {
  id: number;
  day: number;
  phase: Phase;
  from: number | "system";
  text: string;
  emotion?: Emotion;
  meaning?: Meaning; // 발언의 구조적 해석 (직업 주장, 조사 보고)
  auto?: boolean; // 플레이어 대신 자동으로 한 말
  replyTo?: number; // 이 말이 답하고 있는 메시지 id (화면에 원래 질문을 인용)
}

export interface Meaning {
  claim?: Role;
  reports?: { target: number; result: "clean" | "mafia" }[];
  saves?: { target: number }[]; // 의사의 보호 보고 ("○○를 지켰다/살렸다")
  summary?: string;
}

export interface WhisperMsg {
  id: number;
  day: number;
  from: number; // 발신자 id
  text: string;
  emotion?: Emotion;
}

export interface Investigation {
  target: number;
  isMafia: boolean;
  day: number;
}

export interface GameState {
  phase: Phase;
  day: number;
  round: number; // 오늘 진행된 토론 라운드
  players: Player[];
  log: ChatMsg[];
  whispers: Record<number, WhisperMsg[]>; // key: AI id (나와의 1:1)
  whispersUsed: number;
  investigations: Investigation[]; // 경찰(누구든) 조사 기록: actor 별로 분리
  policeLog: Record<number, Investigation[]>;
  doctorLog: Record<number, { day: number; target: number; quiet: boolean }[]>; // 의사별 보호 기록 (quiet: 그 밤 아무도 죽지 않음. 의사가 막았는지 군인이 버텼는지는 의사도 모른다)
  mafiaLog: { day: number; target: number; result: "killed" | "failed" }[]; // 마피아 습격 기록 (실패 이유는 마피아도 모른다) // 의사별 보호 기록 (saved: 실제로 습격을 막음)
  votes: Record<number, number | null>;
  accused: number | null; // 재판 대상
  trialStage: TrialStage | null;
  actionsUsed: number; // 오늘 사용한 낮 행동 횟수
  autoUsed: number; // 오늘 플레이어 대신 자동으로 한 말의 수
  lastNightResult: string;
  winner?: "mafia" | "citizen";
  nextMsgId: number;
}

export interface Settings {
  mode: "mock" | "api";
  provider: "anthropic" | "gemini";
  geminiKey: string;
  geminiModel: string;
  apiKey: string; // Anthropic
  baseUrl: string;
  model: string;
  nickname: string;
  autoSpeak: boolean; // 대화 중 내 캐릭터도 하루 몇 번 자동으로 말하기
  autoAdvance: boolean; // 대사를 자동으로 넘기기 (끄면 "다음"을 눌러야 넘어감)
}

export const ROLE_LABEL: Record<Role, string> = {
  mafia: "마피아",
  police: "경찰",
  doctor: "의사",
  soldier: "군인",
  citizen: "시민",
};


export const ROLE_DESC: Record<Role, string> = {
  mafia: "밤마다 동료와 함께 한 명을 제거합니다. 정체를 숨기고 시민을 속이세요.",
  police: "밤마다 한 명을 조사해 마피아인지 알아낼 수 있습니다.",
  doctor: "밤마다 한 명을 지목해 마피아의 공격으로부터 보호합니다.",
  soldier: "마피아의 습격을 한 번 버텨냅니다. 능력은 자동으로 발동합니다.",
  citizen: "특별한 능력은 없지만 토론과 투표로 마피아를 찾아내야 합니다.",
};

/** 직업 추정 메모의 순서 (누를 때마다 다음으로) */
export const GUESS_ORDER: (Role | null)[] = [null, "mafia", "police", "doctor", "soldier", "citizen"];

/** 직업별 색 (추정 칩) */
export const ROLE_TONE: Record<Role, string> = {
  mafia: "border-red-500/70 bg-red-500/20 text-red-300",
  police: "border-sky-500/70 bg-sky-500/20 text-sky-300",
  doctor: "border-emerald-500/70 bg-emerald-500/20 text-emerald-300",
  soldier: "border-amber-500/70 bg-amber-500/20 text-amber-300",
  citizen: "border-zinc-400/60 bg-zinc-500/20 text-zinc-200",
};
