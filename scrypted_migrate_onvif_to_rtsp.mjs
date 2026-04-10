/**
 * Scrypted migration: ONVIF cameras → go2rtc RTSP
 *
 * Switches the 8 existing Hipcam ONVIF devices from direct camera connections
 * to go2rtc RTSP localhost streams. Scrypted prebuffer then hits localhost only,
 * eliminating the network flood caused by 8 direct high-bitrate ONVIF streams.
 *
 * Motion detection switches from ONVIF-T events to CoreML (M1 Neural Engine).
 *
 * Run on the Mac Mini:
 *   scp scrypted_migrate_onvif_to_rtsp.mjs sn@192.168.1.85:/tmp/
 *   ssh sn@192.168.1.85 'PATH=/opt/homebrew/opt/node@20/bin:$PATH node /tmp/scrypted_migrate_onvif_to_rtsp.mjs'
 *
 * Prerequisites:
 *   - go2rtc running with all 8 Hipcam streams configured (go2rtc.yaml deployed)
 *   - Scrypted running at https://127.0.0.1:10443
 *   - ~/.scrypted/login.json present with valid token
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function findClientEntry() {
  const output = execFileSync(
    "find",
    [
      path.join(os.homedir(), ".npm", "_npx"),
      "-path",
      "*/@scrypted/client/dist/packages/client/src/index.js",
    ],
    { encoding: "utf8" },
  ).trim();
  const [entry] = output.split("\n").filter(Boolean);
  if (!entry) throw new Error("Unable to locate @scrypted/client under ~/.npm/_npx.");
  return entry;
}

const { connectScryptedClient } = await import(findClientEntry());

// Maps existing Scrypted device name → go2rtc stream names
const ONVIF_TO_RTSP = [
  { name: "Master Bathroom Camera 1", main: "master_bathroom_camera_1_main", sub: "master_bathroom_camera_1_sub" },
  { name: "Master Bathroom Camera 2", main: "master_bathroom_camera_2_main", sub: "master_bathroom_camera_2_sub" },
  { name: "Master Bedroom Camera 1",  main: "master_bedroom_camera_1_main",  sub: "master_bedroom_camera_1_sub" },
  { name: "Hallway Camera 1",         main: "hallway_camera_1_main",         sub: "hallway_camera_1_sub" },
  { name: "Hallway Camera 2",         main: "hallway_camera_2_main",         sub: "hallway_camera_2_sub" },
  { name: "Kitchen Camera 1",         main: "kitchen_camera_1_main",         sub: "kitchen_camera_1_sub" },
  { name: "Kitchen Camera 2",         main: "kitchen_camera_2_main",         sub: "kitchen_camera_2_sub" },
  { name: "Office Camera",            main: "office_camera_main",            sub: "office_camera_sub" },
];

const GO2RTC = "192.168.1.85:8554";

function readLogin() {
  const loginPath = path.join(os.homedir(), ".scrypted", "login.json");
  const login = JSON.parse(fs.readFileSync(loginPath, "utf8"));
  const entry = login["127.0.0.1:10443"];
  if (!entry?.username || !entry?.token)
    throw new Error(`Missing 127.0.0.1:10443 credentials in ${loginPath}.`);
  return entry;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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

  const rebroadcast  = sm.getDeviceByName("Rebroadcast Plugin");
  const snapshot     = sm.getDeviceByName("Snapshot Plugin");
  const webrtc       = sm.getDeviceByName("WebRTC Plugin");
  const homekit      = sm.getDeviceByName("HomeKit");
  const coreml       = sm.getDeviceByName("CoreML Object Detection");
  const objectDetector = sm.getDeviceByName("Video Analysis Plugin");

  for (const d of [rebroadcast, snapshot, webrtc, homekit]) {
    if (!d) throw new Error("Required plugin device not found — is Scrypted fully started?");
  }

  if (coreml && objectDetector) {
    console.log("Enabling Video Analysis developer mode and linking to CoreML ...");
    await objectDetector.putSetting("developerMode", true);
    await coreml.setMixins([objectDetector.id]);
  } else {
    console.log("CoreML not available — skipping (fix separately). Motion detection will use ONVIF fallback.");
  }

  console.log("\n=== Migrating ONVIF cameras to go2rtc RTSP ===");
  for (const cam of ONVIF_TO_RTSP) {
    const device = sm.getDeviceByName(cam.name);
    if (!device) {
      console.log(`  ✗ ${cam.name} — not found in Scrypted, skipping`);
      continue;
    }

    const mainUrl = `rtsp://${GO2RTC}/${cam.main}`;
    const subUrl  = `rtsp://${GO2RTC}/${cam.sub}`;

    try {
      // Switch stream URLs to go2rtc localhost
      await device.putSetting("urls", [mainUrl, subUrl]);
      await sleep(2000);

      // Rebuild mixin chain with CoreML if available, otherwise without
      const mixinIds = [rebroadcast.id, webrtc.id, snapshot.id, homekit.id];
      if (coreml) mixinIds.push(coreml.id);
      await device.setMixins(mixinIds);
      await sleep(2000);

      // Configure streams
      await device.putSetting("prebuffer:defaultStream", mainUrl);
      await device.putSetting("prebuffer:lowResolutionStream", subUrl);
      await device.putSetting("prebuffer:remoteStream", subUrl);
      await device.putSetting("prebuffer:recordingStream", mainUrl);
      await device.putSetting("prebuffer:remoteRecordingStream", subUrl);

      // Snapshot from go2rtc JPEG API
      await device.putSetting("snapshot:snapshotUrl", `http://192.168.1.85:1984/api/frame.jpeg?src=${cam.main}`);
      await device.putSetting("snapshot:snapshotsFromPrebuffer", "Disabled");

      // Keep as standalone HomeKit accessory
      await device.putSetting("homekit:standalone", true);

      console.log(`  ✓ ${cam.name}  →  ${mainUrl}`);
    } catch (e) {
      console.log(`  ✗ ${cam.name}  — ${e.message}`);
    }
  }

  console.log("\n=== Done ===");
  console.log("Prebuffer now hits go2rtc localhost for all Hipcam cameras.");
  console.log("Verify streams at http://192.168.1.85:1984 and check HomeKit.");

  sdk.disconnect();
  process.exit(0);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
