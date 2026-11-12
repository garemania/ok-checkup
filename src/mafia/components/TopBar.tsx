import { Moon, Settings, Sun, Vote, Skull, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROLE_EMOJI, ROLE_LABEL } from "../types";
import type { GameState } from "../types";
import { HUMAN_ID } from "../data";

const PHASE = {
  intro: { icon: Moon, label: "준비" },
  night: { icon: Moon, label: "밤" },
  day: { icon: Sun, label: "낮 · 토론" },
  vote: { icon: Vote, label: "투표" },
  gameover: { icon: Skull, label: "게임 종료" },
} as const;

export function TopBar({ state, onSettings, onInfo }: { state: GameState; onSettings: () => void; onInfo: () => void }) {
  const ph = PHASE[state.phase];
  const Icon = ph.icon;
  const me = state.players[HUMAN_ID];
  const aliveCount = state.players.filter((p) => p.alive).length;
  const night = state.phase === "night";
  return (
    <header
      className={`flex items-center justify-between gap-2 rounded-2xl border px-4 py-3 transition-colors ${night ? "bg-indigo-950/60 border-indigo-500/30" : "bg-card border-border"}`}
    >
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${night ? "bg-indigo-500/20 text-indigo-300" : "bg-primary/20 text-primary"}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-lg font-bold leading-tight">{state.day}일차 {ph.label}</div>
          <div className="text-xs text-muted-foreground">
            생존 {aliveCount}/8 · 마피아 2명 · 하루 토론 {state.round}/3 라운드
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button onClick={onInfo} className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border bg-secondary px-3 py-1 text-sm hover:bg-secondary/70">
          <span>{ROLE_EMOJI[me.role]}</span>
          <span className="font-medium">{ROLE_LABEL[me.role]}</span>
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <Button variant="ghost" size="icon" onClick={onSettings} aria-label="설정"><Settings className="h-5 w-5" /></Button>
      </div>
    </header>
  );
}
