import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { HUMAN_ID } from "../data";
import type { GameState } from "../types";

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
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg"
              style={{ background: `hsl(${p.color} 55% 35%)` }}
            >{p.emoji}</div>
            <div className={cn("max-w-[75%]", mine && "text-right")}>
              <div className="mb-0.5 text-[11px] text-muted-foreground">{p.name}</div>
              <div className={cn("inline-block whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed", mine ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-secondary")}>
                {m.text}
              </div>
            </div>
          </div>
        );
      })}
      {speaking !== null && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{state.players[speaking].emoji}</span>
          <span>{state.players[speaking].name}님이 입력 중</span>
          <span className="animate-pulse">...</span>
        </div>
      )}
      <div ref={end} />
    </div>
  );
}
