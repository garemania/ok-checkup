import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Settings } from "../types";

export function SettingsDialog({ open, onOpenChange, settings, onSave, errors = [], onClearErrors }: { open: boolean; onOpenChange: (o: boolean) => void; settings: Settings; onSave: (s: Settings) => void; errors?: string[]; onClearErrors?: () => void }) {
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
                <div className="font-semibold">{m === "mock" ? "오프라인 AI" : "Claude / Gemini API"}</div>
                <div className="text-xs text-muted-foreground">{m === "mock" ? "키 없이 테스트용 규칙 기반 AI" : "각 캐릭터가 LLM으로 발언/투표"}</div>
              </button>
            ))}
          </div>
          {api && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {(["anthropic", "gemini"] as const).map((v) => (
                  <button key={v} onClick={() => setS({ ...s, provider: v })} className={`rounded-lg border p-2 text-sm font-medium ${s.provider === v ? "border-primary bg-primary/10" : "border-border"}`}>
                    {v === "anthropic" ? "Claude (Anthropic)" : "Gemini (Google)"}
                  </button>
                ))}
              </div>
              {s.provider === "anthropic" ? (
                <>
                  <div className="space-y-1.5">
                    <Label>Claude API Key</Label>
                    <Input type="password" value={s.apiKey} placeholder="sk-ant-..." onChange={(e) => setS({ ...s, apiKey: e.target.value })} />
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
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label>Gemini API Key</Label>
                    <Input type="password" value={s.geminiKey} placeholder="AIza..." onChange={(e) => setS({ ...s, geminiKey: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>모델</Label>
                    <Input value={s.geminiModel} onChange={(e) => setS({ ...s, geminiModel: e.target.value })} />
                  </div>
                </>
              )}
              <p className="text-xs text-muted-foreground">키는 이 기기의 브라우저(localStorage)에만 저장되고 선택한 API로 직접 전송됩니다. 공용 기기에서는 쓰지 마세요.</p>
            </>
          )}
        </div>
        {errors.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>최근 API 오류</Label>
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(errors.join("\n\n"))}>복사</Button>
                {onClearErrors && <Button type="button" size="sm" variant="ghost" onClick={onClearErrors}>지우기</Button>}
              </div>
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-secondary/60 p-2 text-[11px] leading-snug">{errors.join("\n\n")}</pre>
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => { onSave(s); onOpenChange(false); }}>저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
