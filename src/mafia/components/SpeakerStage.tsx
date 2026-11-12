import { cn } from "@/lib/utils";
import { EMOTION_LABEL } from "../emotion";
import type { GameState } from "../types";
import { FaceArt } from "./FaceArt";

/** 방금 말한 캐릭터를 크게 보여주는 컷 (만화 컷처럼 대사와 함께 등장) */
export function SpeakerStage({ state }: { state: GameState }) {
  const last = [...state.log].reverse().find((m) => m.from !== "system");
  if (!last || last.from === "system") return null;
  const p = state.players[last.from];
  const emotion = last.emotion ?? "neutral";
  const loud = emotion === "angry" || emotion === "surprised" || emotion === "scared";
  return (
    <div key={last.id} className="flex items-stretch gap-3 rounded-2xl border border-border bg-card/70 p-2 animate-in fade-in slide-in-from-left-4 duration-200">
      <div className={cn("relative h-24 w-24 shrink-0 sm:h-28 sm:w-28", loud && "animate-[shake_0.35s_ease-in-out]")}>
        <FaceArt look={p.look} hue={p.color} emotion={emotion} className="h-full w-full rounded-lg shadow-lg" rough />
        <span className="absolute -bottom-1 left-1 rounded bg-black px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">
          {p.name} · {EMOTION_LABEL[emotion]}
        </span>
      </div>
      <div className="relative flex min-w-0 flex-1 items-center">
        <div
          className={cn(
            "relative max-h-24 overflow-y-auto rounded-xl border-2 border-black bg-[#f4efe6] px-3 py-2 text-sm font-semibold leading-snug text-black shadow-[3px_3px_0_0_#000] sm:text-base",
            loud && "border-[3px] text-[15px] font-extrabold",
          )}
        >
          {last.text}
          <span className="absolute -left-[9px] top-5 h-0 w-0 border-y-[7px] border-r-[9px] border-y-transparent border-r-black" />
        </div>
      </div>
    </div>
  );
}
