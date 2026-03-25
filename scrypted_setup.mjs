/**
 * Scrypted Camera Setup Script
 *
 * Adds all 14 cameras to fresh native Scrypted install on Mac Mini M1.
 * Run via SSH: PATH=/opt/homebrew/opt/node@20/bin:$PATH node /tmp/scrypted_setup.mjs
 *
 * Prerequisites:
 *   - Scrypted running natively at https://127.0.0.1:10443
 *   - Admin account created (see CAMERAS.md for credentials)
 *   - API token obtained via POST /login and stored in ~/.scrypted/login.json
 *   - All 8 plugins installed via: npx scrypted install <plugin> 127.0.0.1
 *
 * Plugins required:
 *   @scrypted/rtsp, @scrypted/homekit, @scrypted/coreml, @scrypted/objectdetector
 *   @scrypted/webrtc, @scrypted/prebuffer-mixin, @scrypted/snapshot
 *   @apocaliss92/scrypted-reolink-native
 *
 * See CAMERAS.md for full architecture documentation.
 */

import { connectScryptedClient } from "/Users/sn/.npm/_npx/f8ff587849d254b8/node_modules/@scrypted/client/dist/packages/client/src/index.js";

// API token — get a fresh one via:
//   curl -sk -X POST https://localhost:10443/login \
//     -H "Content-Type: application/json" \
//     -d '{"username":"snassar","password":"<password>","change_password":"<password>"}'
//   Use the returned "token" field here (or set SCRYPTED_TOKEN env var).
const API_TOKEN = process.env.SCRYPTED_TOKEN || "<paste-token-here>";

const RTSP_CAMERAS = [
  // ── Hipcam knockoff cameras (ONVIF → go2rtc RTSP → Scrypted) ─────────────
  // go2rtc connects ONVIF (port 8080), transcodes PCMA→Opus, rebroadcasts RTSP
  // CoreML on M1 Neural Engine handles motion detection for these cameras
  { name: "Master Bathroom Camera 1", url: "rtsp://192.168.5.87:8554/master_bathroom_camera_1_main" },
  { name: "Master Bathroom Camera 2", url: "rtsp://192.168.5.87:8554/master_bathroom_camera_2_main" },
  { name: "Master Bedroom Camera 1",  url: "rtsp://192.168.5.87:8554/master_bedroom_camera_1_main" },
  { name: "Hallway Camera 1",         url: "rtsp://192.168.5.87:8554/hallway_camera_1_main" },
  { name: "Hallway Camera 2",         url: "rtsp://192.168.5.87:8554/hallway_camera_2_main" },
  { name: "Kitchen Camera 1",         url: "rtsp://192.168.5.87:8554/kitchen_camera_1_main" },
  { name: "Kitchen Camera 2",         url: "rtsp://192.168.5.87:8554/kitchen_camera_2_main" },
  { name: "Office Camera",            url: "rtsp://192.168.5.87:8554/office_camera_main" },

  // ── Wyze cameras (wyze:// P2P → go2rtc RTSP → Scrypted) ──────────────────
  // go2rtc handles Wyze P2P natively. CoreML replaces wyze-bridge motion.
  { name: "Living Room Camera",  url: "rtsp://192.168.5.87:8554/living_room_camera_main" },
  { name: "Front Door Camera",   url: "rtsp://192.168.5.87:8554/front_door_camera_main" },
];

const REOLINK_CAMERAS = [
  // ── Reolink cameras (direct to camera, no go2rtc) ─────────────────────────
  // Native Reolink plugin connects directly; AAC audio, no transcoding needed.
  // Motion comes from Reolink's native AI (person/vehicle/pet) — not CoreML.
  { name: "Courtyard Doorbell",      ip: "192.168.5.141" },
  { name: "Backyard Doorbell",       ip: "192.168.5.163" },
  { name: "Garage Outside Doorbell", ip: "192.168.5.74" },
  { name: "Garage Outside Camera",   ip: "192.168.5.84" },
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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

  const rtspPlugin = sm.getDeviceByName("RTSP Camera Plugin");
  const reolinkPlugin = sm.getDeviceByName("Reolink Native");

  if (!rtspPlugin) throw new Error("RTSP Camera Plugin device not found — is @scrypted/rtsp installed?");
  if (!reolinkPlugin) throw new Error("Reolink Native device not found — is @apocaliss92/scrypted-reolink-native installed?");

  console.log(`RTSP Plugin device ID: ${rtspPlugin.id}`);
  console.log(`Reolink Plugin device ID: ${reolinkPlugin.id}\n`);

  // ── Add RTSP cameras (Hipcam + Wyze) ──────────────────────────────────────
  console.log("=== Adding RTSP cameras (Hipcam + Wyze via go2rtc) ===");
  for (const cam of RTSP_CAMERAS) {
    try {
      const id = await rtspPlugin.createDevice({ name: cam.name, url: cam.url });
      // createDevice does not persist the URL into settings — must set explicitly as array
      const device = sm.getDeviceById(id);
      await device.putSetting("urls", [cam.url]);
      await sleep(10000); // plugin needs ~10s to process each URL change
      console.log(`  ✓ ${cam.name}  (id=${id})`);
    } catch (e) {
      console.log(`  ✗ ${cam.name}  — ${e.message}`);
    }
  }

  // ── Add Reolink cameras ────────────────────────────────────────────────────
  console.log("\n=== Adding Reolink cameras (direct connection) ===");
  for (const cam of REOLINK_CAMERAS) {
    try {
      const id = await reolinkPlugin.createDevice({
        name: cam.name,
        ip: cam.ip,
        username: "admin",
        password: process.env.REOLINK_PASSWORD || "<reolink-password>",
      });
      console.log(`  ✓ ${cam.name}  (id=${id})`);
      await sleep(500);
    } catch (e) {
      console.log(`  ✗ ${cam.name}  — ${e.message}`);
    }
  }

  console.log("\n=== Done ===");
  console.log("Next steps (in Scrypted UI https://192.168.5.87:10443):");
  console.log("  1. For each Hipcam + Wyze camera: add mixins → Rebroadcast, Snapshot, Video Analysis (CoreML), HomeKit");
  console.log("  2. In Video Analysis mixin: set Detection Model = CoreML");
  console.log("  3. For each Reolink: add mixins → Rebroadcast, Snapshot, HomeKit");
  console.log("  4. Pair HomeKit bridge in Home app");

  sdk.disconnect();
  process.exit(0);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
