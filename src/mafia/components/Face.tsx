import { cn } from "@/lib/utils";
import { ROLE_EMOJI } from "../types";
import type { Emotion, Player } from "../types";
import { FaceArt } from "./FaceArt";

interface Props {
  player: Player;
  emotion: Emotion | "dead";
  isMe: boolean;
  speaking: boolean;
  showRole: boolean; // 내가 알고 있는 직업 표시 (본인/마피아 동료/게임 종료)
  mark?: "mafia" | "clean" | null; // 경찰 조사 결과
  voteCount?: number;
  votedByMe?: boolean;
  unread?: boolean;
  selected?: boolean;
  onClick: () => void;
}

export function Face({ player: p, emotion, isMe, speaking, showRole, mark, voteCount, votedByMe, unread, selected, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex flex-col items-center gap-1 rounded-xl p-1.5 transition",
        "hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "bg-primary/15 ring-2 ring-primary",
      )}
      aria-label={`${p.name} ${p.alive ? "생존" : "사망"}`}
    >
      <div
        className={cn(
          "relative h-14 w-14 rounded-lg shadow-md transition sm:h-16 sm:w-16",
          speaking && "ring-4 ring-primary ring-offset-2 ring-offset-background animate-pulse",
          !p.alive && "opacity-60 grayscale",
        )}
      >
        <FaceArt look={p.look} hue={p.color} emotion={emotion} className="h-full w-full rounded-lg" rough />
        {unread && <span className="absolute -right-0.5 top-0 h-3.5 w-3.5 rounded-full border-2 border-background bg-destructive" />}
        {mark && (
          <span className={cn("absolute -bottom-1 -left-1 rounded-full px-1 text-[10px] font-bold", mark === "mafia" ? "bg-destructive text-destructive-foreground" : "bg-success text-background")}>
            {mark === "mafia" ? "🚨" : "✔"}
          </span>
        )}
        {voteCount ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">{voteCount}</span>
        ) : null}
      </div>
      <div className="flex max-w-full items-center gap-0.5 truncate text-xs font-medium">
        {isMe && <span className="rounded bg-primary px-1 text-[10px] text-primary-foreground">ME</span>}
        <span className={cn(!p.alive && "line-through text-muted-foreground")}>{p.name}</span>
      </div>
      <div className="h-4 text-[11px] text-muted-foreground">
        {showRole ? `${ROLE_EMOJI[p.role]}` : p.alive ? "생존" : "사망"}
        {votedByMe && " 🗳"}
      </div>
    </button>
  );
}
