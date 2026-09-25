import { StrictMode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendStatus } from "./backend-status";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

const successfulResponse = { ok: true, status: 204 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BackendStatus", () => {
  it("shows an accessible loading state while the initial request is pending", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

    render(<BackendStatus />);

    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByText("Checking backend availability…"),
    ).toBeInTheDocument();
  });

  it("shows that the backend is available for a successful response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successfulResponse));

    render(<BackendStatus />);

    expect(await screen.findByText("Backend is available.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "false");
  });

  it("shows an unavailable state for a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    render(<BackendStatus />);

    expect(
      await screen.findByText("Backend is unavailable."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  it("shows an unavailable state for a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );

    render(<BackendStatus />);

    expect(
      await screen.findByText("Backend is unavailable."),
    ).toBeInTheDocument();
  });

  it("disables retry while pending and can recover to available", async () => {
    const retryRequest = deferred<typeof successfulResponse>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockReturnValueOnce(retryRequest.promise);
    vi.stubGlobal("fetch", fetchMock);

    render(<BackendStatus />);

    const retryButton = await screen.findByRole("button", { name: "Retry" });
    fireEvent.click(retryButton);

    expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      retryRequest.resolve(successfulResponse);
      await retryRequest.promise;
    });

    expect(await screen.findByText("Backend is available.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not let a stale request replace the newest result", async () => {
    const firstRequest = deferred<{ ok: boolean; status: number }>();
    const secondRequest = deferred<{ ok: boolean; status: number }>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StrictMode>
        <BackendStatus />
      </StrictMode>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      secondRequest.resolve(successfulResponse);
      await secondRequest.promise;
    });
    expect(await screen.findByText("Backend is available.")).toBeInTheDocument();

    await act(async () => {
      firstRequest.resolve({ ok: false, status: 503 });
      await firstRequest.promise;
    });
    expect(screen.getByText("Backend is available.")).toBeInTheDocument();
  });
});