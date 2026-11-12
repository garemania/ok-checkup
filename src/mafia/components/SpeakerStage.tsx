import { ChevronsRight, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EMOTION_LABEL } from "../emotion";
import type { GameState } from "../types";
import { FaceArt } from "./FaceArt";

interface Props {
  state: GameState;
  speaking: number | null; // 대사를 생각 중인 캐릭터
  waiting: boolean; // 사용자가 "다음"을 누르길 기다리는 중
  onNext: () => void;
}

/** 현재 대사를 한 컷으로 보여주는 무대. 누르면 다음 대사로 넘어간다. */
export function SpeakerStage({ state, speaking, waiting, onNext }: Props) {
  const last = state.log[state.log.length - 1];
  const thinking = speaking !== null ? state.players[speaking] : null;

  let body: React.ReactNode = null;
  if (last) {
    if (last.from === "system") {
      body = (
        <div key={last.id} className="flex h-full items-center justify-center p-3 animate-in fade-in duration-200">
          <div className="max-h-full w-full overflow-y-auto rounded-xl border-2 border-black bg-[#e9e1d2] px-4 py-3 text-center text-sm font-semibold leading-relaxed text-black shadow-[3px_3px_0_0_#000] whitespace-pre-line sm:text-base">
            {last.text}
          </div>
        </div>
      );
    } else {
      const p = state.players[last.from];
      const emotion = last.emotion ?? "neutral";
      const loud = emotion === "angry" || emotion === "surprised" || emotion === "scared";
      body = (
        <div key={last.id} className="flex h-full items-stretch gap-3 p-3 animate-in fade-in slide-in-from-left-4 duration-200">
          <div className={cn("relative h-28 w-28 shrink-0 self-start sm:h-32 sm:w-32", loud && "animate-[shake_0.35s_ease-in-out]")}>
            <FaceArt look={p.look} hue={p.color} emotion={emotion} className="h-full w-full rounded-lg shadow-lg" rough />
            <span className="absolute -bottom-1 left-1 rounded bg-black px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">
              {p.name} · {EMOTION_LABEL[emotion]}
            </span>
          </div>
          <div className="relative min-h-0 min-w-0 flex-1">
            <div
              className={cn(
                "relative max-h-full overflow-y-auto rounded-xl border-2 border-black bg-[#f4efe6] px-3 py-2 text-sm font-semibold leading-snug text-black shadow-[3px_3px_0_0_#000] sm:text-base",
                loud && "border-[3px] font-extrabold",
              )}
            >
              {last.text}
            </div>
            <span className="absolute -left-[9px] top-5 h-0 w-0 border-y-[7px] border-r-[9px] border-y-transparent border-r-black" />
          </div>
        </div>
      );
    }
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card/60"
      onClick={waiting ? onNext : undefined}
      role={waiting ? "button" : undefined}
      aria-label={waiting ? "다음 대사" : undefined}
    >
      <div className="min-h-0 flex-1">{body}</div>
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-t border-border/60 px-3">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {thinking ? (
            <>
              <FaceArt look={thinking.look} hue={thinking.color} emotion="neutral" className="h-6 w-6 rounded" />
              <span className="truncate">{thinking.name}님이 말하는 중<span className="animate-pulse">...</span></span>
            </>
          ) : state.phase === "night" ? (
            <><Moon className="h-4 w-4" />밤입니다</>
          ) : (
            <span className="truncate">대화 기록은 위쪽 📜 버튼</span>
          )}
        </span>
        {waiting && (
          <Button
            size="sm"
            className="gap-1 animate-pulse"
            onClick={(e) => { e.stopPropagation(); onNext(); }}
          >
            다음 <ChevronsRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
