import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Face } from "@/mafia/components/Face";
import { TopBar } from "@/mafia/components/TopBar";
import { InkDefs } from "@/mafia/components/FaceArt";
import { SpeakerStage } from "@/mafia/components/SpeakerStage";
import { ChatLog } from "@/mafia/components/ChatLog";
import { ActionPanel } from "@/mafia/components/ActionPanel";
import { WhisperSheet } from "@/mafia/components/WhisperSheet";
import { SettingsDialog } from "@/mafia/components/SettingsDialog";
import { InfoDialog } from "@/mafia/components/InfoDialog";
import { useMafiaGame } from "@/mafia/useMafiaGame";
import { HUMAN_ID } from "@/mafia/data";
import { emotionOf, tallyVotes } from "@/mafia/engine";
import { ROLE_EMOJI, ROLE_LABEL } from "@/mafia/types";

const Mafia = () => {
  const g = useMafiaGame((m) => toast.error(m, { duration: 15000 }));
  const { state } = g;
  const [whisperId, setWhisperId] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  // 게임 시작 직후 직업 안내
  const day = state?.day;
  const phase = state?.phase;
  useEffect(() => { setTarget(null); }, [day, phase]);
  useEffect(() => { if (state && state.log.length === 1) setInfoOpen(true); }, [state?.log.length === 1]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6 text-center">
        <div className="text-6xl">🌙🔪</div>
        <div>
          <h1 className="text-3xl font-bold">마피아 게임</h1>
          <p className="mt-2 text-muted-foreground">나 + AI 캐릭터 7명 · 마피아 2 / 경찰 1 / 의사 1 / 시민 4<br />캐릭터를 눌러 1:1 비밀 대화를 걸 수 있습니다.</p>
        </div>
        <div className="flex gap-2">
          <Button size="lg" onClick={g.startGame}>게임 시작</Button>
          <Button size="lg" variant="secondary" onClick={() => setSettingsOpen(true)}><Settings className="mr-1 h-4 w-4" />설정</Button>
        </div>
        <p className="text-xs text-muted-foreground">현재 AI: {g.settings.mode === "api" ? (g.settings.provider === "gemini" ? `Gemini (${g.settings.geminiModel})` : `Claude API (${g.settings.model})`) : "오프라인 AI (설정에서 API 연결 가능)"}</p>
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={g.settings} onSave={g.setSettings} errors={g.errors} onClearErrors={g.clearErrors} />
      </div>
    );
  }

  const me = state.players[HUMAN_ID];
  const myPolice = state.policeLog[HUMAN_ID] ?? [];
  const counts = state.phase === "vote" || state.phase === "day" ? tallyVotes(state, state.votes).counts : {};
  const night = state.phase === "night";
  // 밤에는 대상 지목 용도, 투표에서도 지목 용도로 시트에서 선택 가능
  const canPick = (state.phase === "night" && me.alive && me.role !== "citizen") || (state.phase === "vote" && me.alive && !g.busy);
  const pickLabel = state.phase === "vote" ? "이 사람에게 투표 선택" : "이 사람을 대상으로 선택";

  const openWhisper = (id: number) => {
    if (id === HUMAN_ID) { setInfoOpen(true); return; }
    setWhisperId(id);
    g.clearUnread(id);
  };

  return (
    <div className={`min-h-screen transition-colors duration-700 ${night ? "bg-[hsl(230_35%_7%)]" : "bg-background"}`}>
      <InkDefs />
      <div className="mx-auto flex h-screen max-w-3xl flex-col gap-3 p-3 sm:p-4">
        <TopBar state={state} onSettings={() => setSettingsOpen(true)} onInfo={() => setInfoOpen(true)} />

        <section className="grid grid-cols-4 gap-1 rounded-2xl border border-border bg-card/60 p-2">
          {state.players.map((p) => {
            const known = p.isHuman || state.phase === "gameover" || p.revealed || (me.role === "mafia" && p.role === "mafia");
            const inv = myPolice.find((r) => r.target === p.id);
            return (
              <Face
                key={p.id}
                player={p}
                emotion={emotionOf(state, p.id)}
                isMe={p.isHuman}
                speaking={g.speaking === p.id}
                showRole={known}
                mark={inv ? (inv.isMafia ? "mafia" : "clean") : null}
                voteCount={state.phase === "vote" && Object.keys(state.votes).length ? counts[p.id] : undefined}
                unread={g.unread[p.id]}
                selected={target === p.id}
                onClick={() => openWhisper(p.id)}
              />
            );
          })}
        </section>

        <SpeakerStage state={state} />

        <main className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card/40">
          <ChatLog state={state} speaking={g.speaking} />
        </main>

        <footer className="rounded-2xl border border-border bg-card">
          {target !== null && (state.phase === "night" || state.phase === "vote") && (
            <div className="border-b border-border px-4 py-1.5 text-xs text-muted-foreground">선택됨: {state.players[target].emoji} {state.players[target].name}</div>
          )}
          <ActionPanel
            state={state}
            busy={g.busy}
            target={target}
            setTarget={setTarget}
            onNight={g.runNight}
            onRound={g.runRound}
            onSend={g.sendPublic}
            onStartVote={g.startVote}
            onVote={g.runVote}
            onRestart={g.quit}
          />
        </footer>
      </div>

      <WhisperSheet
        state={state}
        targetId={whisperId}
        typing={g.typing}
        blockReason={whisperId !== null ? g.whisperBlockReason(whisperId) : null}
        onClose={() => setWhisperId(null)}
        onSend={g.sendWhisper}
        onPick={canPick ? setTarget : undefined}
        pickLabel={pickLabel}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={g.settings} onSave={g.setSettings} errors={g.errors} onClearErrors={g.clearErrors} />
      <InfoDialog state={state} open={infoOpen} onOpenChange={setInfoOpen} />

      <Dialog open={state.phase === "gameover"}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{state.winner === "citizen" ? "🎉 시민 승리!" : "😈 마피아 승리!"}</DialogTitle>
            <DialogDescription>
              {(state.winner === "citizen") === (me.role !== "mafia") ? "당신의 팀이 이겼습니다." : "당신의 팀이 패배했습니다."}
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {state.players.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>{p.emoji} {p.name}{p.isHuman && " (나)"}{!p.alive && " ✕"}</span>
                <span>{ROLE_EMOJI[p.role]} {ROLE_LABEL[p.role]}</span>
              </li>
            ))}
          </ul>
          <Button onClick={g.quit}>처음으로</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Mafia;
