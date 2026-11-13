import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { HUMAN_ID } from "../data";
import type { GameState } from "../types";
import { FaceArt } from "./FaceArt";
import { addresseeOf } from "../context";
import { EMOTION_LABEL } from "../emotion";

export function ChatLog({ state, speaking }: { state: GameState; speaking: number | null }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [state.log.length, speaking]);
  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto px-3 py-3" role="log" aria-live="polite">
      {state.log.map((m) => {
        if (m.from === "system") {
          return (
            <div key={m.id} className="mx-auto max-w-[90%] rounded-full bg-secondary/70 px-3 py-1 text-center text-xs text-muted-foreground">
              {m.text}
            </div>
          );
        }
        const p = state.players[m.from];
        const mine = m.from === HUMAN_ID;
        return (
          <div key={m.id} className={cn("flex items-end gap-2", mine && "flex-row-reverse")}>
            <FaceArt look={p.look} hue={p.color} emotion={m.emotion ?? "neutral"} className="h-11 w-11 shrink-0 rounded-md" />
            <div className={cn("max-w-[75%]", mine && "text-right")}>
              <div className="mb-0.5 text-[11px] text-muted-foreground">{p.name}{m.auto && <span className="ml-1 opacity-70">(자동)</span>}{m.emotion && m.emotion !== "neutral" && <span className="ml-1 opacity-70">· {EMOTION_LABEL[m.emotion]}</span>}{addresseeOf(state, m) !== null && <span className="ml-1 opacity-70">→ {state.players[addresseeOf(state, m)!].name}</span>}</div>
              <div className={cn("inline-block whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed", mine ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-secondary")}>
                {m.text}
              </div>
            </div>
          </div>
        );
      })}
      {speaking !== null && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FaceArt look={state.players[speaking].look} hue={state.players[speaking].color} emotion="neutral" className="h-6 w-6 rounded" />
          <span>{state.players[speaking].name}님이 입력 중</span>
          <span className="animate-pulse">...</span>
        </div>
      )}
      <div ref={end} />
    </div>
  );
}
