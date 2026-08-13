import assert from "node:assert/strict";
import { test } from "node:test";
import {
  configureTailscaleServe,
  detectTailscale,
  parseTailscaleStatus,
  tailscaleAutoEnabled,
} from "../scripts/tailscale.mjs";

const connectedStatus = {
  BackendState: "Running",
  Self: { Online: true, DNSName: "studio.example.ts.net.", UserID: 42 },
  User: { "42": { LoginName: "Owner@Example.com" } },
};

test("Tailscale status becomes a stable HTTPS URL and normalized owner identity", () => {
  assert.deepEqual(parseTailscaleStatus(connectedStatus), {
    available: true,
    dnsName: "studio.example.ts.net",
    login: "owner@example.com",
    url: "https://studio.example.ts.net",
  });
});

test("Tailscale auto mode can be explicitly disabled", () => {
  for (const value of ["0", "false", "OFF", "disabled"]) {
    assert.equal(tailscaleAutoEnabled(value), false);
  }
  assert.equal(tailscaleAutoEnabled(undefined), true);
  assert.equal(tailscaleAutoEnabled("auto"), true);
});

test("launcher configures a background Serve mapping when Tailscale is ready", async () => {
  const calls: string[][] = [];
  const result = await configureTailscaleServe(4000, {
    run: async (args: string[]) => {
      calls.push(args);
      return args[0] === "status" ? JSON.stringify(connectedStatus) : "";
    },
  });

  assert.equal(result.enabled, true);
  assert.equal(result.url, "https://studio.example.ts.net");
  assert.deepEqual(calls, [
    ["status", "--json"],
    ["serve", "--bg", "--yes", "4000"],
  ]);
});

test("launcher degrades cleanly when Tailscale is absent or disconnected", async () => {
  const absent = await detectTailscale({
    run: async () => {
      throw new Error("not found");
    },
  });
  assert.equal(absent.available, false);

  const disconnected = await configureTailscaleServe(4000, {
    run: async () => JSON.stringify({ BackendState: "Stopped" }),
  });
  assert.equal(disconnected.enabled, false);
  assert.match(disconnected.reason, /not connected/i);
});
