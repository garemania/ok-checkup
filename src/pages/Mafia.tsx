import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Face } from "@/mafia/components/Face";
import { TopBar } from "@/mafia/components/TopBar";
import { InkDefs } from "@/mafia/components/FaceArt";
import { SpeakerStage } from "@/mafia/components/SpeakerStage";
import { StartScreen } from "@/mafia/components/StartScreen";
import { PhaseBanner } from "@/mafia/components/PhaseBanner";
import { LogSheet } from "@/mafia/components/LogSheet";
import { ActionPanel } from "@/mafia/components/ActionPanel";
import { SettingsDialog } from "@/mafia/components/SettingsDialog";
import { InfoDialog } from "@/mafia/components/InfoDialog";
import { useMafiaGame } from "@/mafia/useMafiaGame";
import { HUMAN_ID } from "@/mafia/data";
import { emotionOf, mafiaPartners, tallyVotes } from "@/mafia/engine";
import { killAdvice } from "@/mafia/context";
import { ROLE_LABEL } from "@/mafia/types";
import { RoleIcon } from "@/mafia/components/RoleIcon";

const Mafia = () => {
  const g = useMafiaGame((m) => toast.error(m, { duration: 15000 }));
  const { state } = g;
  const [talkTo, setTalkTo] = useState<number | null>(null); // 얼굴을 눌러 지칭해서 말할 대상
  const [target, setTarget] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  // 게임 시작 직후 직업 안내
  const day = state?.day;
  const phase = state?.phase;
  useEffect(() => { setTarget(null); setTalkTo(null); }, [day, phase]);

  // 나만 아는 밤 결과를 아침에 개인 알림으로 (다른 사람에게는 보이지 않음)
  const lastNotified = useRef<string>("");
  useEffect(() => {
    if (!state) { lastNotified.current = ""; return; } // 새 게임이면 다시 알림
    if (state.phase !== "day") return;
    const key = `${state.day}`;
    if (lastNotified.current === key) return;
    lastNotified.current = key;
    const me = state.players[HUMAN_ID];
    const inv = (state.policeLog[HUMAN_ID] ?? []).find((r) => r.day === state.day);
    if (inv) toast(`조사 결과(나만 앎): ${state.players[inv.target].name}님은 ${inv.isMafia ? "마피아입니다" : "마피아가 아닙니다"}.`, { duration: 8000 });
    if (me.role === "soldier" && me.alive && !me.shield && state.mafiaLog.some((k) => k.day === state.day && k.target === HUMAN_ID))
      toast("어젯밤 마피아가 당신을 노렸지만 버텨냈습니다(나만 앎). 방어 능력은 이제 없습니다.", { duration: 8000 });
    const prot = (state.doctorLog[HUMAN_ID] ?? []).find((r) => r.day === state.day);
    if (prot) toast(`보호 결과(나만 앎): ${state.players[prot.target].name}님을 지킨 밤, ${prot.quiet ? "아무도 죽지 않았습니다(막았을 수도, 군인이 버텼을 수도)" : "다른 사람이 죽었습니다"}.`, { duration: 8000 });
  }, [state?.day, state?.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  // 내가 마피아일 때, 살아 있는 AI 동료가 오늘 밤 노릴 사람을 제안한다 (밤마다 한 번 정함)
  const partnerAdvice = useMemo(() => {
    if (!state || state.phase !== "night" || state.day === 1) return null;
    const meP = state.players[HUMAN_ID];
    if (meP.role !== "mafia" || !meP.alive) return null;
    const partner = mafiaPartners(state, HUMAN_ID).find((p) => p.alive && !p.isHuman);
    const a = partner ? killAdvice(state) : null;
    return partner && a ? { partner: partner.name, target: a.target, text: `동료 ${partner.name}의 의견: 오늘 밤은 ${state.players[a.target].name}. ${a.reason}.` } : null;
  }, [state?.day, state?.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (state && state.log.length === 1) setInfoOpen(true); }, [state?.log.length === 1]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) {
    const aiLabel = g.settings.mode === "api"
      ? `AI: ${g.settings.provider === "gemini" ? `Gemini (${g.settings.geminiModel})` : `Claude (${g.settings.model})`}`
      : "AI: 오프라인 (설정에서 API 연결 가능)";
    return (
      <>
        <StartScreen onStart={g.startGame} onSettings={() => setSettingsOpen(true)} aiLabel={aiLabel} />
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={g.settings} onSave={g.setSettings} errors={g.errors} onClearErrors={g.clearErrors} />
      </>
    );
  }

  const me = state.players[HUMAN_ID];
  const myPolice = state.policeLog[HUMAN_ID] ?? [];
  const counts = state.phase === "vote" || state.phase === "day" ? tallyVotes(state, state.votes).counts : {};
  const night = state.phase === "night";
  // 밤에는 능력 대상, 투표 때는 투표 대상으로 얼굴을 눌러 고른다
  const nightPick = state.phase === "night" && me.alive && (me.role === "police" || (state.day > 1 && (me.role === "mafia" || me.role === "doctor")));
  const canPick = nightPick || (state.phase === "vote" && me.alive && !g.busy);
  const talkTarget = talkTo !== null && state.players[talkTo].alive ? talkTo : null;

  // 얼굴을 누르면: 낮에는 그 사람을 지칭해서 말하기, 밤·투표에는 대상 고르기
  const onFace = (id: number) => {
    if (id === HUMAN_ID) { setInfoOpen(true); return; }
    const p = state.players[id];
    if (!p.alive) { toast(`${p.name}님은 사망했습니다.`); return; }
    if (canPick) {
      if (state.phase === "night" && me.role === "mafia" && p.role === "mafia") return;
      setTarget(target === id ? null : id);
      return;
    }
    if (state.phase === "day" && me.alive) setTalkTo(talkTarget === id ? null : id);
  };

  return (
    <div className={`min-h-screen transition-colors duration-700 ${night ? "bg-[hsl(230_35%_7%)]" : "bg-background"}`}>
      <InkDefs />
      <div className="mx-auto flex h-dvh max-w-3xl flex-col gap-2 p-2 sm:gap-3 sm:p-4">
        <TopBar state={state} onSettings={() => setSettingsOpen(true)} onInfo={() => setInfoOpen(true)} onLog={() => setLogOpen(true)} />

        <section className="grid grid-cols-8 gap-0 rounded-xl border border-border bg-card/60 p-1 sm:grid-cols-4 sm:gap-1 sm:rounded-2xl sm:p-2">
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
                selected={target === p.id || talkTarget === p.id}
                guess={g.guesses[p.id] ?? null}
                onGuess={p.isHuman ? undefined : () => g.cycleGuess(p.id)}
                onClick={() => onFace(p.id)}
              />
            );
          })}
        </section>

        <SpeakerStage state={state} speaking={g.speaking} waiting={g.waiting} watching={g.watching} autoAdvance={g.settings.autoAdvance} onToggleAuto={g.toggleAutoAdvance} onNext={g.advance} />

        <footer className="rounded-2xl border border-border bg-card">
          {target !== null && (state.phase === "night" || state.phase === "vote") && (
            <div className="border-b border-border px-4 py-1.5 text-xs text-muted-foreground">선택됨: {state.players[target].name}</div>
          )}
          <ActionPanel
            state={state}
            busy={g.busy}
            waiting={g.waiting}
            watching={g.watching}
            onWatch={g.runWatch}
            onStopWatch={g.stopWatch}
            awaitingHuman={g.awaitingHuman}
            guesses={g.guesses}
            target={target}
            talkTo={talkTarget}
            partnerAdvice={partnerAdvice}
            setTalkTo={setTalkTo}
            setTarget={setTarget}
            onNight={g.runNight}
            onRound={g.runRound}
            onSend={g.sendPublic}
            onAction={g.doAction}
            onStartVote={g.startVote}
            onDefense={g.submitDefense}
            onVerdict={g.submitVerdict}
            onVote={g.runVote}
            onRestart={g.quit}
          />
        </footer>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={g.settings} onSave={g.setSettings} errors={g.errors} onClearErrors={g.clearErrors} />
      <PhaseBanner phase={state.phase} day={state.day} />
      <LogSheet state={state} open={logOpen} onOpenChange={setLogOpen} />
      <InfoDialog state={state} open={infoOpen} onOpenChange={setInfoOpen} />

      <Dialog open={state.phase === "gameover"}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{state.winner === "citizen" ? "시민 승리" : "마피아 승리"}</DialogTitle>
            <DialogDescription>
              {(state.winner === "citizen") === (me.role !== "mafia") ? "당신의 팀이 이겼습니다." : "당신의 팀이 패배했습니다."}
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {state.players.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>{p.name}{p.isHuman && " (나)"}{!p.alive && " (사망)"}</span>
                <span className="inline-flex items-center gap-1"><RoleIcon role={p.role} className="h-3.5 w-3.5" />{ROLE_LABEL[p.role]}</span>
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
