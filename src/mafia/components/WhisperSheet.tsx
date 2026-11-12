import { useEffect, useRef, useState } from "react";
import { Send, Crosshair } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { HUMAN_ID, MAX_WHISPERS_PER_DAY } from "../data";
import { ROLE_LABEL } from "../types";
import type { GameState } from "../types";

interface Props {
  state: GameState;
  targetId: number | null;
  typing: number | null;
  blockReason: string | null;
  onClose: () => void;
  onSend: (id: number, text: string) => void;
  onPick?: (id: number) => void; // 밤/투표 대상으로 지목
  pickLabel?: string;
}

export function WhisperSheet({ state, targetId, typing, blockReason, onClose, onSend, onPick, pickLabel }: Props) {
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const p = targetId !== null ? state.players[targetId] : null;
  const msgs = targetId !== null ? state.whispers[targetId] ?? [] : [];
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length, typing]);

  return (
    <Sheet open={targetId !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        {p && (
          <>
            <SheetHeader className="border-b border-border p-4 text-left">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full text-2xl" style={{ background: `hsl(${p.color} 55% 38%)` }}>{p.emoji}</div>
                <div className="flex-1">
                  <SheetTitle>{p.name} {!p.alive && <span className="text-sm text-muted-foreground">(사망{p.revealed ? ` · ${ROLE_LABEL[p.role]}` : ""})</span>}</SheetTitle>
                  <SheetDescription className="text-xs">{p.persona}</SheetDescription>
                </div>
              </div>
              {onPick && p.alive && (
                <Button size="sm" variant="secondary" className="mt-2 w-fit gap-1" onClick={() => { onPick(p.id); onClose(); }}>
                  <Crosshair className="h-4 w-4" />{pickLabel}
                </Button>
              )}
              <p className="text-[11px] text-muted-foreground">1:1 대화 {state.whispersUsed}/{MAX_WHISPERS_PER_DAY} 사용 (하루 단위) · 이 대화는 다른 참가자에게 보이지 않습니다</p>
            </SheetHeader>

            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {msgs.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{p.name}에게 비밀 대화를 걸어보세요.<br />정보를 캐내거나, 편을 만들거나, 떠볼 수 있습니다.</p>}
              {msgs.map((m) => {
                const mine = m.from === HUMAN_ID;
                return (
                  <div key={m.id} className={cn("flex", mine && "justify-end")}>
                    <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm", mine ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-secondary")}>{m.text}</div>
                  </div>
                );
              })}
              {typing === p.id && <p className="text-xs text-muted-foreground animate-pulse">{p.name}님이 입력 중...</p>}
              <div ref={end} />
            </div>

            <form
              className="border-t border-border p-3"
              onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onSend(p.id, text); setText(""); } }}
            >
              {blockReason && <p className="mb-2 text-xs text-muted-foreground">{blockReason}</p>}
              <div className="flex gap-2">
                <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={`${p.name}에게 귓속말...`} disabled={!!blockReason || typing !== null} maxLength={200} />
                <Button type="submit" size="icon" disabled={!!blockReason || typing !== null || !text.trim()} aria-label="보내기"><Send className="h-4 w-4" /></Button>
              </div>
            </form>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
