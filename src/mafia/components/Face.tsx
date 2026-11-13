import { cn } from "@/lib/utils";
import { ROLE_LABEL } from "../types";
import { RoleIcon } from "./RoleIcon";
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
        "group relative flex min-w-0 flex-col items-center gap-0.5 rounded-lg p-0.5 transition sm:gap-1 sm:rounded-xl sm:p-1.5",
        "hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "bg-primary/15 ring-2 ring-primary",
      )}
      aria-label={`${p.name} ${p.alive ? "생존" : "사망"}`}
    >
      <div
        className={cn(
          "relative aspect-square w-full max-w-11 rounded-md shadow-md transition sm:max-w-16 sm:rounded-lg",
          isMe && "outline outline-2 outline-primary sm:outline-0",
          speaking && "ring-2 ring-primary ring-offset-1 ring-offset-background animate-pulse sm:ring-4 sm:ring-offset-2",
          !p.alive && "opacity-60 grayscale",
        )}
      >
        <FaceArt look={p.look} hue={p.color} emotion={emotion} className="h-full w-full rounded-lg" rough />
        {unread && <span className="absolute -right-0.5 top-0 h-2.5 w-2.5 sm:h-3.5 sm:w-3.5 rounded-full border-2 border-background bg-destructive" />}
        {mark && (
          <span className={cn("absolute -bottom-1 -left-1 rounded-full px-0.5 text-[8px] font-bold sm:px-1 sm:text-[10px]", mark === "mafia" ? "bg-destructive text-destructive-foreground" : "bg-success text-background")}>
            {mark === "mafia" ? "마피아" : "시민"}
          </span>
        )}
        {voteCount ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground sm:h-5 sm:min-w-5 sm:text-xs">{voteCount}</span>
        ) : null}
      </div>
      <div className="flex max-w-full items-center gap-0.5 truncate text-[10px] font-medium sm:text-xs">
        {isMe && <span className="hidden rounded bg-primary px-1 text-[10px] text-primary-foreground sm:inline">ME</span>}
        <span className={cn(!p.alive && "line-through text-muted-foreground")}>{p.name}</span>
      </div>
      <div className="h-3 text-[11px] text-muted-foreground sm:h-4">
        {showRole ? <span className="inline-flex items-center gap-0.5"><RoleIcon role={p.role} className="h-3 w-3" /><span className="hidden sm:inline">{ROLE_LABEL[p.role]}</span></span> : <span className="hidden sm:inline">{p.alive ? "생존" : "사망"}</span>}
        {votedByMe && <span className="hidden sm:inline"> (투표)</span>}
      </div>
    </button>
  );
}
