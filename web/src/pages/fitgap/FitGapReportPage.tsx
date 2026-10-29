import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import ComparisonTable from "@/components/fitgap/ComparisonTable";
import { portfoliosApi } from "@/services/portfolios";
import { sessionsApi } from "@/services/sessions";
import { usePolling } from "@/hooks/usePolling";
import { LEVEL_LABELS, parseLevel } from "@/utils/constants";
import { ArrowLeft, Download, Loader2, RefreshCw, Zap, AlertTriangle } from "lucide-react";
import type { FitGapReport, Portfolio } from "@/types";

const MAX_POLL_ATTEMPTS = 24; // 24 * 5s = 2 minutes timeout guard

export default function FitGapReportPage() {
  const { id, sessionId, vacancyId } = useParams<{
    id: string;
    sessionId: string;
    vacancyId: string;
  }>();

  const [report, setReport] = useState<FitGapReport | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "json" | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  // Prevent infinite Sidekiq job storm: only auto-trigger POST /fitgap once per (portfolio, vacancy)
  const triggeredForKeyRef = useRef<string | null>(null);
  const pollAttemptsRef = useRef<number>(0);

  const fetchReport = useCallback(async () => {
    if (!portfolio || !vacancyId) return;
    const key = `${portfolio.id}:${vacancyId}`;

    try {
      const res = await portfoliosApi.getFitGap(portfolio.id, Number(vacancyId));
      setReport(res.data.report);
      setGenerating(false);
      setError(null);
      pollAttemptsRef.current = 0;
    } catch (e: any) {
      if (e?.response?.status === 404) {
        if (triggeredForKeyRef.current !== key) {
          triggeredForKeyRef.current = key;
          pollAttemptsRef.current = 0;
          try {
            const triggerRes = await portfoliosApi.triggerFitGap(portfolio.id, Number(vacancyId));
            const data = triggerRes.data as any;
            if (data?.report) {
              setReport(data.report);
              setGenerating(false);
            } else {
              setGenerating(true);
            }
          } catch (triggerErr: any) {
            setGenerating(false);
            setError(
              triggerErr?.response?.data?.error ??
                "Failed to trigger Fit/Gap report generation."
            );
          }
        } else {
          // Already triggered — we are polling while Sidekiq generates the report
          pollAttemptsRef.current += 1;
          if (pollAttemptsRef.current >= MAX_POLL_ATTEMPTS) {
            setGenerating(false);
            setError(
              "Fit/Gap report generation timed out. Please click Regenerate to try again."
            );
          }
        }
      } else {
        setGenerating(false);
        setError(e?.response?.data?.error ?? "Failed to load Fit/Gap report.");
      }
    }
  }, [portfolio, vacancyId]);

  useEffect(() => {
    sessionsApi
      .getPortfolio(Number(sessionId))
      .then(async (res) => {
        const data = res.data as any;
        if (data.portfolio) {
          setPortfolio(data.portfolio);
        } else {
          setError("Portfolio is still generating or unavailable.");
        }
      })
      .catch(() => {
        setError("Could not load candidate portfolio.");
      })
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    if (portfolio) fetchReport();
  }, [portfolio, fetchReport]);

  usePolling(fetchReport, 5000, generating && !!portfolio);

  const handleRegenerate = async () => {
    if (!portfolio) return;
    setRegenerating(true);
    setError(null);
    pollAttemptsRef.current = 0;
    triggeredForKeyRef.current = `${portfolio.id}:${vacancyId}`;
    try {
      await portfoliosApi.regenerateFitGap(portfolio.id, Number(vacancyId));
      setReport(null);
      setGenerating(true);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Failed to regenerate Fit/Gap report.");
    } finally {
      setRegenerating(false);
    }
  };

  const handleExport = async (format: "pdf" | "json") => {
    if (!portfolio) return;
    setExporting(format);
    try {
      const res = await portfoliosApi.exportPortfolio(portfolio.id, format, Number(vacancyId));
      const ext = format;
      const blob =
        format === "pdf"
          ? new Blob([res.data as BlobPart], { type: "application/pdf" })
          : new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fitgap-${sessionId}-${vacancyId}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link
              to={`/assessments/${id}/sessions/${sessionId}/portfolio`}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="text-lg font-semibold">Fit/Gap Report</h1>
          </div>
          {portfolio?.candidate_name && (
            <p className="text-xs text-muted-foreground pl-6">
              Candidate: <span className="font-medium text-foreground">{portfolio.candidate_name}</span>
            </p>
          )}
        </div>

        {portfolio && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRegenerate}
              disabled={regenerating || generating}
            >
              {regenerating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
              )}
              Regenerate
            </Button>
            {report && (
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
        )}
      </div>

      {/* Error state */}
      {error && !generating && (
        <div className="border border-destructive/40 bg-destructive/5 rounded-lg p-6 text-center space-y-3">
          <AlertTriangle className="h-6 w-6 text-destructive mx-auto" />
          <p className="text-sm text-destructive">{error}</p>
          {portfolio && (
            <Button variant="outline" size="sm" onClick={handleRegenerate}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry Generation
            </Button>
          )}
        </div>
      )}

      {/* Generating */}
      {generating && (
        <div className="border rounded-lg p-12 text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Generating fit/gap report...</p>
        </div>
      )}

      {/* Report ready */}
      {report && !generating && (
        <>
          {/* Skill comparison */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Skill Comparison</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <ComparisonTable comparisons={report.skill_comparisons} />
            </CardContent>
          </Card>

          <Separator />

          {/* Overall Hiring Recommendation */}
          {report.overall_narrative && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Overall Hiring Recommendation</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap break-words">
                  {report.overall_narrative}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Culture & competency */}
          {report.culture_narrative && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Culture &amp; Competency Fit</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap break-words">
                  {report.culture_narrative}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Discovered skills */}
          {portfolio && portfolio.skills.some((s) => s.is_discovered) && (
            <>
              <Separator />
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <Zap className="h-4 w-4 text-amber-500" />
                    Discovered Skills (not in vacancy requirements)
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2">
                  {portfolio.skills
                    .filter((s) => s.is_discovered)
                    .map((s) => {
                      const numericLevel = parseLevel(s.ai_level);
                      const levelLabel = LEVEL_LABELS[numericLevel] ?? `L${numericLevel}`;
                      return (
                        <div key={s.id} className="text-sm flex flex-wrap items-center gap-2">
                          <span className="font-medium">{s.skill_label}</span>
                          <span className="text-xs font-medium bg-muted px-2 py-0.5 rounded">
                            {levelLabel} (
                            {s.ai_confidence?.toLowerCase() === "low" ? "low confidence" : "confirmed"}
                            )
                          </span>
                          <span className="text-xs text-muted-foreground">
                            — Not required for this role, may be additive.
                          </span>
                        </div>
                      );
                    })}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
