/**
 * Scrypted Snapshot URL Apply Script
 *
 * Applies snapshot URLs to the existing Scrypted-managed cameras without
 * recreating devices. Run after a fresh Scrypted install once all cameras are
 * created and mixins are added, or any time you need to re-apply snapshot
 * settings.
 *
 * Cameras intentionally outside the Scrypted path are excluded here by design.
 * In particular, Eufy Garage Camera 1 stays on go2rtc for Home Assistant only,
 * while HomeKit/HKSV/motion continue to come from Eufy via HomeBase.
 *
 * Run via SSH:
 *   PATH=/opt/homebrew/opt/node@20/bin:$PATH SCRYPTED_TOKEN=<token> REOLINK_PASSWORD=<pass> \
 *     node /tmp/scrypted_snapshots.mjs
 */

import { connectScryptedClient } from "/Users/sn/.npm/_npx/f8ff587849d254b8/node_modules/@scrypted/client/dist/packages/client/src/index.js";

const API_TOKEN              = process.env.SCRYPTED_TOKEN         || "<paste-token-here>";
const REOLINK_PASSWORD       = process.env.REOLINK_PASSWORD       || "<reolink-password>";
const GARAGE_CAMERA_PASSWORD = process.env.GARAGE_CAMERA_PASSWORD || "<garage-camera-password>";
const GO2RTC                 = "http://192.168.1.85:1984";

// go2rtc JPEG snapshot: http://192.168.1.85:1984/api/frame.jpeg?src=<stream>
// Wyze still uses go2rtc JPEG snapshots even though Surveillance Station now
// consumes Scrypted rebroadcast URLs and is the preferred motion source.
const GO2RTC_SNAPSHOTS = [
  { name: "Living Room Camera",       stream: "living_room_camera_main"       },
  { name: "Front Door Camera",        stream: "front_door_camera_main"        },
];

const EXCLUDED_CAMERAS = [
  {
    name: "Eufy Garage Camera 1",
    reason: "Not managed by Scrypted for HomeKit/HKSV/motion; Eufy + HomeBase own that path.",
  },
];

// Camera HTTP JPEG API — direct to camera (not via go2rtc)
// Only include cameras with a known direct snapshot endpoint here.
const DIRECT_SNAPSHOTS = [
  { name: "Garage Outside Camera",   ip: "192.168.5.84",  password: GARAGE_CAMERA_PASSWORD },
  { name: "Courtyard Doorbell",      ip: "192.168.5.141", password: REOLINK_PASSWORD },
  { name: "Backyard Doorbell",       ip: "192.168.5.74",  password: REOLINK_PASSWORD },
  { name: "Garage Outside Doorbell", ip: "192.168.5.163", password: REOLINK_PASSWORD },
];

async function main() {
  console.log("Connecting to Scrypted at https://127.0.0.1:10443 ...");
  const sdk = await connectScryptedClient({
    baseUrl: "https://127.0.0.1:10443",
    pluginId: "@scrypted/core",
    username: "snassar",
    password: API_TOKEN,
  });
  const sm = sdk.systemManager;
  console.log("Connected.\n");

  // ── go2rtc JPEG API — Wyze cameras ────────────────────────────────────────
  console.log("=== Applying go2rtc JPEG snapshot URLs (Wyze cameras) ===");
  for (const cam of GO2RTC_SNAPSHOTS) {
    const device = sm.getDeviceByName(cam.name);
    if (!device) { console.log(`  ✗ ${cam.name} — not found`); continue; }
    const url = `${GO2RTC}/api/frame.jpeg?src=${cam.stream}`;
    try {
      await device.putSetting("snapshot:snapshotUrl", url);
      await device.putSetting("snapshot:snapshotsFromPrebuffer", "Disabled");
      console.log(`  ✓ ${cam.name}`);
    } catch (e) {
      console.log(`  ✗ ${cam.name} — ${e.message}`);
    }
  }

  console.log("\n=== Cameras intentionally excluded from snapshot updates ===");
  for (const cam of EXCLUDED_CAMERAS) {
    console.log(`  - ${cam.name}: ${cam.reason}`);
  }

  // ── Direct camera HTTP JPEG API (Reolink cameras) ─────────────────────────
  console.log("\n=== Applying direct camera HTTP snapshot URLs ===");
  for (const cam of DIRECT_SNAPSHOTS) {
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
