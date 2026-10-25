import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import LevelBadge from "./LevelBadge";
import ConfidenceIndicator from "./ConfidenceIndicator";
import OverridePanel from "./OverridePanel";
import { Zap } from "lucide-react";
import { parseLevel, LEVEL_LABELS } from "@/utils/constants";
import type { PortfolioSkill, AssessorOverride } from "@/types";

interface SkillPortfolioCardProps {
  skill: PortfolioSkill;
  override?: AssessorOverride;
  onOverrideSaved: (override: AssessorOverride) => void;
}

const SUMMARY_TRUNCATE_LEN = 320;

export default function SkillPortfolioCard({
  skill,
  override,
  onOverrideSaved,
}: SkillPortfolioCardProps) {
  const [expanded, setExpanded] = useState(false);
  const aiNumericLevel = parseLevel(skill.ai_level);
  const effectiveLevel = override?.override_level ?? aiNumericLevel;
  const isLongSummary = (skill.competency_summary?.length ?? 0) > SUMMARY_TRUNCATE_LEN;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {/* Skill header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <LevelBadge level={effectiveLevel} />
            <div className="space-y-0.5 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold break-words">{skill.skill_label}</span>
                {skill.skill_id && (
                  <span className="text-[11px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    {skill.skill_id}
                  </span>
                )}
                {skill.is_discovered && (
                  <span className="flex items-center gap-0.5 text-xs text-amber-600">
                    <Zap className="h-3 w-3" /> Discovered
                  </span>
                )}
                {override && (
                  <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                    ✏ Overridden (AI: {LEVEL_LABELS[aiNumericLevel] ?? `L${aiNumericLevel}`})
                  </span>
                )}
              </div>
              <ConfidenceIndicator confidence={skill.ai_confidence} />
            </div>
          </div>
          <OverridePanel skill={skill} existingOverride={override} onSaved={onOverrideSaved} />
        </div>

        {/* Low confidence note */}
        {skill.ai_confidence?.toLowerCase() === "low" && (
          <div className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Only briefly explored. Confidence is low — warrants a dedicated session if this skill matters.
          </div>
        )}

        {/* Evidence */}
        {skill.evidence && skill.evidence.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Evidence from interview
            </span>
            <ul className="space-y-1">
              {skill.evidence.map((quote, i) => (
                <li key={i} className="text-sm text-foreground break-words">
                  • &ldquo;{quote}&rdquo;
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Competency summary */}
        {skill.competency_summary && (
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Competency summary
            </span>
            <p className="text-sm text-muted-foreground leading-relaxed break-words">
              {isLongSummary && !expanded
                ? `${skill.competency_summary.slice(0, SUMMARY_TRUNCATE_LEN)}...`
                : skill.competency_summary}
            </p>
            {isLongSummary && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-xs text-primary hover:underline font-medium"
              >
                {expanded ? "Show less" : "Read full summary"}
              </button>
            )}
          </div>
        )}

        {/* Assessor override note */}
        {override?.assessor_notes && (
          <div className="space-y-1 bg-muted/40 border rounded p-2.5">
            <span className="text-xs font-medium text-foreground uppercase tracking-wide">
              Assessor Override Justification
            </span>
            <p className="text-xs text-muted-foreground break-words">{override.assessor_notes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
