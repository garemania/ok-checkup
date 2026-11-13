import type { Emotion } from "./types";

export const EMOTIONS: Emotion[] = ["neutral", "happy", "angry", "sad", "surprised", "suspicious", "scared", "smug"];

export const EMOTION_LABEL: Record<Emotion, string> = {
  neutral: "평온", happy: "웃음", angry: "분노", sad: "슬픔",
  surprised: "놀람", suspicious: "의심", scared: "공포", smug: "여유",
};

/** 대사 맨 앞의 [감정] 태그를 떼어내고 감정을 돌려준다. 태그가 없으면 대사 내용으로 추정 */
export function parseSpoken(raw: string): { text: string; emotion: Emotion } {
  const m = raw.match(/^\s*[[(［]\s*([a-zA-Z]+)\s*[\])］]\s*/);
  if (m) {
    const key = m[1].toLowerCase() as Emotion;
    const text = raw.slice(m[0].length).trim();
    if (EMOTIONS.includes(key)) return { text, emotion: key };
    return { text, emotion: detectEmotion(text) };
  }
  return { text: raw.trim(), emotion: detectEmotion(raw) };
}

const RULES: [RegExp, Emotion][] = [
  [/(억울|화가|열받|닥쳐|웃기지\s?마|몰아가지|감히|뭐라고|죽여)/, "angry"],
  [/(무서|떨려|살려|설마|어떡|불안|겁나|제발)/, "scared"],
  [/(불쌍|슬프|안타깝|아쉽|흑|ㅠ|ㅜ)/, "sad"],
  [/(헉|어\?|뭐\?|진짜\?|갑자기|벌써|놀랐|!\?|\?!)/, "surprised"],
  [/(가짜|거짓말)/, "angry"],
  [/(수상|의심|이상하|찜찜|석연|해명|모순|거짓|근거|증거)/, "suspicious"],
  [/(ㅋㅋ|ㅎㅎ|좋아|좋은|웃|다행|고마|잘했)/, "happy"],
  [/(당연하|뻔하|말했잖|내 말이|그럴 줄|후훗|훗)/, "smug"],
];

export function detectEmotion(text: string): Emotion {
  for (const [re, e] of RULES) if (re.test(text)) return e;
  return "neutral";
}
