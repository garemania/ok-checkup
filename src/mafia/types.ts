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
  doctorLog: Record<number, { day: number; target: number; saved: boolean }[]>;
  mafiaLog: { day: number; target: number; result: "killed" | "saved" | "shielded" }[]; // 마피아 습격 기록 (마피아만 아는 정보) // 의사별 보호 기록 (saved: 실제로 습격을 막음)
  votes: Record<number, number | null>;
  accused: number | null; // 재판 대상
  trialStage: TrialStage | null;
  actionsUsed: number; // 오늘 사용한 낮 행동 횟수
  autoUsed: number; // 오늘 플레이어 대신 자동으로 한 말의 수
  watchUsed: number; // 오늘 사용한 "지켜보기" 횟수
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
