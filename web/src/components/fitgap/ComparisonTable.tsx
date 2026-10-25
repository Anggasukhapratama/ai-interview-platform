import { LEVEL_LABELS, FIT_GAP_RESULT_LABELS, FIT_GAP_RESULT_CLASSES } from "@/utils/constants";
import { cn } from "@/lib/utils";
import type { SkillComparison } from "@/types";

interface ComparisonTableProps {
  comparisons: SkillComparison[];
}

function ResultBadge({ comparison }: { comparison: SkillComparison }) {
  const label = FIT_GAP_RESULT_LABELS[comparison.result] ?? comparison.result;
  const classes = FIT_GAP_RESULT_CLASSES[comparison.result] ?? "bg-gray-100 text-gray-600";

  let icon = "";
  let suffix = "";
  if (comparison.result === "match") icon = "✅";
  else if (comparison.result === "exceed") {
    icon = "⭐";
    suffix = comparison.delta ? ` +${comparison.delta}` : "";
  } else if (comparison.result === "gap") {
    icon = "⚠";
    suffix = comparison.delta ? ` -${Math.abs(comparison.delta)}` : "";
  } else {
    icon = "—";
  }

  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded", classes)}>
      {icon} {label}
      {suffix}
    </span>
  );
}

export default function ComparisonTable({ comparisons }: ComparisonTableProps) {
  if (!comparisons || comparisons.length === 0) {
    return (
      <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
        No target skills are configured on this vacancy yet.
      </div>
    );
  }

  // Summary counts
  const matchCount = comparisons.filter((c) => c.result === "match").length;
  const gapCount = comparisons.filter((c) => c.result === "gap").length;
  const exceedCount = comparisons.filter((c) => c.result === "exceed").length;
  const notAssessedCount = comparisons.filter((c) => c.result === "not_assessed").length;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-4 py-2.5 font-medium">Skill</th>
              <th className="text-center px-4 py-2.5 font-medium">Required</th>
              <th className="text-center px-4 py-2.5 font-medium">Candidate</th>
              <th className="text-center px-4 py-2.5 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {comparisons.map((c, i) => {
              const requiredLevel = c.required_level ?? c.expected_level;
              return (
                <tr key={c.skill_id ?? `${c.skill_label}-${i}`} className="border-b last:border-0">
                  <td className="px-4 py-2.5 break-words max-w-[220px]">
                    <div className="font-medium">{c.skill_label}</div>
                    {c.skill_id && (
                      <div className="text-[11px] font-mono text-muted-foreground">{c.skill_id}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center text-muted-foreground font-medium">
                    {requiredLevel != null ? LEVEL_LABELS[requiredLevel] ?? `L${requiredLevel}` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {c.candidate_level != null ? (
                      <span className="inline-flex items-center justify-center gap-1 font-medium">
                        {LEVEL_LABELS[c.candidate_level] ?? `L${c.candidate_level}`}
                        {c.is_override && (
                          <span
                            className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-1 rounded"
                            title="Human override applied by assessor"
                          >
                            ✏ Override
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Not Assessed</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <ResultBadge comparison={c} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        {matchCount > 0 && (
          <span>
            ✅ Match: {matchCount} skill{matchCount !== 1 ? "s" : ""}
          </span>
        )}
        {gapCount > 0 && (
          <span>
            ⚠ Gap: {gapCount} skill{gapCount !== 1 ? "s" : ""}
          </span>
        )}
        {exceedCount > 0 && (
          <span>
            ⭐ Exceeds: {exceedCount} skill{exceedCount !== 1 ? "s" : ""}
          </span>
        )}
        {notAssessedCount > 0 && (
          <span>
            — Not Assessed: {notAssessedCount} skill{notAssessedCount !== 1 ? "s" : ""}
          </span>
        )}
        <span className="ml-auto">✏ = human override applied</span>
      </div>
    </div>
  );
}
