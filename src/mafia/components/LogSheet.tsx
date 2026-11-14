import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { GameState } from "../types";
import { ChatLog } from "./ChatLog";

/** 지금까지의 공개 대화 기록 (열었을 때 현재까지의 내용을 보여준다) */
export function LogSheet({ state, open, onOpenChange }: { state: GameState; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex h-[85vh] flex-col gap-0 p-0 sm:mx-auto sm:max-w-2xl">
        <SheetHeader className="border-b border-border p-4 text-left">
          <SheetTitle>대화 기록</SheetTitle>
          <SheetDescription className="text-xs">지금까지의 대화입니다.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1">
          <ChatLog state={state} speaking={null} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
