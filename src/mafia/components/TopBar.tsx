import { Moon, ScrollText, Settings, Sun, Vote, Skull, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROLE_LABEL } from "../types";
import { RoleIcon } from "./RoleIcon";
import type { GameState } from "../types";
import { HUMAN_ID } from "../data";

const PHASE = {
  intro: { icon: Moon, label: "준비" },
  night: { icon: Moon, label: "밤" },
  day: { icon: Sun, label: "낮 · 토론" },
  vote: { icon: Vote, label: "투표" },
  trial: { icon: Vote, label: "재판" },
  gameover: { icon: Skull, label: "게임 종료" },
} as const;

export function TopBar({ state, onSettings, onInfo, onLog }: { state: GameState; onSettings: () => void; onInfo: () => void; onLog: () => void }) {
  const ph = PHASE[state.phase];
  const Icon = ph.icon;
  const me = state.players[HUMAN_ID];
  const aliveCount = state.players.filter((p) => p.alive).length;
  const night = state.phase === "night";
  return (
    <header
      className={`flex items-center justify-between gap-2 rounded-2xl border px-2.5 py-2 transition-colors sm:px-4 sm:py-3 ${night ? "bg-indigo-950/60 border-indigo-500/30" : "bg-card border-border"}`}
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <div className={`flex h-8 w-8 shrink-0 items-center sm:h-10 sm:w-10 justify-center rounded-full ${night ? "bg-indigo-500/20 text-indigo-300" : "bg-primary/20 text-primary"}`}>
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-base font-bold leading-tight sm:text-lg">{state.day}일차 {ph.label}</div>
          <div className="truncate text-[11px] text-muted-foreground sm:text-xs">
            <span className="sm:hidden">생존 {aliveCount}/8 · 토론 {state.round}/3</span>
            <span className="hidden sm:inline">생존 {aliveCount}/8 · 마피아 2명 · 하루 토론 {state.round}/3 라운드</span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1.5">
        <button onClick={onInfo} className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border bg-secondary px-2 py-0.5 text-xs hover:bg-secondary/70 sm:px-3 sm:py-1 sm:text-sm">
          <RoleIcon role={me.role} />
          <span className="font-medium">{ROLE_LABEL[me.role]}</span>
          <Info className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
        </button>
        <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10" onClick={onLog} aria-label="대화 기록"><ScrollText className="h-4 w-4 sm:h-5 sm:w-5" /></Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10" onClick={onSettings} aria-label="설정"><Settings className="h-4 w-4 sm:h-5 sm:w-5" /></Button>
      </div>
    </header>
  );
}
