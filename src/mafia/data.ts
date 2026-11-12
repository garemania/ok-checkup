import type { Look, Role } from "./types";

export const HUMAN_ID = 0;
export const MAX_ROUNDS = 3; // 하루 토론 라운드 상한
export const MAX_WHISPERS_PER_DAY = 8; // 하루 1:1 대화 가능 횟수

export const ROLE_POOL: Role[] = [
  "mafia", "mafia", "police", "doctor", "citizen", "citizen", "citizen", "citizen",
];

export interface Character {
  name: string;
  emoji: string;
  color: number;
  persona: string;
  speech: string;
  look: Look;
}

export const HUMAN_CHAR: Character = {
  name: "나", emoji: "🙂", color: 45, persona: "플레이어", speech: "",
  look: { hair: "short", hairColor: "#2a211b", ears: null, accessory: "headband" },
};

export const AI_CHARS: Character[] = [
  { name: "서연", emoji: "🦊", color: 25,
    persona: "논리적인 분석가. 발언 순서·투표 기록 같은 근거를 따지는 것을 좋아한다.",
    speech: "정중한 존댓말, 차분하고 또박또박",
    look: { hair: "long", hairColor: "#6b3a1f", ears: "fox", accessory: "glasses" } },
  { name: "도윤", emoji: "🐻", color: 30,
    persona: "호탕하고 직설적. 감과 첫인상으로 판단하며 돌려 말하지 않는다.",
    speech: "털털한 반말 섞인 말투",
    look: { hair: "messy", hairColor: "#4a3224", ears: "bear", accessory: "stubble", browWidth: 3 } },
  { name: "하은", emoji: "🐰", color: 330,
    persona: "소심하고 눈치를 많이 본다. 확신이 없으면 말끝을 흐리지만 관찰력은 좋다.",
    speech: "조심스러운 존댓말, 말줄임표 자주 사용",
    look: { hair: "bob", hairColor: "#8a4660", ears: "rabbit", accessory: "none" } },
  { name: "지후", emoji: "😎", color: 200,
    persona: "장난기 많은 분위기 메이커. 농담으로 분위기를 풀지만 가끔 날카로운 말을 던진다.",
    speech: "가벼운 반말, 농담 섞음",
    look: { hair: "spiky", hairColor: "#1f2a44", ears: null, accessory: "shades" } },
  { name: "민재", emoji: "🦉", color: 260,
    persona: "말수가 적은 관찰자. 꼭 필요한 말만 하고 남들의 모순을 짚는다.",
    speech: "짧고 건조한 말투",
    look: { hair: "short", hairColor: "#4c4468", ears: "owl", accessory: "none", browWidth: 3.4, heavyBags: true } },
  { name: "유나", emoji: "🐱", color: 160,
    persona: "감정적이고 의리파. 친해진 사람을 잘 믿고, 배신당하면 크게 화낸다.",
    speech: "감정이 풍부한 다정한 말투, 느낌표 가끔 사용",
    look: { hair: "bun", hairColor: "#1f5a4c", ears: "cat", accessory: "whiskers" } },
  { name: "태오", emoji: "🐺", color: 0,
    persona: "공격적인 리더형. 토론을 주도하고 의심 가는 사람을 몰아붙인다.",
    speech: "짧고 단정적인 평어체 반말. '~다', '~해', '~잖아'로 끝낸다. 존댓말, 과장된 영웅·군인 말투, 설교조 금지. 말 예시: '난 지후가 수상하다고 본다.' '근거 없이 넘어가지 마.' '내 표는 서연이다. 반박할 사람?'",
    look: { hair: "wild", hairColor: "#2b2b2f", ears: "wolf", accessory: "scar", browWidth: 3 } }
];
