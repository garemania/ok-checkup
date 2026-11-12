import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Settings } from "../types";

export function SettingsDialog({ open, onOpenChange, settings, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; settings: Settings; onSave: (s: Settings) => void }) {
  const [s, setS] = useState(settings);
  const api = s.mode === "api";
  return (
    <Dialog open={open} onOpenChange={(o) => { if (o) setS(settings); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>설정</DialogTitle>
          <DialogDescription>AI 캐릭터를 어떻게 움직일지 정합니다. 변경은 다음 호출부터 적용됩니다.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>내 닉네임 (새 게임부터 적용)</Label>
            <Input value={s.nickname} maxLength={8} onChange={(e) => setS({ ...s, nickname: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(["mock", "api"] as const).map((m) => (
              <button key={m} onClick={() => setS({ ...s, mode: m })} className={`rounded-lg border p-3 text-left text-sm ${s.mode === m ? "border-primary bg-primary/10" : "border-border"}`}>
                <div className="font-semibold">{m === "mock" ? "오프라인 AI" : "Claude API"}</div>
                <div className="text-xs text-muted-foreground">{m === "mock" ? "키 없이 테스트용 규칙 기반 AI" : "각 캐릭터가 LLM으로 발언/투표"}</div>
              </button>
            ))}
          </div>
          {api && (
            <>
              <div className="space-y-1.5">
                <Label>API Key</Label>
                <Input type="password" value={s.apiKey} placeholder="sk-ant-..." onChange={(e) => setS({ ...s, apiKey: e.target.value })} />
                <p className="text-xs text-muted-foreground">브라우저(localStorage)에 저장되어 직접 호출됩니다. 배포 시에는 아래 Base URL을 자체 프록시로 바꿔 키를 서버에 두세요.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Base URL</Label>
                <Input value={s.baseUrl} onChange={(e) => setS({ ...s, baseUrl: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>모델</Label>
                <Input value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })} />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => { onSave(s); onOpenChange(false); }}>저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
