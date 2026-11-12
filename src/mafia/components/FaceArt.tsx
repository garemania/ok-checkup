import { memo, useId } from "react";
import type { Emotion, Look } from "../types";

/**
 * 코드로 그리는 거친 잉크 만화풍 얼굴 (SVG).
 * - 거친 선: <InkDefs/> 의 #mafia-ink 필터(선 떨림)를 큰 초상화에만 적용
 * - 감정별로 눈·눈썹·입·보조 표시(땀, 핏줄, 눈물, 해칭)가 바뀜
 */

const INK = "#17120f";
const SKIN = "#efe0d0";
const SKIN_SH = "#c9ad96";

interface Props {
  look: Look;
  hue: number;
  emotion: Emotion | "dead";
  size?: number;
  rough?: boolean; // 거친 선 필터 (큰 초상화용)
  className?: string;
}

/** 앱 루트에 한 번만 렌더링: 거친 잉크 필터와 망점 패턴 */
export function InkDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
      <defs>
        <filter id="mafia-ink" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" />
        </filter>
        <pattern id="mafia-dots" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
          <circle cx="2" cy="2" r="0.9" fill="#000" />
        </pattern>
      </defs>
    </svg>
  );
}

interface EmoCfg {
  eye: "open" | "arc" | "half" | "dead";
  ry: number; // 눈 높이
  pupil: number;
  gaze: [number, number];
  brow: { l: [number, number]; r: [number, number] }; // [바깥 y, 안쪽 y]
  mouth: Emotion | "dead";
  bg?: [number, number]; // [hue, sat] 덮어쓰기
}

const CFG: Record<Emotion | "dead", EmoCfg> = {
  neutral:    { eye: "open", ry: 4.4, pupil: 1.7, gaze: [0, 0], brow: { l: [41, 42], r: [42, 41] }, mouth: "neutral" },
  happy:      { eye: "arc",  ry: 4,   pupil: 1.7, gaze: [0, 0], brow: { l: [39, 39], r: [39, 39] }, mouth: "happy" },
  angry:      { eye: "open", ry: 3.3, pupil: 1.2, gaze: [0, 0.4], brow: { l: [38, 46], r: [46, 38] }, mouth: "angry", bg: [0, 50] },
  sad:        { eye: "open", ry: 4.2, pupil: 2.1, gaze: [0, 1], brow: { l: [45, 39], r: [39, 45] }, mouth: "sad", bg: [215, 22] },
  surprised:  { eye: "open", ry: 6.6, pupil: 1,   gaze: [0, 0], brow: { l: [35, 35], r: [35, 35] }, mouth: "surprised", bg: [48, 45] },
  suspicious: { eye: "half", ry: 3.6, pupil: 1.5, gaze: [2, 0], brow: { l: [43, 44], r: [36, 38] }, mouth: "suspicious" },
  scared:     { eye: "open", ry: 6,   pupil: 0.9, gaze: [0, 0], brow: { l: [44, 38], r: [38, 44] }, mouth: "scared", bg: [225, 25] },
  smug:       { eye: "half", ry: 3.4, pupil: 1.7, gaze: [-1, 0], brow: { l: [41, 41], r: [37, 38] }, mouth: "smug" },
  dead:       { eye: "dead", ry: 4,   pupil: 1,   gaze: [0, 0], brow: { l: [43, 43], r: [43, 43] }, mouth: "dead", bg: [0, 0] },
};

const EYE_L = 40;
const EYE_R = 60;
const EYE_Y = 50;

function bangs(hair: Look["hair"]): string {
  switch (hair) {
    case "spiky":
      return "M28 46 L30 30 L36 20 L40 28 L46 14 L52 26 L58 12 L62 26 L68 18 L72 30 L72 46 L66 36 L60 42 L54 34 L48 42 L42 34 L36 42Z";
    case "wild":
      return "M27 48 L26 32 L33 22 L35 30 L42 14 L47 26 L55 10 L58 26 L67 16 L68 28 L75 24 L73 48 L66 38 L61 44 L55 34 L49 43 L43 34 L37 44 L31 38Z";
    case "messy":
      return "M28 46 C24 30 30 16 44 14 L50 20 L58 12 C70 16 76 30 72 46 L66 40 L62 34 L56 40 L50 33 L44 40 L38 34 L34 42Z";
    case "long":
    case "bob":
      return "M28 48 C25 26 36 16 50 16 C64 16 75 26 72 48 L66 36 C60 34 54 32 50 28 C46 33 38 36 34 37Z";
    default:
      return "M28 46 C26 26 36 16 50 16 C64 16 74 26 72 46 L68 38 C60 41 40 41 32 38Z";
  }
}

function backHair(hair: Look["hair"]): string | null {
  if (hair === "long") return "M27 44 C21 62 21 80 25 96 L39 90 L36 52Z M73 44 C79 62 79 80 75 96 L61 90 L64 52Z";
  if (hair === "bob") return "M27 44 C23 58 25 72 33 76 L37 54Z M73 44 C77 58 75 72 67 76 L63 54Z";
  return null;
}

function Ears({ type, hair }: { type: NonNullable<Look["ears"]>; hair: string }) {
  const f = { fill: hair, stroke: INK, strokeWidth: 1.4, strokeLinejoin: "round" as const };
  const inner = { fill: "#d98c8c", opacity: 0.8 };
  switch (type) {
    case "fox":
    case "wolf":
      return (
        <g>
          <path d="M31 32 L26 8 L46 22Z" {...f} /><path d="M69 32 L74 8 L54 22Z" {...f} />
          <path d="M32 27 L29 14 L40 23Z" {...inner} /><path d="M68 27 L71 14 L60 23Z" {...inner} />
        </g>
      );
    case "cat":
      return (
        <g>
          <path d="M30 34 L28 10 L46 24Z" {...f} /><path d="M70 34 L72 10 L54 24Z" {...f} />
          <path d="M32 29 L31 16 L41 25Z" {...inner} /><path d="M68 29 L69 16 L59 25Z" {...inner} />
        </g>
      );
    case "bear":
      return (
        <g>
          <circle cx="30" cy="26" r="7.5" {...f} /><circle cx="70" cy="26" r="7.5" {...f} />
          <circle cx="30" cy="26" r="3.5" {...inner} /><circle cx="70" cy="26" r="3.5" {...inner} />
        </g>
      );
    case "rabbit":
      return (
        <g>
          <path d="M36 30 C26 6 32 -4 41 6 C46 14 46 24 44 30Z" {...f} />
          <path d="M64 30 C74 14 80 12 78 26 C77 32 70 34 56 30Z" {...f} />
          <path d="M37 24 C33 10 36 4 39 10 C41 15 41 20 41 24Z" {...inner} />
        </g>
      );
    case "owl":
      return (
        <g>
          <path d="M30 34 L24 14 L28 16 L33 8 L42 26Z" {...f} /><path d="M70 34 L76 14 L72 16 L67 8 L58 26Z" {...f} />
        </g>
      );
  }
}

function Eye({ cx, cfg, id, hue, bags, mirror }: { cx: number; cfg: EmoCfg; id: string; hue: number; bags?: boolean; mirror?: boolean }) {
  const cy = EYE_Y;
  const [gx, gy] = cfg.gaze;
  if (cfg.eye === "dead") {
    return (
      <g stroke={INK} strokeWidth="1.8" strokeLinecap="round">
        <path d={`M${cx - 4} ${cy - 3.5} L${cx + 4} ${cy + 3.5} M${cx + 4} ${cy - 3.5} L${cx - 4} ${cy + 3.5}`} />
      </g>
    );
  }
  if (cfg.eye === "arc") {
    return <path d={`M${cx - 6} ${cy + 2} Q${cx} ${cy - 7} ${cx + 6} ${cy + 2}`} fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />;
  }
  const ry = cfg.ry;
  const lid = cfg.eye === "half" ? ry * 0.9 : 0;
  const cid = `${id}c${mirror ? "r" : "l"}`;
  return (
    <g>
      <clipPath id={cid}><ellipse cx={cx} cy={cy} rx="6.8" ry={ry} /></clipPath>
      <ellipse cx={cx} cy={cy} rx="6.8" ry={ry} fill="#f4efe6" />
      <g clipPath={`url(#${cid})`}>
        <circle cx={cx + gx} cy={cy + gy} r="4.6" fill={`hsl(${hue} 45% 32%)`} />
        <circle cx={cx + gx} cy={cy + gy} r="3.1" fill="none" stroke={INK} strokeWidth="0.6" />
        <circle cx={cx + gx} cy={cy + gy} r={cfg.pupil} fill={INK} />
        <circle cx={cx + gx - 1.4} cy={cy + gy - 1.6} r="0.9" fill="#fff" />
        {lid > 0 && <rect x={cx - 8} y={cy - ry - 1} width="16" height={lid + 1} fill={SKIN} />}
      </g>
      <ellipse cx={cx} cy={cy} rx="6.8" ry={ry} fill="none" stroke={INK} strokeWidth="1.5" />
      {lid > 0 && <path d={`M${cx - 7.4} ${cy - ry + lid} L${cx + 7.4} ${cy - ry + lid - (mirror ? 0 : 0.4)}`} stroke={INK} strokeWidth="2" strokeLinecap="round" />}
      <path d={`M${cx - 6} ${cy + ry + 1.4} Q${cx} ${cy + ry + 3.8} ${cx + 6} ${cy + ry + 1.4}`} fill="none" stroke={INK} strokeWidth={bags ? 1.4 : 0.8} opacity={bags ? 0.9 : 0.55} />
      {bags && <path d={`M${cx - 5} ${cy + ry + 4.4} Q${cx} ${cy + ry + 6.6} ${cx + 5} ${cy + ry + 4.4}`} fill="none" stroke={INK} strokeWidth="0.9" opacity="0.6" />}
    </g>
  );
}

function Mouth({ type }: { type: EmoCfg["mouth"] }) {
  const line = { fill: "none", stroke: INK, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (type) {
    case "happy":
      return (
        <g>
          <path d="M39 64 Q50 80 61 64 Z" fill="#2a0f10" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M41 65.4 L59 65.4" stroke="#f4efe6" strokeWidth="2.4" />
          <path d="M45 72 Q50 75 55 72" fill="none" stroke="#c0505a" strokeWidth="1.6" />
        </g>
      );
    case "angry":
      return (
        <g>
          <path d="M38 64 Q50 60 62 64 L60 75 Q50 79 40 75 Z" fill="#2a0f10" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M40 64.6 l3 5 l3 -5 l3 5 l3 -5 l3 5 l3 -5 l3 5 l3 -5 Z" fill="#f4efe6" stroke={INK} strokeWidth="0.5" />
          <path d="M42 75.6 l3 -4 l3 4 l3 -4 l3 4 l3 -4 l3 4" fill="none" stroke="#f4efe6" strokeWidth="0.9" />
        </g>
      );
    case "sad":
      return <path d="M42 73 Q50 64 58 73" {...line} />;
    case "surprised":
      return <ellipse cx="50" cy="70" rx="3.6" ry="5.4" fill="#2a0f10" stroke={INK} strokeWidth="1.6" />;
    case "suspicious":
      return <path d="M43 70 L52 70.6 L58 66.5" {...line} />;
    case "scared":
      return (
        <g>
          <path d="M41 71 q2.5 -4 5 0 t5 0 t5 0" {...line} />
          <path d="M44 72.4 v2.2 M50 72.4 v2.2 M56 72.4 v2.2" stroke={INK} strokeWidth="0.8" />
        </g>
      );
    case "smug":
      return (
        <g>
          <path d="M42 68 Q52 75 60 64" {...line} />
          <path d="M57 67.4 l1.8 3.2 l1.2 -3.8" fill="#f4efe6" stroke={INK} strokeWidth="0.7" />
        </g>
      );
    case "dead":
      return <path d="M44 70 H56" {...line} />;
    default:
      return <path d="M44 69.5 L56 69.5" {...line} />;
  }
}

function Extras({ emotion }: { emotion: Emotion | "dead" }) {
  switch (emotion) {
    case "angry":
      return (
        <g fill="none" stroke="#c4231b" strokeWidth="1.6" strokeLinecap="round">
          <path d="M63 29 Q66.5 29 66.5 25.5 M70 29 Q66.5 29 66.5 32.5 M63 36 Q66.5 36 66.5 32.5 M70 36 Q66.5 36 66.5 39.5" transform="translate(2 -6) scale(.8)" />
          <g stroke={INK} strokeWidth="0.7" opacity="0.5"><path d="M34 40 v8 M38 39 v9 M42 38 v8 M58 38 v8 M62 39 v9 M66 40 v8" /></g>
        </g>
      );
    case "scared":
      return (
        <g>
          <path d="M71 36 Q75 42 71 46 Q67 42 71 36Z" fill="#bfe3f5" stroke={INK} strokeWidth="1" />
          <g stroke={INK} strokeWidth="0.8" opacity="0.55"><path d="M32 30 v14 M37 28 v14 M43 27 v14 M57 27 v14 M63 28 v14 M68 30 v14" /></g>
        </g>
      );
    case "sad":
      return (
        <g>
          <path d="M37.5 57 Q35 63 37.5 66 Q40 63 37.5 57Z" fill="#bfe3f5" stroke={INK} strokeWidth="0.9" />
          <path d="M62.5 57 Q60 63 62.5 66 Q65 63 62.5 57Z" fill="#bfe3f5" stroke={INK} strokeWidth="0.9" />
        </g>
      );
    case "happy":
      return <g stroke="#d1505a" strokeWidth="1.1" strokeLinecap="round"><path d="M33 59 l2 3 M36 58.5 l2 3 M63 62 l2 -3 M66 62 l2 -3" /></g>;
    case "suspicious":
      return <g stroke={INK} strokeWidth="0.7" opacity="0.5"><path d="M34 38 v9 M38 37 v9 M42 36 v9" /></g>;
    case "smug":
      return <g stroke="#d1505a" strokeWidth="1" strokeLinecap="round" opacity="0.8"><path d="M64 60 l2 3 M67 59.5 l2 3" /></g>;
    case "surprised":
      return <g stroke={INK} strokeWidth="1.2" strokeLinecap="round"><path d="M72 30 l4 -3 M73 36 l5 0 M28 30 l-4 -3 M27 36 l-5 0" /></g>;
    default:
      return null;
  }
}

function Accessory({ look, cfg, emotion, id, hue }: { look: Look; cfg: EmoCfg; emotion: Emotion | "dead"; id: string; hue: number }) {
  const a = look.accessory;
  if (a === "shades") {
    return (
      <g>
        <path d="M30 45 H48 L46 56 Q40 58 34 56Z" fill="#0c0b0b" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M70 45 H52 L54 56 Q60 58 66 56Z" fill="#0c0b0b" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M48 47 H52" stroke={INK} strokeWidth="1.6" />
        <path d="M34 48 l4 0 M33 51 l2 0 M56 48 l4 0" stroke="#e9e3d8" strokeWidth="1" opacity="0.7" />
        {emotion === "dead" && <path d="M34 48 l6 6 M40 48 l-6 6 M54 48 l6 6 M60 48 l-6 6" stroke="#e9e3d8" strokeWidth="1.2" />}
      </g>
    );
  }
  if (a === "glasses") {
    return (
      <g fill="none" stroke={INK} strokeWidth="1.1">
        <circle cx={EYE_L} cy={EYE_Y} r="8.6" /><circle cx={EYE_R} cy={EYE_Y} r="8.6" />
        <path d="M48.6 49 Q50 47.6 51.4 49" />
        <path d="M33 45 l4 -4" stroke="#fff" opacity="0.6" />
      </g>
    );
  }
  if (a === "scar") {
    return (
      <g stroke="#8b2f2f" strokeWidth="1.5" strokeLinecap="round">
        <path d="M63 38 L67 62" />
        <path d="M61.4 45 l4.4 -1.6 M62.2 51 l4.6 -1.4 M63 57 l4.4 -1.2" strokeWidth="1" />
      </g>
    );
  }
  if (a === "headband") {
    return <path d="M29 34 C40 28 60 28 71 34" fill="none" stroke={`hsl(${hue} 75% 55%)`} strokeWidth="3.4" strokeLinecap="round" />;
  }
  if (a === "stubble") {
    return (
      <g stroke={INK} strokeWidth="0.8" opacity="0.6" strokeLinecap="round">
        <path d="M38 72 l0.6 1.6 M42 76 l0.6 1.6 M46 78 l0.4 1.6 M50 79 l0 1.6 M54 78 l-0.4 1.6 M58 76 l-0.6 1.6 M62 72 l-0.6 1.6 M44 73 l0 1.4 M56 73 l0 1.4 M50 75.4 l0 1.4" />
      </g>
    );
  }
  if (a === "whiskers") {
    return (
      <g stroke={INK} strokeWidth="0.9" strokeLinecap="round" opacity="0.8">
        <path d="M30 60 l-7 -2 M30 63 l-7 1 M31 66 l-6 4 M70 60 l7 -2 M70 63 l7 1 M69 66 l6 4" />
      </g>
    );
  }
  void cfg; void id;
  return null;
}

function FaceArtImpl({ look, hue, emotion, size = 64, rough = false, className }: Props) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const cfg = CFG[emotion];
  const bgHue = cfg.bg ? cfg.bg[0] : hue;
  const bgSat = cfg.bg ? cfg.bg[1] : 28;
  const bw = look.browWidth ?? 2.2;
  const back = backHair(look.hair);
  const speedLines = emotion === "angry" || emotion === "surprised";
  const hasEyes = look.accessory !== "shades" || emotion === "dead";
  const L = cfg.brow.l;
  const R = cfg.brow.r;

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} role="img" aria-label={`표정: ${emotion}`}>
      {/* 배경: 감정색 + 망점 톤 + 집중선 */}
      <rect width="100" height="100" fill={`hsl(${bgHue} ${bgSat}% ${emotion === "dead" ? 22 : 30}%)`} />
      <rect width="100" height="100" fill="url(#mafia-dots)" opacity="0.32" />
      {speedLines && (
        <g stroke="#fff" strokeWidth="0.8" opacity="0.28">
          {Array.from({ length: 14 }).map((_, i) => {
            const a = (i / 14) * Math.PI * 2;
            return <line key={i} x1={50 + Math.cos(a) * 34} y1={50 + Math.sin(a) * 34} x2={50 + Math.cos(a) * 80} y2={50 + Math.sin(a) * 80} />;
          })}
        </g>
      )}
      <g filter={rough ? "url(#mafia-ink)" : undefined} strokeLinejoin="round">
        {/* 옷 + 목 */}
        <path d="M6 100 C10 86 30 80 44 82 L50 94 L56 82 C70 80 90 86 94 100Z" fill={`hsl(${hue} 16% 17%)`} stroke={INK} strokeWidth="1.8" />
        <path d="M44 82 L50 94 L56 82" fill="none" stroke="#e6ddd0" strokeWidth="1.2" opacity="0.6" />
        <rect x="44" y="72" width="12" height="12" fill={SKIN_SH} stroke={INK} strokeWidth="1.4" />
        {/* 머리 뒤쪽 */}
        {look.ears && <Ears type={look.ears} hair={look.hairColor} />}
        {back && <path d={back} fill={look.hairColor} stroke={INK} strokeWidth="1.6" />}
        {/* 얼굴 */}
        <path d="M30 40 C30 26 39 21 50 21 C61 21 70 26 70 40 L69 56 C68 68 60 80 50 83 C40 80 32 68 31 56 Z" fill={SKIN} stroke={INK} strokeWidth="2" />
        {look.ears === null || look.ears === "owl" ? (
          <g fill={SKIN} stroke={INK} strokeWidth="1.3"><ellipse cx="29" cy="52" rx="2.6" ry="4.4" /><ellipse cx="71" cy="52" rx="2.6" ry="4.4" /></g>
        ) : null}
        {/* 음영 해칭 */}
        <g stroke={INK} strokeWidth="0.7" opacity="0.28"><path d="M33 60 l4 5 M35 56 l5 6 M32 66 l5 5 M67 60 l-4 5 M66 66 l-4 5" /></g>
        {/* 코 */}
        <path d="M49.4 56 L47.6 62 L51 62.4" fill="none" stroke={INK} strokeWidth="0.9" strokeLinecap="round" opacity="0.8" />
        {/* 눈 */}
        {hasEyes && (
          <>
            <Eye cx={EYE_L} cfg={cfg} id={id} hue={hue} bags={look.heavyBags || emotion === "scared"} />
            <Eye cx={EYE_R} cfg={cfg} id={id} hue={hue} bags={look.heavyBags || emotion === "scared"} mirror />
          </>
        )}
        <Accessory look={look} cfg={cfg} emotion={emotion} id={id} hue={hue} />
        {/* 눈썹 */}
        <g stroke={look.hairColor === "#2a211b" ? INK : look.hairColor} strokeWidth={bw} strokeLinecap="round" fill="none">
          <path d={`M32 ${L[0]} L47 ${L[1]}`} />
          <path d={`M68 ${R[0]} L53 ${R[1]}`} />
        </g>
        <g stroke={INK} strokeWidth="0.6" fill="none" opacity="0.7">
          <path d={`M32 ${L[0] + 1.2} L47 ${L[1] + 1.2}`} />
          <path d={`M68 ${R[0] + 1.2} L53 ${R[1] + 1.2}`} />
        </g>
        <Mouth type={cfg.mouth} />
        <Extras emotion={emotion} />
        {/* 앞머리 */}
        <path d={bangs(look.hair)} fill={look.hairColor} stroke={INK} strokeWidth="1.8" />
        {look.hair === "bun" && <circle cx="50" cy="12" r="8" fill={look.hairColor} stroke={INK} strokeWidth="1.6" />}
        <path d="M36 22 Q42 19 47 20 M54 20 Q60 19 65 24" fill="none" stroke="#fff" strokeWidth="1.1" opacity="0.28" strokeLinecap="round" />
      </g>
      {/* 외곽 잉크 테두리 */}
      <rect x="1" y="1" width="98" height="98" fill="none" stroke={INK} strokeWidth="2.4" />
    </svg>
  );
}

export const FaceArt = memo(FaceArtImpl);
