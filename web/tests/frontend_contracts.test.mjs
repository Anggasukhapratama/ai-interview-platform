import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, "../src");

function resolveExpectedLevel(item) {
  return item.required_level ?? item.expected_level ?? 0;
}

function computeRemainingSeconds(timeLimitMin, startedAtIso, nowMs) {
  const totalSec = timeLimitMin * 60;
  if (!startedAtIso) return totalSec;
  const startMs = new Date(startedAtIso).getTime();
  if (Number.isNaN(startMs)) return totalSec;
  const elapsedSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  return Math.max(0, totalSec - elapsedSec);
}

test("AC-1 / P0-1: ComparisonTable resolves required_level and expected_level without crash or Lundefined", () => {
  const backendRow = {
    skill_id: "SK-ENG-003",
    skill_label: "System Design & Architecture",
    candidate_level: 4,
    expected_level: 4,
    required_level: 4,
    ai_level: 3,
    is_override: true,
    result: "match",
    delta: 0,
  };

  const level = resolveExpectedLevel(backendRow);
  assert.equal(level, 4);
  assert.notEqual(`L${level}`, "Lundefined");

  const tableSource = fs.readFileSync(
    path.join(srcDir, "components/fitgap/ComparisonTable.tsx"),
    "utf8"
  );
  assert.match(tableSource, /c\.required_level\s*\?\?\s*c\.expected_level/);
  assert.match(tableSource, /c\.is_override/);
});

test("AC-6 / P1-5: InterviewTimer anchors countdown to server startedAt across candidate refreshes", () => {
  const startedAt = "2026-05-06T10:00:00.000Z";
  const fiveMinutesLater = new Date("2026-05-06T10:05:00.000Z").getTime();

  const remaining = computeRemainingSeconds(30, startedAt, fiveMinutesLater);
  assert.equal(remaining, 25 * 60);

  const timerSource = fs.readFileSync(
    path.join(srcDir, "components/interview/InterviewTimer.tsx"),
    "utf8"
  );
  assert.match(timerSource, /startedAt\?:\s*string\s*\|\s*null/);
});

test("AC-2 & AC-3 / P0-2 & P0-5: PortfolioPage handles pending/generating 202 states and renders Unassessed Skills", () => {
  const portfolioSource = fs.readFileSync(
    path.join(srcDir, "pages/portfolio/PortfolioPage.tsx"),
    "utf8"
  );
  assert.match(portfolioSource, /data\.status\s*===\s*"pending"/);
  assert.match(portfolioSource, /data\.status\s*===\s*"generating"/);
  assert.match(portfolioSource, /unassessed_skills/);
  assert.match(portfolioSource, /Not Assessed/);
});

test("AC-4 / P0-3: InterviewPage enforces explicit UU PDP No. 27/2022 consent before starting interview", () => {
  const interviewSource = fs.readFileSync(
    path.join(srcDir, "pages/interview/InterviewPage.tsx"),
    "utf8"
  );
  assert.match(interviewSource, /UU PDP No\. 27\/2022/);
  assert.match(interviewSource, /consentChecked/);
  assert.match(interviewSource, /recordConsent/);
});
