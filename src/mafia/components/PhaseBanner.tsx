import { useEffect, useState } from "react";
import type { Phase } from "../types";

const COPY: Partial<Record<Phase, (day: number) => [string, string]>> = {
  night: (d) => [`${d}일차 밤`, "마을에 어둠이 내립니다"],
  day: (d) => [`${d}일차 낮`, "토론을 시작합니다"],
  vote: () => ["투표", "가장 의심되는 사람을 고르세요"],
  trial: () => ["최후의 변론", "그의 운명이 결정됩니다"],
};

/** 단계가 바뀔 때 잠깐 화면 가운데에 나오는 만화 컷 같은 전환 연출 */
export function PhaseBanner({ phase, day }: { phase: Phase; day: number }) {
  const [copy, setCopy] = useState<[string, string] | null>(null);
  useEffect(() => {
    const make = COPY[phase];
    if (!make) return;
    setCopy(make(day));
    const t = setTimeout(() => setCopy(null), 1600);
    return () => clearTimeout(t);
  }, [phase, day]);
  if (!copy) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-black/65 animate-[banner_1.6s_ease-in-out_forwards]" aria-live="polite">
      <div className="-skew-x-6 border-y-4 border-black bg-[#b3191f] px-10 py-5 text-center shadow-[8px_8px_0_0_#000]">
        <p className="text-4xl font-black tracking-[0.2em] text-[#f4efe6] sm:text-6xl">{copy[0]}</p>
        <p className="mt-1 text-sm font-bold tracking-widest text-[#f4efe6]/80">{copy[1]}</p>
      </div>
    </div>
  );
}
