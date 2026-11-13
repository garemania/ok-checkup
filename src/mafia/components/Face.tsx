import { cn } from "@/lib/utils";
import { ROLE_LABEL, ROLE_TONE } from "../types";
import { RoleIcon } from "./RoleIcon";
import type { Emotion, Player, Role } from "../types";
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
  selected?: boolean;
  guess?: Role | null; // 내 직업 추정 메모
  onGuess?: () => void;
  onClick: () => void;
}

export function Face({ player: p, emotion, isMe, speaking, showRole, mark, voteCount, votedByMe, selected, guess, onGuess, onClick }: Props) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
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
      {showRole ? (
        <div className="flex h-4 items-center text-[11px] text-muted-foreground sm:h-5">
          <span className="inline-flex items-center gap-0.5"><RoleIcon role={p.role} className="h-3 w-3" /><span className="hidden sm:inline">{ROLE_LABEL[p.role]}</span></span>
          {votedByMe && <span className="hidden sm:inline"> (투표)</span>}
        </div>
      ) : onGuess ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onGuess(); }}
          className={cn(
            "flex h-4 min-w-[1.6rem] items-center justify-center gap-0.5 rounded-full border px-1 text-[9px] font-bold leading-none sm:h-5 sm:px-1.5 sm:text-[10px]",
            guess ? ROLE_TONE[guess] : "border-dashed border-border text-muted-foreground",
          )}
          aria-label={`${p.name} 직업 추정: ${guess ? ROLE_LABEL[guess] : "모름"} (누르면 바뀜)`}
        >
          {guess ? (
            <>
              <RoleIcon role={guess} className="h-2.5 w-2.5" />
              <span className="sm:hidden">{ROLE_LABEL[guess].slice(0, 1)}</span>
              <span className="hidden sm:inline">{ROLE_LABEL[guess]}</span>
            </>
          ) : (
            <span>?</span>
          )}
        </button>
      ) : (
        <div className="h-4 sm:h-5" />
      )}
    </div>
  );
}
