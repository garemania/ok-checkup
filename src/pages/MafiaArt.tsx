import { FaceArt, InkDefs } from "@/mafia/components/FaceArt";
import { AI_CHARS, HUMAN_CHAR } from "@/mafia/data";
import { EMOTIONS, EMOTION_LABEL } from "@/mafia/emotion";

/** 캐릭터 × 감정 전체 보기 (/mafia-art) */
const MafiaArt = () => (
  <div className="min-h-screen bg-background p-4">
    <InkDefs />
    <h1 className="mb-3 text-xl font-bold">캐릭터 표정 시트</h1>
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 text-center text-xs">
        <thead>
          <tr><th />{EMOTIONS.map((e) => <th key={e}>{EMOTION_LABEL[e]}</th>)}<th>사망</th></tr>
        </thead>
        <tbody>
          {[HUMAN_CHAR, ...AI_CHARS].map((c) => (
            <tr key={c.name}>
              <th className="pr-2 text-left">{c.name}</th>
              {[...EMOTIONS, "dead" as const].map((e) => (
                <td key={e}><FaceArt look={c.look} hue={c.color} emotion={e} size={104} rough /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export default MafiaArt;
