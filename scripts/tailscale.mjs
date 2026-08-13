import { execFile } from "node:child_process";

const FALSE_VALUES = new Set(["0", "false", "off", "no", "disabled"]);

function command(args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(
      "tailscale",
      args,
      { encoding: "utf8", windowsHide: true, timeout },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

export function tailscaleAutoEnabled(value) {
  return !FALSE_VALUES.has(String(value ?? "auto").trim().toLowerCase());
}

/** Extract only the identity data Latent needs from `tailscale status --json`. */
export function parseTailscaleStatus(raw) {
  const status = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!status || status.BackendState !== "Running" || status.Self?.Online === false) {
    return { available: false, reason: "Tailscale is not connected" };
  }

  const dnsName = String(status.Self?.DNSName ?? "")
    .trim()
    .replace(/\.$/, "")
    .toLowerCase();
  const userId = String(status.Self?.UserID ?? "");
  const profile = status.User?.[userId];
  const login = String(profile?.LoginName ?? "").trim().toLowerCase();

  if (!dnsName) return { available: false, reason: "Tailscale MagicDNS is unavailable" };
  if (!login) return { available: false, reason: "Tailscale owner identity is unavailable" };

  return {
    available: true,
    dnsName,
    login,
    url: `https://${dnsName}`,
  };
}

export async function detectTailscale({ run = command } = {}) {
  try {
    return parseTailscaleStatus(await run(["status", "--json"], 8_000));
  } catch {
    return { available: false, reason: "Tailscale is not installed or not running" };
  }
}

/**
 * Publish a private HTTPS endpoint to this machine's tailnet. Tailscale Serve is
 * idempotent, so refreshing the mapping on every Latent launch also repairs it
 * after a Tailscale reset without asking the user for a command.
 */
export async function configureTailscaleServe(port, { run = command } = {}) {
  const detected = await detectTailscale({ run });
  if (!detected.available) return { enabled: false, ...detected };

  try {
    await run(["serve", "--bg", "--yes", String(port)], 120_000);
    return { enabled: true, ...detected };
  } catch {
    return {
      enabled: false,
      ...detected,
      reason: "Tailscale Serve could not be enabled (finish any Tailscale approval, then relaunch Latent)",
    };
  }
}
