import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SkillPortfolioCard from "@/components/portfolio/SkillPortfolioCard";
import { sessionsApi } from "@/services/sessions";
import { vacanciesApi } from "@/services/vacancies";
import { portfoliosApi } from "@/services/portfolios";
import { usePolling } from "@/hooks/usePolling";
import { LEVEL_LABELS } from "@/utils/constants";
import { ArrowLeft, Download, Loader2, RefreshCw, Zap, FileText, AlertCircle } from "lucide-react";
import type { Portfolio, AssessorOverride, Vacancy } from "@/types";

const MAX_PORTFOLIO_POLL_ATTEMPTS = 36; // 36 * 5s = 3 minutes

export default function PortfolioPage() {
  const { id, sessionId } = useParams<{ id: string; sessionId: string }>();
  const navigate = useNavigate();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [generating, setGenerating] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [overrides, setOverrides] = useState<Record<number, AssessorOverride>>({});
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [selectedVacancy, setSelectedVacancy] = useState<string>("");
  const [exporting, setExporting] = useState<"pdf" | "json" | null>(null);
  const [candidateName, setCandidateName] = useState<string | null>(null);
  const pollCountRef = useRef(0);

  const fetchPortfolio = useCallback(async () => {
    const res = await sessionsApi.getPortfolio(Number(sessionId));
    const data = res.data as any;
    if (
      data.status === "pending" ||
      data.status === "generating" ||
      data.portfolio?.generation_status === "generating" ||
      data.portfolio?.generation_status === "pending"
    ) {
      pollCountRef.current += 1;
      if (pollCountRef.current >= MAX_PORTFOLIO_POLL_ATTEMPTS) {
        setGenerating(false);
        setPollTimedOut(true);
      } else {
        setGenerating(true);
      }
    } else if (data.portfolio) {
      setPortfolio(data.portfolio);
      setGenerating(false);
      setPollTimedOut(false);
      pollCountRef.current = 0;
      const overrideMap: Record<number, AssessorOverride> = {};
      (data.portfolio.overrides ?? []).forEach((o: AssessorOverride) => {
        overrideMap[o.portfolio_skill_id] = o;
      });
      setOverrides(overrideMap);
    }
  }, [sessionId]);

  useEffect(() => {
    Promise.all([fetchPortfolio(), vacanciesApi.list(), sessionsApi.get(Number(sessionId))])
      .then(([, vRes, sRes]) => {
        setVacancies(vRes.data.vacancies);
        setCandidateName(sRes.data.session.candidate_name ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [fetchPortfolio, sessionId]);

  // Poll while generating
  usePolling(fetchPortfolio, 5000, generating);

  const handleOverrideSaved = (skillId: number, override: AssessorOverride) => {
    setOverrides((prev) => ({ ...prev, [skillId]: override }));
  };

  const handleRunFitGap = () => {
    if (!selectedVacancy || !portfolio) return;
    navigate(`/assessments/${id}/sessions/${sessionId}/fitgap/${selectedVacancy}`);
  };

  const handleRetryGeneration = async () => {
    pollCountRef.current = 0;
    setPollTimedOut(false);
    await sessionsApi.regeneratePortfolio(Number(sessionId));
    setGenerating(true);
  };

  const handleExport = async (format: "pdf" | "json") => {
    if (!portfolio) return;
    setExporting(format);
    try {
      const res = await portfoliosApi.exportPortfolio(
        portfolio.id,
        format,
        selectedVacancy ? Number(selectedVacancy) : undefined
      );
      if (format === "json") {
        const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `portfolio-${sessionId}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const blob = new Blob([res.data as BlobPart], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `portfolio-${sessionId}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const configuredAssessed = portfolio?.skills.filter((s) => !s.is_discovered) ?? [];
  const discoveredAssessed = portfolio?.skills.filter((s) => s.is_discovered) ?? [];
  const unassessedSkills = portfolio?.unassessed_skills ?? [];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link to={`/assessments/${id}/invite`} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold">Portfolio Results</h1>
            {(candidateName || portfolio?.candidate_name) && (
              <p className="text-sm text-muted-foreground">
                {candidateName || portfolio?.candidate_name}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <Link
            to={`/assessments/${id}/sessions/${sessionId}/transcript`}
            className="inline-flex items-center gap-1 text-sm border rounded-md px-3 py-1.5 hover:bg-accent transition-colors"
          >
            <FileText className="h-3.5 w-3.5" />
            Transcript
          </Link>
          {!generating && portfolio?.generation_status === "complete" && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport("pdf")}
                disabled={!!exporting}
              >
                {exporting === "pdf" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5 mr-1" />
                )}
                PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport("json")}
                disabled={!!exporting}
              >
                {exporting === "json" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5 mr-1" />
                )}
                JSON
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Generating state */}
      {generating && (
        <div className="border rounded-lg p-12 text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <div>
            <p className="font-medium">Generating portfolio...</p>
            <p className="text-sm text-muted-foreground mt-1">
              The AI is analyzing the interview transcript. This takes up to 2 minutes.
            </p>
          </div>
        </div>
      )}

      {/* Failed or timed-out state */}
      {!generating && (portfolio?.generation_status === "failed" || pollTimedOut) && (
        <div className="border border-destructive/40 bg-destructive/5 rounded-lg p-6 text-center space-y-3">
          <p className="text-sm font-medium text-destructive">
            {pollTimedOut
              ? "Portfolio generation is taking longer than expected."
              : "Portfolio generation failed."}
          </p>
          {portfolio?.generation_error && (
            <p className="text-xs text-muted-foreground max-w-md mx-auto break-words">
              {portfolio.generation_error}
            </p>
          )}
          <Button variant="outline" size="sm" onClick={handleRetryGeneration}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry Generation
          </Button>
        </div>
      )}

      {/* Ready state */}
      {!generating && portfolio?.generation_status === "complete" && (
        <>
          {/* Configured skills */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">
              Assessed Skills ({configuredAssessed.length})
            </h2>
            {configuredAssessed.length === 0 ? (
              <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
                No configured skills had sufficient transcript evidence to be rated during this session.
              </div>
            ) : (
              configuredAssessed.map((skill) => (
                <SkillPortfolioCard
                  key={skill.id}
                  skill={skill}
                  override={overrides[skill.id]}
                  onOverrideSaved={(o) => handleOverrideSaved(skill.id, o)}
                />
              ))
            )}
          </div>

          {/* Unassessed skills (never probed before interview ended) */}
          {unassessedSkills.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold flex items-center gap-1.5 text-muted-foreground">
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                    Unassessed Skills ({unassessedSkills.length})
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    These configured skills were not probed before the session ended and are excluded from L1–L5 scoring so the candidate is not unfairly penalized.
                  </p>
                </div>
                <Card className="bg-muted/30">
                  <CardContent className="p-3 divide-y">
                    {unassessedSkills.map((us) => (
                      <div
                        key={us.skill_id ?? us.skill_label}
                        className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-2 text-sm"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">{us.skill_label}</span>
                          {us.skill_id && (
                            <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                              {us.skill_id}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground">
                            Expected {LEVEL_LABELS[us.expected_level] ?? `L${us.expected_level}`}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">
                            Not Assessed
                          </span>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </>
          )}

          {/* Discovered skills */}
          {discoveredAssessed.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold flex items-center gap-1.5">
                    <Zap className="h-4 w-4 text-amber-500" />
                    Discovered Skills ({discoveredAssessed.length})
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Skills the AI probed that were not in the original assessment
                  </p>
                </div>
                {discoveredAssessed.map((skill) => (
                  <SkillPortfolioCard
                    key={skill.id}
                    skill={skill}
                    override={overrides[skill.id]}
                    onOverrideSaved={(o) => handleOverrideSaved(skill.id, o)}
                  />
                ))}
              </div>
            </>
          )}

          <Separator />

          {/* Fit/Gap */}
          <div className="flex flex-wrap items-center gap-3">
            <Select value={selectedVacancy} onValueChange={setSelectedVacancy}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Choose vacancy..." />
              </SelectTrigger>
              <SelectContent>
                {vacancies.map((v) => (
                  <SelectItem key={v.id} value={String(v.id)}>
                    {v.role_title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleRunFitGap} disabled={!selectedVacancy}>
              Run Fit/Gap Analysis →
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
