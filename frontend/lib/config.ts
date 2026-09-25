const LOCAL_BACKEND_API_BASE_URL = "http://localhost:5080";

export function resolveBackendApiBaseUrl(
  configuredValue: string | undefined = process.env.NEXT_PUBLIC_API_BASE_URL,
): string {
  const trimmedValue = configuredValue?.trim();

  if (!trimmedValue) {
    return LOCAL_BACKEND_API_BASE_URL;
  }

  return trimmedValue.replace(/\/+$/, "") || LOCAL_BACKEND_API_BASE_URL;
}

export const backendApiBaseUrl = resolveBackendApiBaseUrl();