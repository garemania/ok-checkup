import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HUMAN_ID } from "../data";
import { mafiaPartners } from "../engine";
import { ROLE_DESC, ROLE_LABEL } from "../types";
import { RoleIcon } from "./RoleIcon";
import type { GameState } from "../types";

export function InfoDialog({ state, open, onOpenChange }: { state: GameState; open: boolean; onOpenChange: (o: boolean) => void }) {
  const me = state.players[HUMAN_ID];
  const partners = mafiaPartners(state, HUMAN_ID);
  const inv = state.policeLog[HUMAN_ID] ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><RoleIcon role={me.role} className="h-5 w-5" /> 당신은 {ROLE_LABEL[me.role]}입니다</DialogTitle>
          <DialogDescription>{ROLE_DESC[me.role]}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {me.role === "mafia" && (
            <p>동료: {partners.map((p) => `${p.name}${p.alive ? "" : " (사망)"}`).join(", ")}</p>
          )}
          {me.role === "police" && (
            <div>
              <p className="mb-1 font-semibold">조사 기록</p>
              {inv.length ? inv.map((r, i) => (
                <p key={i}>{r.day}일차 밤 · {state.players[r.target].name} → {r.isMafia ? "마피아" : "마피아 아님"}</p>
              )) : <p className="text-muted-foreground">아직 조사한 사람이 없습니다.</p>}
            </div>
          )}
          <div className="rounded-lg bg-secondary/60 p-3 text-xs text-muted-foreground">
            구성: 마피아 2 · 경찰 1 · 의사 1 · 군인 1 · 시민 3<br />
            첫 밤에는 살해가 없고, 둘째 밤부터 마피아가 움직입니다.<br />
            낮: 토론과 행동 → 투표(최다 득표자 지목, 동점이면 무효) → 최후의 변론 → 찬반 투표(찬성이 많으면 처형)<br />
            밤: 마피아 살해 · 의사 보호 · 경찰 조사 · 군인은 습격을 한 번 버팀<br />
            마피아 전멸 시 시민 승리, 마피아 수 ≥ 시민 수 시 마피아 승리
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
