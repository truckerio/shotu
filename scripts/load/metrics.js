function percentile(sorted, value) {
  if (!sorted.length) return 0;
  const index = Math.max(0, Math.ceil((value / 100) * sorted.length) - 1);
  return sorted[index];
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

export class Metrics {
  #samples = [];

  record(sample) {
    this.#samples.push(sample);
  }

  get size() {
    return this.#samples.length;
  }

  summarize(durationMs) {
    const grouped = new Map();
    for (const sample of this.#samples) {
      const key = `${sample.role} ${sample.label}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(sample);
    }
    const summarizeSamples = (samples, name) => {
      const durations = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
      const errors = samples.filter((sample) => !sample.ok).length;
      return {
        name,
        requests: samples.length,
        errors,
        errorRate: samples.length ? errors / samples.length : 0,
        requestsPerSecond: durationMs > 0 ? samples.length / (durationMs / 1000) : 0,
        p50Ms: percentile(durations, 50),
        p95Ms: percentile(durations, 95),
        p99Ms: percentile(durations, 99),
        maxMs: durations.at(-1) || 0,
      };
    };
    return {
      overall: summarizeSamples(this.#samples, "overall"),
      routes: [...grouped].map(([name, samples]) => summarizeSamples(samples, name)),
    };
  }
}

export function displaySummary(summary) {
  const rows = [summary.overall, ...summary.routes].map((item) => ({
    scope: item.name,
    requests: item.requests,
    "req/s": round(item.requestsPerSecond),
    errors: item.errors,
    "error %": round(item.errorRate * 100, 3),
    "p50 ms": round(item.p50Ms),
    "p95 ms": round(item.p95Ms),
    "p99 ms": round(item.p99Ms),
    "max ms": round(item.maxMs),
  }));
  console.table(rows);
}

export function evaluateThresholds(summary, thresholds) {
  const failures = [];
  const overall = summary.overall;
  if (overall.requests === 0) failures.push("No measured requests completed.");
  if (overall.p95Ms > thresholds.p95Ms) {
    failures.push(`p95 ${round(overall.p95Ms)}ms exceeded ${thresholds.p95Ms}ms.`);
  }
  if (overall.p99Ms > thresholds.p99Ms) {
    failures.push(`p99 ${round(overall.p99Ms)}ms exceeded ${thresholds.p99Ms}ms.`);
  }
  if (overall.errorRate > thresholds.errorRate) {
    failures.push(
      `error rate ${round(overall.errorRate * 100, 3)}% exceeded ${round(thresholds.errorRate * 100, 3)}%.`,
    );
  }
  if (overall.requestsPerSecond < thresholds.minRequestsPerSecond) {
    failures.push(
      `throughput ${round(overall.requestsPerSecond)} req/s was below ${thresholds.minRequestsPerSecond} req/s.`,
    );
  }
  for (const route of summary.routes) {
    const label = route.name.replace(/^[^ ]+ /, "");
    const budget = thresholds.endpointP95Ms?.[label];
    if (budget !== undefined && route.p95Ms > budget) {
      failures.push(`${route.name} p95 ${round(route.p95Ms)}ms exceeded ${budget}ms.`);
    }
  }
  return failures;
}
