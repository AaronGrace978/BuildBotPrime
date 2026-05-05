export type ObservationSource = "terminal" | "filesystem" | "screenshot" | "ocr" | "ide-state";

export type ObservationSeverity = "info" | "warning" | "error" | "blocked";

export interface ObservationSignal {
  readonly source: ObservationSource;
  readonly severity: ObservationSeverity;
  readonly title: string;
  readonly detail: string;
  readonly timestamp: string;
}

export interface ObservationSummary {
  readonly highestSeverity: ObservationSeverity;
  readonly headline: string;
  readonly signals: readonly ObservationSignal[];
}

const severityRank: Record<ObservationSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  blocked: 3
};

export function createObservationSignal(
  source: ObservationSource,
  severity: ObservationSeverity,
  title: string,
  detail: string
): ObservationSignal {
  return {
    source,
    severity,
    title,
    detail,
    timestamp: new Date().toISOString()
  };
}

export function summarizeObservations(signals: readonly ObservationSignal[]): ObservationSummary {
  if (signals.length === 0) {
    return {
      highestSeverity: "info",
      headline: "No observations captured yet.",
      signals
    };
  }

  const highestSeverity = signals.reduce<ObservationSeverity>((highest, signal) => {
    return severityRank[signal.severity] > severityRank[highest] ? signal.severity : highest;
  }, "info");

  const headlineSignal = [...signals]
    .reverse()
    .find((signal) => signal.severity === highestSeverity);

  return {
    highestSeverity,
    headline: headlineSignal?.title ?? "Observation summary ready.",
    signals
  };
}

export function classifyLogLine(line: string): ObservationSeverity {
  const normalized = line.toLowerCase();

  if (normalized.includes("permission denied") || normalized.includes("login required")) {
    return "blocked";
  }

  if (normalized.includes("error") || normalized.includes("failed") || normalized.includes("exception")) {
    return "error";
  }

  if (normalized.includes("warning") || normalized.includes("deprecated")) {
    return "warning";
  }

  return "info";
}
