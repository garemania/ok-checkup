import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { HUMAN_ID, MAX_ROUNDS } from "../data";
import { alive } from "../engine";
import type { GameState } from "../types";
import { FaceArt } from "./FaceArt";

interface Props {
  state: GameState;
  busy: boolean;
  target: number | null;
  setTarget: (id: number | null) => void;
  onNight: (target?: number) => void;
  onRound: () => void;
  onSend: (t: string) => void;
  onStartVote: () => void;
  onVote: (t: number | null) => void;
  onRestart: () => void;
}

const NIGHT_TEXT = {
  mafia: { title: "🔪 오늘 밤 제거할 사람을 고르세요", cta: "살해 확정", kind: "kill" },
  doctor: { title: "💉 오늘 밤 보호할 사람을 고르세요 (본인 가능)", cta: "보호 확정", kind: "protect" },
  police: { title: "🕵️ 오늘 밤 조사할 사람을 고르세요", cta: "조사 확정", kind: "investigate" },
} as const;

export function ActionPanel({ state, busy, target, setTarget, onNight, onRound, onSend, onStartVote, onVote, onRestart }: Props) {
  const [text, setText] = useState("");
  const me = state.players[HUMAN_ID];
  const living = alive(state);

  const TargetPicker = ({ includeSelf, excludeMafia }: { includeSelf: boolean; excludeMafia?: boolean }) => (
    <div className="flex flex-wrap gap-1.5">
      {living
        .filter((p) => (includeSelf || !p.isHuman) && !(excludeMafia && p.role === "mafia" && me.role === "mafia"))
        .map((p) => (
          <button
            key={p.id}
            onClick={() => setTarget(target === p.id ? null : p.id)}
            className={cn("flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm transition", target === p.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary hover:bg-secondary/70")}
          >
            <FaceArt look={p.look} hue={p.color} emotion="neutral" className="h-6 w-6 rounded" />{p.name}
          </button>
        ))}
    </div>
  );

  if (state.phase === "gameover") {
    return (
      <div className="flex items-center justify-between gap-3 p-4">
        <p className="font-semibold">{state.winner === "citizen" ? "🎉 시민 승리" : "😈 마피아 승리"}</p>
        <Button onClick={onRestart}>다시 하기</Button>
      </div>
    );
  }

  if (state.phase === "night") {
    if (!me.alive) return <Banner>👻 사망하여 관전 중입니다. 밤이 진행됩니다...</Banner>;
    if (busy) return <Banner>🌙 밤이 진행되는 중...</Banner>;
    if (me.role === "citizen") {
      return (
        <div className="space-y-3 p-4">
          <p className="text-sm text-muted-foreground">당신은 시민입니다. 밤에는 할 수 있는 일이 없습니다. 눈을 감고 아침을 기다리세요.</p>
          <Button className="w-full" onClick={() => onNight()}>눈 감고 기다리기</Button>
        </div>
      );
    }
    const cfg = NIGHT_TEXT[me.role];
    return (
      <div className="space-y-3 p-4">
        <p className="text-sm font-medium">{cfg.title}</p>
        {me.role === "mafia" && <p className="text-xs text-muted-foreground">동료 얼굴을 눌러 1:1로 작전을 상의할 수 있습니다.</p>}
        <TargetPicker includeSelf={me.role === "doctor"} excludeMafia />
        <Button className="w-full" disabled={target === null} onClick={() => { onNight(target!); setTarget(null); }}>{cfg.cta}</Button>
      </div>
    );
  }

  if (state.phase === "vote") {
    if (busy) return <Banner>🗳 개표 중...</Banner>;
    if (!me.alive) return <Banner><Button onClick={() => onVote(null)}>투표 결과 보기 (관전)</Button></Banner>;
    return (
      <div className="space-y-3 p-4">
        <p className="text-sm font-medium">🗳 처형할 사람을 선택하세요</p>
        <TargetPicker includeSelf={false} />
        <div className="flex gap-2">
          <Button className="flex-1" variant="secondary" onClick={() => { onVote(null); setTarget(null); }}>기권</Button>
          <Button className="flex-1" disabled={target === null} onClick={() => { onVote(target); setTarget(null); }}>투표하기</Button>
        </div>
      </div>
    );
  }

  // day
  const roundsLeft = MAX_ROUNDS - state.round;
  return (
    <div className="space-y-2 p-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onSend(text); setText(""); } }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={me.alive ? "모두에게 발언하기..." : "사망하여 발언할 수 없습니다"}
          disabled={!me.alive || busy}
          maxLength={200}
        />
        <Button type="submit" size="icon" disabled={!me.alive || busy || !text.trim()} aria-label="보내기"><Send className="h-4 w-4" /></Button>
      </form>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" disabled={busy || roundsLeft <= 0} onClick={onRound}>
          {state.round === 0 ? "토론 시작" : "다음 발언 라운드"} ({roundsLeft}회 남음)
        </Button>
        <Button className="flex-1" disabled={busy} onClick={onStartVote}>투표로 넘어가기</Button>
      </div>
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-center p-5 text-sm text-muted-foreground">{children}</div>;
}
