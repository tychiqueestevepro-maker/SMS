export function getApplicationOrigin(): string {
  const configuredUrl = process.env.APP_URL ?? "http://localhost:3000";

  try {
    const url = new URL(configuredUrl);
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
      throw new Error("APP_URL must use HTTPS outside local development.");
    }
    return url.origin;
  } catch {
    throw new Error("Riink application URL configuration is invalid.");
  }
}
