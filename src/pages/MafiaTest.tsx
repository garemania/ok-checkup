import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { makeAI } from "@/mafia/ai";
import { BUILD_LABEL } from "@/mafia/buildInfo";
import { runSelfTest, type SelfTestResult } from "@/mafia/selftest";
import { loadSettings } from "@/mafia/useMafiaGame";

/** 설정에 저장된 API 키로 대화 시나리오를 실제 호출해 보는 화면 (/mafia-test) */
const MafiaTest = () => {
  const settings = loadSettings();
  const [results, setResults] = useState<SelfTestResult[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const usingApi = settings.mode === "api";
  const label = usingApi ? (settings.provider === "gemini" ? `Gemini (${settings.geminiModel})` : `Claude (${settings.model})`) : "오프라인 AI";

  const run = async () => {
    setRunning(true);
    setResults([]);
    setErrors([]);
    const ai = makeAI(settings, (e) => setErrors((x) => [...x, e.message]));
    const fallback = makeAI({ ...settings, mode: "mock" }, () => {});
    try {
      await runSelfTest(ai, fallback, settings.nickname || "나", (r) => setResults((x) => [...x, r]));
    } catch (e) {
      setErrors((x) => [...x, (e as Error).message]);
    }
    setRunning(false);
  };

  const report = [
    `[마피아 API 테스트] ${label} / ${BUILD_LABEL}`,
    ...results.map((r) => [`## ${r.title}`, ...r.lines, ...r.checks.map((c) => `${c.ok ? "통과" : "실패"}: ${c.label}`)].join("\n")),
    errors.length ? `## API 오류\n${errors.join("\n")}` : "",
  ].join("\n\n");
  const passed = results.flatMap((r) => r.checks).filter((c) => c.ok).length;
  const total = results.flatMap((r) => r.checks).length;

  return (
    <div className="mx-auto min-h-screen max-w-2xl space-y-4 bg-background p-4 text-sm">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">API 대화 테스트</h1>
        <Link to="/mafia" className="text-xs underline">게임으로</Link>
      </div>
      <p className="text-muted-foreground">
        설정에 저장된 키로 실제 AI를 호출해 그동안 문제가 됐던 상황을 재현하고 자동으로 판정합니다. 키는 이 기기 밖으로 나가지 않습니다. 호출은 약 20회입니다.
      </p>
      <p>현재 AI: <b>{label}</b>{!usingApi && " — 설정에서 Claude API를 켜야 실제 호출로 시험합니다."}</p>
      <div className="flex gap-2">
        <Button onClick={run} disabled={running}>{running ? "실행 중..." : "테스트 실행"}</Button>
        <Button variant="secondary" disabled={!results.length || running} onClick={() => { void navigator.clipboard?.writeText(report); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          {copied ? "복사됨" : "결과 복사"}
        </Button>
      </div>
      {total > 0 && <p className="font-semibold">판정: {passed}/{total} 통과{running ? " (진행 중)" : ""}</p>}
      {results.map((r) => (
        <div key={r.title} className="space-y-1 rounded-lg border border-border p-3">
          <p className="font-semibold">{r.title}</p>
          {r.lines.map((l, i) => <p key={i} className="whitespace-pre-wrap text-muted-foreground">{l}</p>)}
          {r.checks.map((c) => (
            <p key={c.label} className={c.ok ? "text-green-500" : "text-red-500"}>{c.ok ? "통과" : "실패"}: {c.label}</p>
          ))}
        </div>
      ))}
      {errors.length > 0 && (
        <div className="rounded-lg border border-red-500/50 p-3">
          <p className="font-semibold text-red-500">API 오류 (오프라인 AI로 대체된 항목이 있음)</p>
          {errors.map((e, i) => <p key={i} className="break-all text-xs">{e}</p>)}
        </div>
      )}
    </div>
  );
};

export default MafiaTest;
