import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { HUMAN_ID, MAX_ACTIONS_PER_DAY, MAX_ROUNDS } from "../data";
import { alive, mafiaPartners } from "../engine";
import { ROLE_LABEL } from "../types";
import type { GameState, Role } from "../types";
import type { DayAction } from "../useMafiaGame";
import { FaceArt } from "./FaceArt";
import { RoleIcon } from "./RoleIcon";

interface Props {
  state: GameState;
  busy: boolean;
  waiting: boolean; // AI 대화 중 "다음" 대기 (이때는 끼어들어 말할 수 있다)
  awaitingHuman: boolean;
  target: number | null;
  setTarget: (id: number | null) => void;
  onNight: (target?: number) => void;
  onRound: () => void;
  onSend: (t: string, to: number | null) => void;
  onAction: (a: DayAction) => void;
  onStartVote: () => void;
  onVote: (t: number | null) => void;
  onDefense: (t: string | null) => void;
  onVerdict: (v: boolean) => void;
  onRestart: () => void;
}

const NIGHT_TEXT = {
  mafia: { title: "오늘 밤 제거할 사람을 고르세요", cta: "살해 확정" },
  doctor: { title: "오늘 밤 보호할 사람을 고르세요 (본인 가능)", cta: "보호 확정" },
  police: { title: "오늘 밤 조사할 사람을 고르세요", cta: "조사 확정" },
} as const;

const ACTIONS = [
  { kind: "suspect", label: "의심 지목", needTarget: true },
  { kind: "trust", label: "옹호", needTarget: true },
  { kind: "ask", label: "추궁", needTarget: true },
  { kind: "report", label: "조사 보고", needTarget: true },
  { kind: "claim", label: "직업 주장", needTarget: false },
] as const;
type ActionKind = (typeof ACTIONS)[number]["kind"];
const CLAIM_ROLES: Role[] = ["police", "doctor", "soldier", "mafia", "citizen"];

export function ActionPanel({ state, busy, waiting, awaitingHuman, target, setTarget, onNight, onRound, onSend, onAction, onStartVote, onVote, onDefense, onVerdict, onRestart }: Props) {
  const [text, setText] = useState("");
  const [talkTo, setTalkTo] = useState<number | null>(null); // 공개적으로 말을 걸 대상 (없으면 모두에게)
  const [defense, setDefense] = useState("");
  const [mode, setMode] = useState<ActionKind | null>(null);
  const [claimRole, setClaimRole] = useState<Role | null>(null);
  const [reportResult, setReportResult] = useState<"clean" | "mafia" | null>(null);
  const me = state.players[HUMAN_ID];
  const living = alive(state);

  const Chip = ({ id, selected, onPick }: { id: number; selected: boolean; onPick: () => void }) => {
    const p = state.players[id];
    return (
      <button
        key={id}
        onClick={onPick}
        className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition", selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary hover:bg-secondary/70")}
      >
        <FaceArt look={p.look} hue={p.color} emotion="neutral" className="h-6 w-6 rounded" />
        {p.name}
      </button>
    );
  };

  const TargetPicker = ({ includeSelf, excludeMafia }: { includeSelf: boolean; excludeMafia?: boolean }) => (
    <div className="flex flex-wrap gap-1.5">
      {living
        .filter((p) => (includeSelf || !p.isHuman) && !(excludeMafia && p.role === "mafia" && me.role === "mafia"))
        .map((p) => <Chip key={p.id} id={p.id} selected={target === p.id} onPick={() => setTarget(target === p.id ? null : p.id)} />)}
    </div>
  );

  if (state.phase === "gameover") {
    return (
      <div className="flex items-center justify-between gap-3 p-4">
        <p className="font-semibold">{state.winner === "citizen" ? "시민 승리" : "마피아 승리"}</p>
        <Button onClick={onRestart}>다시 하기</Button>
      </div>
    );
  }

  /* ---------------- 밤 ---------------- */
  if (state.phase === "night") {
    if (!me.alive) return <Banner>사망하여 관전 중입니다. 밤이 진행됩니다...</Banner>;
    if (busy) return <Banner>밤이 진행되는 중...</Banner>;
    const first = state.day === 1;
    if (first && me.role !== "police") {
      const partners = mafiaPartners(state, HUMAN_ID);
      return (
        <div className="space-y-3 p-4">
          <p className="text-sm font-medium">첫 밤입니다. 아직 아무도 습격당하지 않습니다.</p>
          <p className="text-sm text-muted-foreground">
            {me.role === "mafia"
              ? `동료는 ${partners.map((p) => p.name).join(", ")}입니다. 얼굴을 눌러 1:1로 작전을 상의할 수 있습니다. 습격은 둘째 밤부터 가능합니다.`
              : me.role === "doctor"
                ? "보호는 둘째 밤부터 필요합니다. 오늘은 쉬세요."
                : me.role === "soldier"
                  ? "당신은 마피아의 습격을 한 번 버텨냅니다. 정체를 숨기고 아침을 기다리세요."
                  : "당신은 시민입니다. 눈을 감고 아침을 기다리세요."}
          </p>
          <Button className="w-full" onClick={() => onNight()}>아침을 기다리기</Button>
        </div>
      );
    }
    if (me.role === "citizen" || me.role === "soldier") {
      return (
        <div className="space-y-3 p-4">
          <p className="text-sm text-muted-foreground">
            {me.role === "soldier" ? "당신은 군인입니다. 습격을 받으면 한 번 버텨냅니다. 눈을 감고 아침을 기다리세요." : "당신은 시민입니다. 밤에는 할 수 있는 일이 없습니다. 눈을 감고 아침을 기다리세요."}
          </p>
          <Button className="w-full" onClick={() => onNight()}>눈 감고 기다리기</Button>
        </div>
      );
    }
    const cfg = NIGHT_TEXT[me.role as "mafia" | "doctor" | "police"];
    return (
      <div className="space-y-3 p-4">
        <p className="flex items-center gap-1.5 text-sm font-medium"><RoleIcon role={me.role} />{cfg.title}</p>
        {me.role === "mafia" && <p className="text-xs text-muted-foreground">동료 얼굴을 눌러 1:1로 작전을 상의할 수 있습니다.</p>}
        <TargetPicker includeSelf={me.role === "doctor"} excludeMafia />
        <Button className="w-full" disabled={target === null} onClick={() => { onNight(target!); setTarget(null); }}>{cfg.cta}</Button>
      </div>
    );
  }

  /* ---------------- 투표 ---------------- */
  if (state.phase === "vote") {
    if (busy) return <Banner>개표 중... 위의 "다음" 버튼으로 넘기세요.</Banner>;
    if (!me.alive) return <Banner><Button onClick={() => onVote(null)}>투표 결과 보기 (관전)</Button></Banner>;
    return (
      <div className="space-y-3 p-4">
        <p className="text-sm font-medium">가장 의심되는 사람을 선택하세요. 최다 득표자는 최후의 변론 후 찬반 투표를 받습니다.</p>
        <TargetPicker includeSelf={false} />
        <div className="flex gap-2">
          <Button className="flex-1" variant="secondary" onClick={() => { onVote(null); setTarget(null); }}>기권</Button>
          <Button className="flex-1" disabled={target === null} onClick={() => { onVote(target); setTarget(null); }}>투표하기</Button>
        </div>
      </div>
    );
  }

  /* ---------------- 재판 ---------------- */
  if (state.phase === "trial") {
    const accused = state.accused !== null ? state.players[state.accused] : null;
    if (awaitingHuman && state.trialStage === "defense" && accused?.isHuman) {
      return (
        <form className="space-y-2 p-4" onSubmit={(e) => { e.preventDefault(); onDefense(defense); setDefense(""); }}>
          <p className="text-sm font-medium">최다 득표로 지목되었습니다. 최후의 변론을 하세요.</p>
          <Input value={defense} onChange={(e) => setDefense(e.target.value)} placeholder="억울함을 호소하거나 누군가를 지목하세요" maxLength={200} />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => { onDefense(null); setDefense(""); }}>변론 생략</Button>
            <Button type="submit" className="flex-1" disabled={!defense.trim()}>변론하기</Button>
          </div>
        </form>
      );
    }
    if (awaitingHuman && state.trialStage === "verdict") {
      return (
        <div className="space-y-3 p-4">
          <p className="text-sm font-medium">{accused?.name}님을 처형할까요? 찬성이 반대보다 많으면 처형됩니다.</p>
          <div className="flex gap-2">
            <Button className="flex-1" variant="secondary" onClick={() => onVerdict(false)}>반대 (살린다)</Button>
            <Button className="flex-1" onClick={() => onVerdict(true)}>찬성 (처형)</Button>
          </div>
        </div>
      );
    }
    return <Banner>{accused?.name}님의 재판이 진행 중입니다. 위의 "다음" 버튼으로 넘기세요.</Banner>;
  }

  /* ---------------- 낮 ---------------- */
  const roundsLeft = MAX_ROUNDS - state.round;
  const actionsLeft = MAX_ACTIONS_PER_DAY - state.actionsUsed;
  const canAct = me.alive && !busy && actionsLeft > 0;
  const needsTarget = mode !== null && ACTIONS.find((a) => a.kind === mode)?.needTarget;
  const ready = mode === "claim" ? claimRole !== null : mode === "report" ? target !== null && reportResult !== null : target !== null;
  const cancelMode = () => { setMode(null); setClaimRole(null); setReportResult(null); setTarget(null); };
  const myRecords = me.role === "police" ? (state.policeLog[HUMAN_ID] ?? []) : [];
  return (
    <div className="space-y-2 p-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>행동 (남은 횟수 {actionsLeft}/{MAX_ACTIONS_PER_DAY})</span>
          {mode && <button className="underline" onClick={cancelMode}>취소</button>}
        </div>
        <div className="grid grid-cols-5 gap-1">
          {ACTIONS.map((a) => (
            <button
              key={a.kind}
              disabled={!canAct}
              onClick={() => { setMode(mode === a.kind ? null : a.kind); setClaimRole(null); setReportResult(null); setTarget(null); }}
              className={cn("rounded-md border px-0.5 py-1.5 text-[11px] font-bold leading-tight transition disabled:opacity-40 sm:text-xs", mode === a.kind ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary hover:bg-secondary/70")}
            >
              {a.label}
            </button>
          ))}
        </div>
        {mode && (
          <div className="space-y-2 rounded-lg bg-secondary/40 p-2">
            {needsTarget ? (
              <TargetPicker includeSelf={false} />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {CLAIM_ROLES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setClaimRole(claimRole === r ? null : r)}
                    className={cn("flex items-center gap-1 rounded-full border px-3 py-1 text-sm", claimRole === r ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary")}
                  >
                    <RoleIcon role={r} className="h-3.5 w-3.5" />{ROLE_LABEL[r]}
                  </button>
                ))}
              </div>
            )}
            {mode === "report" && (
              <div className="space-y-1.5">
                <div className="flex gap-1.5">
                  {([["clean", "마피아 아님"], ["mafia", "마피아다"]] as const).map(([k, label]) => (
                    <button key={k} onClick={() => setReportResult(reportResult === k ? null : k)} className={cn("flex-1 rounded-full border px-3 py-1 text-sm", reportResult === k ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary")}>{label}</button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  &quot;저는 경찰이고 조사했더니 ~입니다&quot;라고 공개합니다.
                  {myRecords.length > 0 && ` 내 조사 기록: ${myRecords.map((r) => `${state.players[r.target].name}=${r.isMafia ? "마피아" : "마피아 아님"}`).join(", ")}`}
                  {me.role !== "police" && " 경찰이 아니어도 보고할 수 있지만 거짓은 들통날 수 있습니다."}
                </p>
              </div>
            )}
            {mode === "claim" && <p className="text-[11px] text-muted-foreground">진짜 직업이 아니어도 주장할 수 있습니다. 거짓 주장은 들통나면 의심받습니다.</p>}
            <Button
              size="sm"
              className="w-full"
              disabled={!ready}
              onClick={() => {
                if (mode === "claim" && claimRole) onAction({ kind: "claim", role: claimRole });
                else if (mode === "report" && target !== null && reportResult) onAction({ kind: "report", target, result: reportResult });
                else if (mode && mode !== "claim" && mode !== "report" && target !== null) onAction({ kind: mode, target });
                cancelMode();
              }}
            >
              실행
            </Button>
          </div>
        )}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onSend(text, talkTo !== null && state.players[talkTo].alive ? talkTo : null); setText(""); } }}>
        <select
          value={talkTo ?? ""}
          onChange={(e) => setTalkTo(e.target.value === "" ? null : Number(e.target.value))}
          disabled={!me.alive}
          aria-label="말을 걸 대상"
          className="h-10 w-[5.5rem] shrink-0 rounded-md border border-input bg-background px-1.5 text-xs sm:w-28 sm:text-sm"
        >
          <option value="">모두에게</option>
          {living.filter((p) => !p.isHuman).map((p) => (
            <option key={p.id} value={p.id}>{p.name}에게</option>
          ))}
        </select>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={!me.alive ? "사망하여 발언할 수 없습니다" : talkTo !== null ? `${state.players[talkTo].name}에게 말하기 (모두가 들음)` : busy && waiting ? "끼어들어 말하기..." : "모두에게 발언하기..."}
          disabled={!me.alive || (busy && !waiting)}
          maxLength={200}
        />
        <Button type="submit" size="icon" disabled={!me.alive || (busy && !waiting) || !text.trim()} aria-label="보내기"><Send className="h-4 w-4" /></Button>
      </form>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" disabled={busy || roundsLeft <= 0} onClick={onRound}>
          {roundsLeft === 1 ? "대화 진행 (마지막, 끝나면 투표)" : `대화 진행 (${roundsLeft}회 남음)`}
        </Button>
        <Button className="flex-1" disabled={busy} onClick={onStartVote}>투표로 넘어가기</Button>
      </div>
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-center p-5 text-center text-sm text-muted-foreground">{children}</div>;
}
