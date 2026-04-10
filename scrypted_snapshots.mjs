/**
 * Scrypted Snapshot URL Apply Script
 *
 * Applies snapshot URLs to the existing Scrypted-managed cameras without
 * recreating devices. Run after a fresh Scrypted install once all cameras are
 * created and mixins are added, or any time you need to re-apply snapshot
 * settings.
 *
 * All go2rtc-backed cameras (Hipcam x8) use the go2rtc JPEG API for snapshots.
 * go2rtc maintains its own persistent connection and caches the latest frame
 * independently of Scrypted's FFmpeg pipeline, preventing the black flash in
 * HomeKit during prebuffer restarts.
 *
 * Reolink cameras use the direct camera HTTP snapshot API (not via go2rtc).
 *
 * Run via SSH:
 *   scp scrypted_snapshots.mjs sn@192.168.1.85:/tmp/
 *   ssh sn@192.168.1.85 'PATH=/opt/homebrew/opt/node@20/bin:$PATH REOLINK_PASSWORD=<pass> node /tmp/scrypted_snapshots.mjs'
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function findClientEntry() {
  const output = execFileSync(
    "find",
    [path.join(os.homedir(), ".npm", "_npx"), "-path", "*/@scrypted/client/dist/packages/client/src/index.js"],
    { encoding: "utf8" },
  ).trim();
  const [entry] = output.split("\n").filter(Boolean);
  if (!entry) throw new Error("Unable to locate @scrypted/client under ~/.npm/_npx.");
  return entry;
}

const { connectScryptedClient } = await import(findClientEntry());

function readLogin() {
  const loginPath = path.join(os.homedir(), ".scrypted", "login.json");
  const login = JSON.parse(fs.readFileSync(loginPath, "utf8"));
  const entry = login["127.0.0.1:10443"];
  if (!entry?.username || !entry?.token)
    throw new Error(`Missing 127.0.0.1:10443 credentials in ${loginPath}.`);
  return entry;
}

const REOLINK_PASSWORD = process.env.REOLINK_PASSWORD || "<reolink-password>";
const GO2RTC           = "http://127.0.0.1:1984";

// All Hipcam cameras — snapshot via go2rtc JPEG API (sub stream: always warm, Frigate pulls it continuously)
const GO2RTC_SNAPSHOTS = [
  { name: "Master Bathroom Camera 1", stream: "master_bathroom_camera_1_sub" },
  { name: "Master Bathroom Camera 2", stream: "master_bathroom_camera_2_sub" },
  { name: "Master Bedroom Camera 1",  stream: "master_bedroom_camera_1_sub"  },
  { name: "Hallway Camera 1",         stream: "hallway_camera_1_sub"         },
  { name: "Hallway Camera 2",         stream: "hallway_camera_2_sub"         },
  { name: "Kitchen Camera 1",         stream: "kitchen_camera_1_sub"         },
  { name: "Kitchen Camera 2",         stream: "kitchen_camera_2_sub"         },
  { name: "Office Camera",            stream: "office_camera_sub"            },
];

// Reolink cameras — direct camera HTTP snapshot API (not via go2rtc)
const REOLINK_SNAPSHOTS = [
  { name: "Garage Outside Camera",   ip: "192.168.5.84",  password: REOLINK_PASSWORD },
  { name: "Courtyard Doorbell",      ip: "192.168.5.141", password: REOLINK_PASSWORD },
  { name: "Backyard Doorbell",       ip: "192.168.5.74",  password: REOLINK_PASSWORD },
  { name: "Garage Outside Doorbell", ip: "192.168.5.163", password: REOLINK_PASSWORD },
];

async function main() {
  const entry = readLogin();
  console.log("Connecting to Scrypted at https://127.0.0.1:10443 ...");
  const sdk = await connectScryptedClient({
    baseUrl: "https://127.0.0.1:10443",
    pluginId: "@scrypted/core",
    username: entry.username,
    password: entry.token,
  });
  const sm = sdk.systemManager;
  console.log("Connected.\n");

  // ── go2rtc JPEG API — Hipcam cameras ─────────────────────────────────────
  console.log("=== Applying go2rtc JPEG snapshot URLs (Hipcam) ===");
  for (const cam of GO2RTC_SNAPSHOTS) {
    const device = sm.getDeviceByName(cam.name);
    if (!device) { console.log(`  ✗ ${cam.name} — not found`); continue; }
    const url = `${GO2RTC}/api/frame.jpeg?src=${cam.stream}`;
    try {
      await device.putSetting("snapshot:snapshotUrl", url);
      await device.putSetting("snapshot:snapshotsFromPrebuffer", "Disabled");
      console.log(`  ✓ ${cam.name}  →  ${url}`);
    } catch (e) {
      console.log(`  ✗ ${cam.name} — ${e.message}`);
    }
  }

  // ── Direct camera HTTP JPEG API — Reolink cameras ────────────────────────
  console.log("\n=== Applying direct camera HTTP snapshot URLs (Reolink) ===");
  for (const cam of REOLINK_SNAPSHOTS) {
    const device = sm.getDeviceByName(cam.name);
    if (!device) { console.log(`  ✗ ${cam.name} — not found`); continue; }
    const url = `http://${cam.ip}/cgi-bin/api.cgi?cmd=Snap&channel=0&user=admin&password=${encodeURIComponent(cam.password)}`;
    try {
      await device.putSetting("snapshot:snapshotUrl", url);
      await device.putSetting("snapshot:snapshotsFromPrebuffer", "Disabled");
      console.log(`  ✓ ${cam.name}`);
    } catch (e) {
      console.log(`  ✗ ${cam.name} — ${e.message}`);
    }
  }

  console.log("\n=== Done ===");
  sdk.disconnect();
  process.exit(0);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
