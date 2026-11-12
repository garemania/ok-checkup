export type Role = "mafia" | "police" | "doctor" | "citizen";
export type Phase = "intro" | "night" | "day" | "vote" | "gameover";

export interface Player {
  id: number;
  name: string;
  emoji: string;
  color: number; // hsl hue
  persona: string;
  speech: string; // 말투 힌트
  role: Role;
  alive: boolean;
  isHuman: boolean;
  revealed: boolean; // 처형 등으로 직업 공개됨
}

export interface ChatMsg {
  id: number;
  day: number;
  phase: Phase;
  from: number | "system";
  text: string;
}

export interface WhisperMsg {
  id: number;
  day: number;
  from: number; // 발신자 id
  text: string;
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
  votes: Record<number, number | null>;
  lastNightResult: string;
  winner?: "mafia" | "citizen";
  nextMsgId: number;
}

export interface Settings {
  mode: "mock" | "api";
  apiKey: string;
  baseUrl: string;
  model: string;
  nickname: string;
}

export const ROLE_LABEL: Record<Role, string> = {
  mafia: "마피아",
  police: "경찰",
  doctor: "의사",
  citizen: "시민",
};

export const ROLE_EMOJI: Record<Role, string> = {
  mafia: "🔪",
  police: "🕵️",
  doctor: "💉",
  citizen: "🧑",
};

export const ROLE_DESC: Record<Role, string> = {
  mafia: "밤마다 동료와 함께 한 명을 제거합니다. 정체를 숨기고 시민을 속이세요.",
  police: "밤마다 한 명을 조사해 마피아인지 알아낼 수 있습니다.",
  doctor: "밤마다 한 명을 지목해 마피아의 공격으로부터 보호합니다.",
  citizen: "특별한 능력은 없지만 토론과 투표로 마피아를 찾아내야 합니다.",
};
