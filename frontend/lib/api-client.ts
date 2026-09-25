import { backendApiBaseUrl, resolveBackendApiBaseUrl } from "./config";

export class BackendHealthError extends Error {
  constructor(public readonly status: number) {
    super(`Backend health request failed with status ${status}.`);
    this.name = "BackendHealthError";
  }
}

export function createApiUrl(
  path: string,
  baseUrl: string = backendApiBaseUrl,
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${resolveBackendApiBaseUrl(baseUrl)}${normalizedPath}`;
}

export async function requestBackendHealth(): Promise<void> {
  const response = await fetch(createApiUrl("/health"), {
    method: "GET",
  });

  if (!response.ok) {
    throw new BackendHealthError(response.status);
  }
}