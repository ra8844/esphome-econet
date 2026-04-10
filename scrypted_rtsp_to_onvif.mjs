/**
 * Scrypted migration: RTSP cameras → ONVIF plugin (direct camera connection)
 *
 * Removes RTSP plugin devices for Hipcam cameras and recreates them in the
 * ONVIF plugin so Scrypted receives native ONVIF-T motion events for HKSV.
 *
 * go2rtc still handles the stream for Synology/other consumers — this only
 * changes how Scrypted connects to the camera.
 *
 * Run on the Mac Mini:
 *   scp scrypted_rtsp_to_onvif.mjs sn@192.168.1.85:/tmp/
 *   ssh sn@192.168.1.85 'PATH=/opt/homebrew/opt/node@20/bin:$PATH node /tmp/scrypted_rtsp_to_onvif.mjs'
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

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Hipcam cameras to move from RTSP → ONVIF
// Only include cameras where ONVIF port 8080 is reachable
// 192.168.5.174 (MB Cam 1) and 192.168.5.248 (Hallway 2) are currently offline
const CAMERAS = [
  { name: "Master Bathroom Camera 1", ip: "192.168.5.174", httpPort: "8080" },
  { name: "Master Bathroom Camera 2", ip: "192.168.5.142", httpPort: "8080" },
];

const SNAPSHOT_BASE = "http://admin:egypt1@";
const SNAPSHOT_PATH = "/cgi-bin/hi3510/snap.cgi?chn=0";

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

  const onvifPlugin = sm.getDeviceByName("ONVIF Camera Plugin");
  const rebroadcast = sm.getDeviceByName("Rebroadcast Plugin");
  const snapshot    = sm.getDeviceByName("Snapshot Plugin");
  const webrtc      = sm.getDeviceByName("WebRTC Plugin");
  const homekit     = sm.getDeviceByName("HomeKit");

  for (const [name, d] of [
    ["ONVIF Camera Plugin", onvifPlugin],
    ["Rebroadcast Plugin", rebroadcast],
    ["Snapshot Plugin", snapshot],
    ["WebRTC Plugin", webrtc],
    ["HomeKit", homekit],
  ]) {
    if (!d) throw new Error(`${name} not found — is the plugin installed?`);
  }

  console.log("=== Migrating RTSP cameras → ONVIF ===\n");

  for (const cam of CAMERAS) {
    console.log(`Processing: ${cam.name} (${cam.ip})`);

    // 1. Remove existing RTSP device
    const existing = sm.getDeviceByName(cam.name);
    if (existing) {
      console.log(`  Removing existing device id=${existing.id} ...`);
      await sm.removeDevice(existing.id);
      await sleep(2000);
    }

    // 2. Create new ONVIF device
    console.log(`  Creating ONVIF device ...`);
    let id;
    try {
      id = await onvifPlugin.createDevice({
        name: cam.name,
        ip: cam.ip,
        username: "admin",
        password: "egypt1",
        httpPort: cam.httpPort,
        skipValidate: true,
      });
    } catch (e) {
      console.log(`  ✗ createDevice failed: ${e.message}`);
      continue;
    }
    await sleep(5000);

    const device = sm.getDeviceById(id);
    if (!device) {
      console.log(`  ✗ Device id=${id} not found after creation`);
      continue;
    }

    // 3. Apply mixins
    await device.setMixins([rebroadcast.id, webrtc.id, snapshot.id, homekit.id]);
    await sleep(2000);

    // 4. HomeKit standalone mode
    await device.putSetting("homekit:standalone", true);

    // 5. Snapshot URL (direct from camera)
    await device.putSetting("snapshot:snapshotUrl", `${SNAPSHOT_BASE}${cam.ip}${SNAPSHOT_PATH}`);
    await device.putSetting("snapshot:snapshotsFromPrebuffer", "Disabled");

    console.log(`  ✓ ${cam.name} id=${id} — ONVIF at ${cam.ip}:${cam.httpPort}`);
    console.log(`    Snapshot: ${SNAPSHOT_BASE}${cam.ip}${SNAPSHOT_PATH}`);
    console.log();
  }

  console.log("=== Done ===");
  console.log("Next: re-pair cameras in Home app using the PIN shown in Scrypted UI.");

  sdk.disconnect();
  process.exit(0);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
