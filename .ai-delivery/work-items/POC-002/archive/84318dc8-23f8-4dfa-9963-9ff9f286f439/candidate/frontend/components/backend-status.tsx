"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requestBackendHealth } from "../lib/api-client";

type Availability = "unknown" | "available" | "unavailable";

export function BackendStatus() {
  const [availability, setAvailability] =
    useState<Availability>("unknown");
  const [isLoading, setIsLoading] = useState(true);
  const attemptRef = useRef(0);

  const completeHealthCheck = useCallback(async (attempt: number) => {
    try {
      await requestBackendHealth();
      if (attempt === attemptRef.current) {
        setAvailability("available");
      }
    } catch {
      if (attempt === attemptRef.current) {
        setAvailability("unavailable");
      }
    } finally {
      if (attempt === attemptRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const retryHealthCheck = useCallback(() => {
    const attempt = ++attemptRef.current;
    setIsLoading(true);
    void completeHealthCheck(attempt);
  }, [completeHealthCheck]);

  useEffect(() => {
    const attempt = ++attemptRef.current;
    void completeHealthCheck(attempt);

    return () => {
      attemptRef.current += 1;
    };
  }, [completeHealthCheck]);

  let statusMessage = "Checking backend availability…";
  if (!isLoading && availability === "available") {
    statusMessage = "Backend is available.";
  } else if (!isLoading && availability === "unavailable") {
    statusMessage = "Backend is unavailable.";
  }

  return (
    <section className="status-card" aria-labelledby="backend-status-title">
      <div>
        <p className="eyebrow">Service connection</p>
        <h2 id="backend-status-title">Backend status</h2>
      </div>
      <div
        className={`status-indicator status-${availability}`}
        role="status"
        aria-live="polite"
        aria-busy={isLoading}
      >
        <span className="status-dot" aria-hidden="true" />
        <span>{statusMessage}</span>
      </div>
      {availability === "unavailable" ? (
        <button
          className="retry-button"
          type="button"
          onClick={retryHealthCheck}
          disabled={isLoading}
        >
          {isLoading ? "Retrying…" : "Retry"}
        </button>
      ) : null}
    </section>
  );
}