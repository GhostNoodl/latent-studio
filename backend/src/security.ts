import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.ts";

const COOKIE_NAME = "latent_session";
const TOKEN_PATH = join(config.dataDir, "access-token");
const AUTH_EXEMPT = new Set(["/api/auth/status", "/api/auth/session"]);
const attempts = new Map<string, { count: number; resetAt: number }>();

function loadPairingToken(): string {
  const configured = config.accessToken.trim();
  if (configured) return configured;

  if (existsSync(TOKEN_PATH)) {
    const saved = readFileSync(TOKEN_PATH, "utf8").trim();
    if (saved.length >= 24) return saved;
  }

  mkdirSync(config.dataDir, { recursive: true });
  const generated = randomBytes(32).toString("base64url");
  writeFileSync(TOKEN_PATH, `${generated}\n`, { encoding: "utf8", mode: 0o600 });
  return generated;
}

const pairingToken = loadPairingToken();
const sessionToken = createHmac("sha256", pairingToken)
  .update("latent-browser-session-v1")
  .digest("base64url");

function safeEqual(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookies(req: FastifyRequest): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of (req.headers.cookie ?? "").split(";")) {
    const index = pair.indexOf("=");
    if (index < 0) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

export function isLoopbackAddress(address: string | undefined): boolean {
  const value = (address ?? "").toLowerCase();
  return (
    value === "::1" ||
    value === "0:0:0:0:0:0:0:1" ||
    value.startsWith("127.") ||
    value.startsWith("::ffff:127.")
  );
}

function normalizedHost(value: string): string {
  const host = value.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || isLoopbackAddress(host)) return "loopback";
  return host;
}

/** Reject browser requests made by another site, including localhost CSRF. */
function hasTrustedOrigin(req: FastifyRequest): boolean {
  const raw = req.headers.origin;
  if (!raw) return true; // native clients and same-origin navigations do not always send Origin
  try {
    const origin = new URL(raw);
    const request = new URL(`http://${req.headers.host ?? ""}`);
    if (normalizedHost(origin.hostname) !== normalizedHost(request.hostname)) return false;

    // The Vite development server proxies API and websocket traffic from 5173.
    // Production requests must otherwise come from the app's own effective port.
    return origin.port === request.port || origin.port === "5173";
  } catch {
    return false;
  }
}

function isAuthenticated(req: FastifyRequest): boolean {
  if (isLoopbackAddress(req.ip)) return true;
  const header = req.headers["x-access-token"];
  const rawHeader = Array.isArray(header) ? header[0] : header;
  return safeEqual(rawHeader, pairingToken) || safeEqual(cookies(req)[COOKIE_NAME], sessionToken);
}

function isProtectedPath(url: string): boolean {
  const path = url.split("?", 1)[0] ?? url;
  return path.startsWith("/api") || path.startsWith("/ws") || path.startsWith("/outputs");
}

function sessionCookie(req: FastifyRequest, value: string, maxAge: number): string {
  const secure = req.protocol === "https" ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

function mayAttempt(ip: string): boolean {
  const now = Date.now();
  const current = attempts.get(ip);
  if (!current || current.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  current.count += 1;
  return current.count <= 5;
}

export function getPairingTokenPath(): string {
  return TOKEN_PATH;
}

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req, reply) => {
    if (!isProtectedPath(req.url)) return;
    if (!hasTrustedOrigin(req)) {
      return reply.code(403).send({ error: "Cross-origin requests are not allowed" });
    }

    const path = req.url.split("?", 1)[0] ?? req.url;
    if (AUTH_EXEMPT.has(path) || isAuthenticated(req)) return;
    return reply.code(401).send({ error: "Authentication required" });
  });

  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    if (req.url.startsWith("/api/auth")) reply.header("cache-control", "no-store");
    return payload;
  });

  app.get("/api/auth/status", async (req) => ({
    authenticated: isAuthenticated(req),
    loopback: isLoopbackAddress(req.ip),
  }));

  app.post("/api/auth/session", async (req, reply) => {
    if (!mayAttempt(req.ip)) return reply.code(429).send({ error: "Too many pairing attempts" });
    const token = (req.body as { token?: unknown } | null)?.token;
    if (typeof token !== "string" || !safeEqual(token.trim(), pairingToken)) {
      return reply.code(401).send({ error: "Invalid pairing token" });
    }
    attempts.delete(req.ip);
    reply.header("set-cookie", sessionCookie(req, sessionToken, 30 * 24 * 60 * 60));
    return { ok: true };
  });

  app.delete("/api/auth/session", async (req, reply) => {
    reply.header("set-cookie", sessionCookie(req, "", 0));
    return { ok: true };
  });

  // This route remains inaccessible remotely until a session is established.
  app.get("/api/auth/pairing", async () => ({ token: pairingToken, path: TOKEN_PATH }));
}
