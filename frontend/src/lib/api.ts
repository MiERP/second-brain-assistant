export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8088";

export function authHeaders(): HeadersInit {
  if (typeof window === "undefined") return {};
  const token = window.localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const tokenHeaders = authHeaders();
  Object.entries(tokenHeaders).forEach(([key, value]) => {
    if (typeof value === "string" && !headers.has(key)) {
      headers.set(key, value);
    }
  });
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event("auth-required"));
  }
  return response;
}
