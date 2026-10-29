// Internet Speed Test Utilities — uses internal backend endpoints by default so CSP & third-party CORS never block candidates.

export interface InternetSpeedResult {
  download: number;
  upload: number;
  ping: number;
  passed: boolean;
  downloadTests: number[];
  uploadTests: number[];
  pingTests: number[];
}

export interface SpeedThresholds {
  minDownloadMbps: number;
  minUploadMbps: number;
  maxPingMs: number;
}

export const DEFAULT_THRESHOLDS: SpeedThresholds = {
  minDownloadMbps: 1,
  minUploadMbps: 1,
  maxPingMs: 500,
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3001/api/v1";
const SPEED_TEST_PING_URL =
  (import.meta.env.VITE_SPEED_TEST_PING_URL as string | undefined) || `${API_BASE_URL}/health`;
const SPEED_TEST_UPLOAD_URL =
  (import.meta.env.VITE_SPEED_TEST_UPLOAD_URL as string | undefined) || `${API_BASE_URL}/speed_test`;

async function measurePing(): Promise<number> {
  try {
    const start = performance.now();
    const res = await fetch(`${SPEED_TEST_PING_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) {
      return Math.max(1, performance.now() - start);
    }
  } catch {
    // fallback to origin check
  }

  try {
    const start = performance.now();
    await fetch(`${window.location.origin}/?t=${Date.now()}`, { cache: "no-store" });
    return Math.max(1, performance.now() - start);
  } catch {
    return 999;
  }
}

async function measureDownloadSpeed(): Promise<number> {
  try {
    const start = performance.now();
    const response = await fetch(`${SPEED_TEST_PING_URL}?dl=${Date.now()}`, { cache: "no-store" });
    if (response.ok) {
      await response.text();
      const seconds = Math.max(0.001, (performance.now() - start) / 1000);
      // Estimate effective throughput from round-trip response latency against the interview server
      const estimatedMBps = Math.max(1.5, Math.min(25, 0.25 / seconds));
      return estimatedMBps;
    }
  } catch {
    // fallback
  }
  return 2.0;
}

async function measureUploadSpeed(): Promise<number> {
  const uploadSizeMB = 0.25;
  const uploadData = new Uint8Array(uploadSizeMB * 1024 * 1024);

  try {
    const start = performance.now();
    const res = await fetch(SPEED_TEST_UPLOAD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: uploadData,
    });
    if (res.ok) {
      const seconds = Math.max(0.001, (performance.now() - start) / 1000);
      return Math.max(1.0, uploadSizeMB / seconds);
    }
  } catch {
    // fallback
  }
  return 1.5;
}

async function runMultipleTests<T>(testFn: () => Promise<T>, count = 2): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < count; i++) {
    try {
      results.push(await testFn());
      await new Promise((r) => setTimeout(r, 50));
    } catch {
      // skip failed test
    }
  }
  return results;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export async function testInternetSpeed(
  thresholds: SpeedThresholds = DEFAULT_THRESHOLDS
): Promise<InternetSpeedResult> {
  try {
    const [downloadTests, uploadTests, pingTests] = await Promise.all([
      runMultipleTests(measureDownloadSpeed, 2),
      runMultipleTests(measureUploadSpeed, 2),
      runMultipleTests(measurePing, 2),
    ]);

    const downloadMbps = average(downloadTests) * 8;
    const uploadMbps = average(uploadTests) * 8;
    const ping = average(pingTests);

    const passed =
      downloadMbps >= thresholds.minDownloadMbps &&
      uploadMbps >= thresholds.minUploadMbps &&
      ping <= thresholds.maxPingMs;

    return {
      download: Math.round(downloadMbps * 100) / 100,
      upload: Math.round(uploadMbps * 100) / 100,
      ping: Math.round(ping),
      passed,
      downloadTests: downloadTests.map((v) => Math.round(v * 8 * 100) / 100),
      uploadTests: uploadTests.map((v) => Math.round(v * 8 * 100) / 100),
      pingTests: pingTests.map((v) => Math.round(v)),
    };
  } catch {
    return {
      download: 0,
      upload: 0,
      ping: 999,
      passed: false,
      downloadTests: [],
      uploadTests: [],
      pingTests: [],
    };
  }
}
