import { describe, expect, it } from "vitest";
import { resolveBackendApiBaseUrl } from "./config";

describe("resolveBackendApiBaseUrl", () => {
  it("uses the local backend when configuration is absent or blank", () => {
    expect(resolveBackendApiBaseUrl(undefined)).toBe("http://localhost:5080");
    expect(resolveBackendApiBaseUrl("   ")).toBe("http://localhost:5080");
  });

  it("preserves a configured URL without a trailing slash", () => {
    expect(resolveBackendApiBaseUrl("https://api.example.test")).toBe(
      "https://api.example.test",
    );
  });

  it("trims whitespace and trailing slashes", () => {
    expect(resolveBackendApiBaseUrl("  https://api.example.test///  ")).toBe(
      "https://api.example.test",
    );
  });
});