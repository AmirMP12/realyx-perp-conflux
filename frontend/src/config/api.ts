export function getApiBaseUrl(): string {
    const env = import.meta.env.VITE_API_URL;
    if (env && typeof env === "string" && env.trim()) return env.trim();
    if (import.meta.env.PROD) return "/api";
    return "http://localhost:3001/api";
}

export function getHealthBaseUrl(): string {
    const api = getApiBaseUrl();
    const base = api.replace(/\/api\/?$/, "");
    if (base === "" || api === "/api") return ""; // same-origin: fetch("/health")
    return base;
}
