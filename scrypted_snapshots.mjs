/**
 * Scrypted Snapshot URL Apply Script
 *
 * Applies go2rtc JPEG snapshot URLs to all existing cameras without recreating devices.
 * Run after a fresh Scrypted install once all cameras are created and mixins are added,
 * or any time you need to re-apply snapshot settings.
 *
 * Run via SSH:
 *   PATH=/opt/homebrew/opt/node@20/bin:$PATH SCRYPTED_TOKEN=<token> REOLINK_PASSWORD=<pass> \
 *     node /tmp/scrypted_snapshots.mjs
 */

import { connectScryptedClient } from "/Users/sn/.npm/_npx/f8ff587849d254b8/node_modules/@scrypted/client/dist/packages/client/src/index.js";

const API_TOKEN       = process.env.SCRYPTED_TOKEN    || "<paste-token-here>";
const REOLINK_PASSWORD = process.env.REOLINK_PASSWORD || "<reolink-password>";
const GO2RTC          = "http://192.168.5.87:1984";

// go2rtc JPEG snapshot: http://192.168.5.87:1984/api/stream.jpeg?src=<stream>
const RTSP_SNAPSHOTS = [
  { name: "Master Bathroom Camera 1", stream: "master_bathroom_camera_1_main" },
  { name: "Master Bathroom Camera 2", stream: "master_bathroom_camera_2_main" },
  { name: "Master Bedroom Camera 1",  stream: "master_bedroom_camera_1_main"  },
  { name: "Hallway Camera 1",         stream: "hallway_camera_1_main"         },
  { name: "Hallway Camera 2",         stream: "hallway_camera_2_main"         },
  { name: "Kitchen Camera 1",         stream: "kitchen_camera_1_main"         },
  { name: "Kitchen Camera 2",         stream: "kitchen_camera_2_main"         },
  { name: "Office Camera",            stream: "office_camera_main"            },
  { name: "Living Room Camera",       stream: "living_room_camera_main"       },
  { name: "Front Door Camera",        stream: "front_door_camera_main"        },
  { name: "Garage Outside Camera",    stream: "garage_outside_camera_main"    },
];

// Camera HTTP JPEG API (doorbells are direct — not via go2rtc)
const DOORBELL_SNAPSHOTS = [
  { name: "Courtyard Doorbell",      ip: "192.168.5.141" },
  { name: "Backyard Doorbell",       ip: "192.168.5.74"  },
  { name: "Garage Outside Doorbell", ip: "192.168.5.163" },
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

  // ── RTSP + Garage Outside Camera — go2rtc JPEG API ────────────────────────
  console.log("=== Applying go2rtc JPEG snapshot URLs (RTSP cameras + Garage Outside) ===");
  for (const cam of RTSP_SNAPSHOTS) {
    const device = sm.getDeviceByName(cam.name);
    if (!device) { console.log(`  ✗ ${cam.name} — not found`); continue; }
    const url = `${GO2RTC}/api/stream.jpeg?src=${cam.stream}`;
    try {
      await device.putSetting("snapshot:snapshotUrl", url);
      console.log(`  ✓ ${cam.name}`);
    } catch (e) {
      console.log(`  ✗ ${cam.name} — ${e.message}`);
    }
  }

  // ── Reolink doorbells — camera HTTP JPEG API ───────────────────────────────
  console.log("\n=== Applying camera HTTP snapshot URLs (Reolink doorbells) ===");
  const pass = encodeURIComponent(REOLINK_PASSWORD);
  for (const cam of DOORBELL_SNAPSHOTS) {
    const device = sm.getDeviceByName(cam.name);
    if (!device) { console.log(`  ✗ ${cam.name} — not found`); continue; }
    const url = `http://${cam.ip}/cgi-bin/api.cgi?cmd=Snap&channel=0&user=admin&password=${pass}`;
    try {
      await device.putSetting("snapshot:snapshotUrl", url);
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
