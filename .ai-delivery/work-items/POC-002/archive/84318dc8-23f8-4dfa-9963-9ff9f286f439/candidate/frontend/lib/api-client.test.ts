import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BackendHealthError,
  createApiUrl,
  requestBackendHealth,
} from "./api-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createApiUrl", () => {
  it("joins paths to base URLs with or without a trailing slash", () => {
    expect(createApiUrl("/health", "https://api.example.test/")).toBe(
      "https://api.example.test/health",
    );
    expect(createApiUrl("health", "https://api.example.test")).toBe(
      "https://api.example.test/health",
    );
  });
});

describe("requestBackendHealth", () => {
  it("issues a GET request and accepts any successful 2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestBackendHealth()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:5080/health", {
      method: "GET",
    });
  });

  it("throws a safe status error for a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );

    await expect(requestBackendHealth()).rejects.toEqual(
      new BackendHealthError(503),
    );
  });

  it("surfaces network failures to the caller", async () => {
    const failure = new TypeError("Network request failed");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));

    await expect(requestBackendHealth()).rejects.toBe(failure);
  });
});