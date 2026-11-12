import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { AI_CHARS, HUMAN_CHAR } from "../data";
import type { Emotion } from "../types";
import { FaceArt, InkDefs } from "./FaceArt";

const CAST: { char: (typeof AI_CHARS)[number] | typeof HUMAN_CHAR; emotion: Emotion; tilt: number; lift: number }[] = [
  { char: HUMAN_CHAR, emotion: "neutral", tilt: -2, lift: 0 },
  { char: AI_CHARS[0], emotion: "suspicious", tilt: 2, lift: 10 },
  { char: AI_CHARS[1], emotion: "smug", tilt: -3, lift: 0 },
  { char: AI_CHARS[2], emotion: "scared", tilt: 2, lift: 10 },
  { char: AI_CHARS[3], emotion: "happy", tilt: 3, lift: 6 },
  { char: AI_CHARS[4], emotion: "neutral", tilt: -2, lift: 0 },
  { char: AI_CHARS[5], emotion: "surprised", tilt: 2, lift: 10 },
  { char: AI_CHARS[6], emotion: "angry", tilt: -3, lift: 2 },
];

const ROLES = [
  ["마피아", "2"],
  ["경찰", "1"],
  ["의사", "1"],
  ["시민", "4"],
] as const;

interface Props {
  onStart: () => void;
  onSettings: () => void;
  aiLabel: string;
}

export function StartScreen({ onStart, onSettings, aiLabel }: Props) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0a090b] text-[#e8e0d0]">
      <InkDefs />

      {/* 배경: 망점 톤, 붉은 사선, 비네팅 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,.09) 1px, transparent 1.5px)", backgroundSize: "7px 7px" }}
      />
      <div className="pointer-events-none absolute -left-1/4 top-[18%] h-24 w-[150%] -rotate-[8deg] bg-[#9c1a1a]/70 mix-blend-screen" />
      <div className="pointer-events-none absolute -left-1/4 top-[26%] h-2 w-[150%] -rotate-[8deg] bg-[#e8e0d0]/70" />
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 38%, transparent 30%, rgba(0,0,0,.85) 100%)" }} />

      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-between px-5 py-8">
        {/* 상단 문구 */}
        <div className="w-full text-center animate-in fade-in duration-500">
          <p className="text-[11px] font-bold tracking-[0.5em] text-[#c4231b]">8 PLAYERS &nbsp;/&nbsp; 1 TRUTH</p>
        </div>

        {/* 타이틀 */}
        <div className="relative w-full text-center">
          <h1
            className="select-none text-[26vw] font-black leading-[0.85] tracking-tighter animate-in fade-in zoom-in-95 duration-500 sm:text-[9.5rem]"
            style={{ textShadow: "5px 5px 0 #b3191f, 9px 9px 0 #000", filter: "url(#mafia-ink)" }}
          >
            MAFIA
          </h1>
          <div className="mt-3 flex items-center justify-center gap-3">
            <span className="h-px w-10 bg-[#e8e0d0]/50" />
            <p className="text-lg font-black tracking-[0.4em] sm:text-xl">마피아 게임</p>
            <span className="h-px w-10 bg-[#e8e0d0]/50" />
          </div>
          <p className="mt-4 text-sm font-medium text-[#e8e0d0]/70">마을 사람은 여덟. 그중 둘은 사람이 아니다.</p>
        </div>

        {/* 캐릭터 라인업 */}
        <div className="grid w-full max-w-xl grid-cols-4 gap-x-2 gap-y-3 py-6">
          {CAST.map(({ char, emotion, tilt, lift }, i) => (
            <div
              key={char.name}
              className="flex flex-col items-center animate-in fade-in slide-in-from-bottom-6 fill-mode-both duration-500"
              style={{ animationDelay: `${150 + i * 80}ms`, transform: `translateY(${lift}px) rotate(${tilt}deg)` }}
            >
              <div className="relative w-full max-w-[96px] border-2 border-black bg-black shadow-[3px_3px_0_0_#9c1a1a]">
                <FaceArt look={char.look} hue={char.color} emotion={emotion} className="block aspect-square h-auto w-full" rough />
                <span className="absolute bottom-0 left-0 bg-black px-1.5 py-0.5 text-[10px] font-bold tracking-wider">{char.name === "나" ? "YOU" : char.name}</span>
              </div>
            </div>
          ))}
        </div>

        {/* 하단 */}
        <div className="flex w-full max-w-md flex-col items-center gap-3">
          <div className="flex flex-wrap justify-center gap-1.5">
            {ROLES.map(([name, n]) => (
              <span key={name} className="border border-[#e8e0d0]/30 bg-black/50 px-2.5 py-1 text-xs font-bold tracking-wide">
                {name} <span className="text-[#c4231b]">{n}</span>
              </span>
            ))}
          </div>

          <button
            onClick={onStart}
            className={cn(
              "group relative w-full -skew-x-6 border-2 border-black bg-[#c4231b] py-4 text-2xl font-black tracking-[0.3em] text-[#f4efe6]",
              "shadow-[6px_6px_0_0_#000] transition active:translate-x-[3px] active:translate-y-[3px] active:shadow-[3px_3px_0_0_#000] hover:bg-[#d92a21]",
            )}
          >
            <span className="inline-block skew-x-6">게임 시작</span>
          </button>
          <button
            onClick={onSettings}
            className="flex w-full -skew-x-6 items-center justify-center gap-2 border-2 border-[#e8e0d0]/60 bg-black/40 py-2.5 text-sm font-bold tracking-[0.25em] transition hover:bg-[#e8e0d0]/10"
          >
            <span className="inline-flex skew-x-6 items-center gap-2"><Settings className="h-4 w-4" />설정</span>
          </button>
          <p className="pt-1 text-[11px] tracking-wide text-[#e8e0d0]/50">{aiLabel}</p>
        </div>
      </div>
    </div>
  );
}
