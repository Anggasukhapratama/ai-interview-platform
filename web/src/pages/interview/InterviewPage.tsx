import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import VoiceBars from "@/components/interview/VoiceBars";
import InterviewTimer from "@/components/interview/InterviewTimer";
import ConnectionStatus from "@/components/interview/ConnectionStatus";
import TranscriptBubble from "@/components/interview/TranscriptBubble";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import { useAudioWebSocket } from "@/hooks/useAudioWebSocket";
import { sessionsApi } from "@/services/sessions";
import HardwareCheck from "@/components/HardwareCheck";
import { CheckCircle, Mic, MicOff, ShieldCheck, AlertCircle, Loader2 } from "lucide-react";
import type { CandidateInfo, InterviewState, InterviewSpeaker, TranscriptTurn } from "@/types";

export default function InterviewPage() {
  const { token } = useParams<{ token: string }>();
  const [candidateInfo, setCandidateInfo] = useState<CandidateInfo | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [interviewState, setInterviewState] = useState<InterviewState>("idle");
  const [speaker, setSpeaker] = useState<InterviewSpeaker>(null);
  const [transcript, setTranscript] = useState<Pick<TranscriptTurn, "speaker" | "text">[]>([]);
  const [hardwareCheckDone, setHardwareCheckDone] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const [submittingConsent, setSubmittingConsent] = useState(false);
  const [connectionLostLong, setConnectionLostLong] = useState(false);
  const [reconnectedPrompt, setReconnectedPrompt] = useState(false);
  const reconnectedPromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionLostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const micMutedRef = useRef(false);

  // Fetch candidate info
  useEffect(() => {
    if (!token) {
      setInviteError("Missing interview invitation token.");
      setLoadingInfo(false);
      return;
    }
    setLoadingInfo(true);
    sessionsApi
      .getCandidateInfo(token)
      .then((res) => {
        setCandidateInfo(res.data);
        setSessionId(res.data.session_id);
        if (res.data.consent_given) {
          setConsentGiven(true);
          setConsentChecked(true);
        }
        if (res.data.session_status === "ended" || res.data.session_status === "failed") {
          setInterviewState("complete");
        }
      })
      .catch((err) => {
        const msg =
          err?.response?.data?.error ??
          "Invalid or expired interview link. Please contact your recruiter for a new invitation.";
        setInviteError(msg);
      })
      .finally(() => setLoadingInfo(false));
  }, [token]);

  const muteRef = useRef<(() => void) | null>(null);
  const unmuteRef = useRef<(() => void) | null>(null);

  const { playChunk, stop: stopPlayback, scheduleAfterPlayback, waitForDrain, cancelDrain } =
    useAudioPlayback();
  const audioCompleteCalledRef = useRef(false);
  const audioCompleteSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const callAudioComplete = useCallback(async () => {
    if (audioCompleteCalledRef.current || !token) return;
    audioCompleteCalledRef.current = true;
    cancelDrain();
    if (audioCompleteSafetyTimerRef.current) {
      clearTimeout(audioCompleteSafetyTimerRef.current);
      audioCompleteSafetyTimerRef.current = null;
    }
    const attempt = async (delay: number) => {
      try {
        await sessionsApi.audioComplete(token);
      } catch {
        setTimeout(() => attempt(Math.min(delay * 2, 8000)), delay);
      }
    };
    attempt(2000);
  }, [token, cancelDrain]);

  const handleStateChange = useCallback(
    (state: InterviewState) => {
      setInterviewState(state);

      if (state === "draining_audio") {
        muteRef.current?.();
        audioCompleteCalledRef.current = false;
        audioCompleteSafetyTimerRef.current = setTimeout(() => {
          callAudioComplete();
        }, 10_000);
        waitForDrain(() => callAudioComplete());
        return;
      }

      if (state === "reconnecting") {
        muteRef.current?.();
        connectionLostTimerRef.current = setTimeout(() => {
          setConnectionLostLong(true);
        }, 60_000);
      } else {
        if (connectionLostTimerRef.current) {
          clearTimeout(connectionLostTimerRef.current);
          connectionLostTimerRef.current = null;
        }
        setConnectionLostLong(false);
        if (state === "active" && !micMutedRef.current) unmuteRef.current?.();
      }
    },
    [callAudioComplete, waitForDrain]
  );

  const handleReconnected = useCallback(() => {
    if (reconnectedPromptTimerRef.current) clearTimeout(reconnectedPromptTimerRef.current);
    setReconnectedPrompt(true);
    reconnectedPromptTimerRef.current = setTimeout(() => setReconnectedPrompt(false), 10_000);
  }, []);

  const handleTranscript = useCallback((turn: Pick<TranscriptTurn, "speaker" | "text">) => {
    setTranscript((prev) => [...prev.slice(-19), turn]);
  }, []);

  const handleSpeakerChange = useCallback(
    (newSpeaker: InterviewSpeaker) => {
      if (newSpeaker === "ai") {
        setSpeaker("ai");
        muteRef.current?.();
      } else if (newSpeaker === "candidate") {
        scheduleAfterPlayback(() => {
          setSpeaker("candidate");
          if (!micMutedRef.current) unmuteRef.current?.();
        });
      }
    },
    [scheduleAfterPlayback]
  );

  const { connect, send, sendJson, disconnect, connectionState } = useAudioWebSocket({
    sessionId: sessionId ?? 0,
    token,
    onAudioChunk: playChunk,
    onTranscript: handleTranscript,
    onStateChange: handleStateChange,
    onSpeakerChange: handleSpeakerChange,
    onReconnected: handleReconnected,
  });

  const { start: startCapture, stop: stopCapture, mute, unmute } = useAudioCapture({
    onFrame: send,
  });

  muteRef.current = mute;
  unmuteRef.current = unmute;

  const toggleMic = useCallback(() => {
    if (micMutedRef.current) {
      micMutedRef.current = false;
      setMicMuted(false);
      unmute();
    } else {
      micMutedRef.current = true;
      setMicMuted(true);
      mute();
    }
  }, [mute, unmute]);

  const handleAcceptConsent = async () => {
    if (!token || !consentChecked) return;
    setSubmittingConsent(true);
    try {
      await sessionsApi.recordConsent(token, "UU-PDP-2022-v1");
      setConsentGiven(true);
    } catch {
      // Even if network hiccups, allow local progression if candidate explicitly consented
      setConsentGiven(true);
    } finally {
      setSubmittingConsent(false);
    }
  };

  const startInterview = useCallback(async () => {
    if (!sessionId) return;
    setInterviewState("connecting");
    connect();
    await startCapture();
    muteRef.current?.();
  }, [sessionId, connect, startCapture]);

  const endInterview = useCallback(
    async (reason: "manual_candidate" | "time_ceiling" = "manual_candidate") => {
      setInterviewState("ending");
      if (reconnectedPromptTimerRef.current) clearTimeout(reconnectedPromptTimerRef.current);
      stopCapture();
      stopPlayback();
      sendJson({ type: "end_session", reason });
      disconnect();
      setInterviewState("complete");
    },
    [stopCapture, stopPlayback, sendJson, disconnect]
  );

  const wsConnectionStatus =
    interviewState === "reconnecting"
      ? connectionLostLong
        ? "lost"
        : "reconnecting"
      : connectionState === "connected"
      ? "connected"
      : "reconnecting";

  if (loadingInfo) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
        <p className="text-sm text-muted-foreground">Loading interview session...</p>
      </div>
    );
  }

  if (inviteError) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-4">
        <AlertCircle className="h-10 w-10 text-destructive mx-auto" />
        <h2 className="text-xl font-semibold">Interview Unavailable</h2>
        <p className="text-sm text-muted-foreground">{inviteError}</p>
      </div>
    );
  }

  // ── State A: Pre-start (UU PDP Consent Gate + Hardware Check) ────────────
  if (interviewState === "idle") {
    return (
      <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-xl font-semibold">{candidateInfo?.role_title ?? "AI Interview"}</h1>
          {candidateInfo && (
            <p className="text-sm text-muted-foreground">
              {candidateInfo.candidate_name ? `Welcome, ${candidateInfo.candidate_name} · ` : ""}
              Up to {candidateInfo.time_limit_min} minutes
            </p>
          )}
        </div>

        {/* Step 1: UU PDP Explicit Informed Consent Gate */}
        {!consentGiven ? (
          <div className="rounded-lg border bg-card p-5 space-y-4 shadow-sm">
            <div className="flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h2 className="text-sm font-semibold">
                  Personal Data &amp; AI Assessment Notice (UU PDP No. 27/2022)
                </h2>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Before starting your voice interview, please review how your personal data is processed in accordance with Indonesia&apos;s Personal Data Protection Law (UU No. 27 Tahun 2022):
                </p>
              </div>
            </div>

            <div className="bg-muted/50 rounded-md p-3.5 text-xs space-y-2 text-muted-foreground leading-relaxed">
              <p>
                • <strong className="text-foreground">Voice &amp; Transcript Processing:</strong> Your microphone audio is streamed in real time to our AI interview engine (powered by Google Gemini) to conduct the conversation and generate a text transcript.
              </p>
              <p>
                • <strong className="text-foreground">Automated Competency Profiling &amp; Human Review:</strong> AI will generate an initial skill competency portfolio from your transcript quotes. Human assessors from the hiring organization have full authority to review the transcript and override any AI rating.
              </p>
              <p>
                • <strong className="text-foreground">Purpose &amp; Data Rights:</strong> Your data is used strictly for recruitment evaluation by the inviting organization and is isolated to this tenant. You may end the interview at any time.
              </p>
            </div>

            <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span className="text-xs text-foreground leading-snug">
                I have read and understood the privacy notice above, and I explicitly consent to the processing of my voice, interview transcript, and AI-assisted competency evaluation.
              </span>
            </label>

            <div className="flex justify-end pt-2">
              <Button
                size="sm"
                disabled={!consentChecked || submittingConsent}
                onClick={handleAcceptConsent}
              >
                {submittingConsent && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Continue to Hardware Check
              </Button>
            </div>
          </div>
        ) : !hardwareCheckDone ? (
          <div className="space-y-4">
            <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-1.5 text-muted-foreground">
              <p>• This is a voice interview. Make sure you&apos;re in a quiet place.</p>
              <p>• The AI will ask follow-up questions — there are no scripts.</p>
              <p>• The session will last up to {candidateInfo?.time_limit_min ?? "—"} minutes.</p>
              <p>• Your mic will be active throughout. You can end anytime.</p>
            </div>
            <HardwareCheck
              onStart={() => {
                setHardwareCheckDone(true);
                startInterview();
              }}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
              <CheckCircle className="h-4 w-4 shrink-0" />
              <span>Hardware checks passed. You&apos;re ready to start.</span>
            </div>
            <Button className="w-full" size="lg" onClick={startInterview}>
              <Mic className="h-4 w-4 mr-2" />
              Start Interview
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ── State F: Complete ───────────────────────────────────────────────────
  if (interviewState === "complete") {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-4">
        <div className="text-4xl">✅</div>
        <h2 className="text-xl font-semibold">Interview Complete</h2>
        <p className="text-sm text-muted-foreground">
          Thank you. The interview has been recorded.
          <br />
          The hiring team will review your results and follow up with you.
        </p>
      </div>
    );
  }

  // ── States B/C/D/E: Active interview ────────────────────────────────────
  const aiSpeaking = speaker === "ai";
  const candidateSpeaking = speaker === "candidate";

  return (
    <div className="max-w-xl mx-auto px-4 flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between py-3 border-b sticky top-12 bg-white z-10">
        <span className="text-sm font-medium">{candidateInfo?.role_title ?? "AI Interview"}</span>
        {candidateInfo && (
          <InterviewTimer
            totalSeconds={candidateInfo.time_limit_min * 60}
            startedAt={candidateInfo.started_at}
            running={interviewState === "active"}
            onExpired={() => endInterview("time_ceiling")}
          />
        )}
      </div>

      {/* Reconnecting banner */}
      {interviewState === "reconnecting" &&
        (connectionLostLong ? (
          <div className="flex items-center gap-2 text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-2.5 mt-2">
            <span className="animate-pulse">●</span>
            <span>
              Connection is taking too long to restore. Please wait, and contact the interviewer if this persists.
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg px-4 py-2.5 mt-2">
            <span className="animate-pulse">●</span>
            <span>Briefly reconnecting — please wait a moment.</span>
          </div>
        ))}

      {/* Reconnected prompt */}
      {reconnectedPrompt && (
        <div className="flex items-center justify-between text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-4 py-2.5 mt-2">
          <span>
            Reconnected — please say <strong>&quot;check&quot;</strong> or continue your answer to resume.
          </span>
          <button
            className="ml-3 text-blue-500 hover:text-blue-700 shrink-0"
            onClick={() => setReconnectedPrompt(false)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Voice indicator */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 py-8">
        {interviewState === "connecting" ? (
          <div className="text-sm text-muted-foreground animate-pulse">Connecting...</div>
        ) : interviewState === "draining_audio" ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <VoiceBars active={true} label="AI speaking" variant="ai" />
            <p className="text-xs text-muted-foreground">Wrapping up...</p>
          </div>
        ) : (
          <>
            <VoiceBars
              active={aiSpeaking}
              label={aiSpeaking ? "AI speaking" : "Listening..."}
              variant="ai"
            />

            {candidateSpeaking && (
              <VoiceBars active={true} label="You're speaking" variant="candidate" />
            )}

            {/* Transcript */}
            {transcript.length > 0 && (
              <div className="w-full space-y-2 overflow-y-auto max-h-[60vh]">
                {transcript.map((turn, i) => (
                  <TranscriptBubble key={i} speaker={turn.speaker} text={turn.text} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom bar */}
      <div className="border-t py-3 flex items-center justify-between gap-4 sticky bottom-0 bg-white">
        <ConnectionStatus state={wsConnectionStatus} />

        <div className="flex items-center gap-3">
          <Button
            variant={micMuted ? "destructive" : "outline"}
            size="sm"
            onClick={toggleMic}
          >
            {micMuted ? (
              <>
                <MicOff className="h-3.5 w-3.5 mr-1.5" /> Muted
              </>
            ) : (
              <>
                <Mic className="h-3.5 w-3.5 mr-1.5" /> Mic On
              </>
            )}
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                End Interview
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>End interview?</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to end the interview early? Any skills not yet discussed will be marked as Not Assessed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => endInterview("manual_candidate")}>
                  End interview
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {import.meta.env.DEV && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs opacity-50"
              onClick={() => sendJson({ type: "debug_force_reconnect" })}
            >
              ⚡ Force reconnect
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
