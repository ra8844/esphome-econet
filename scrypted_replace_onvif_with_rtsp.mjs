/**
 * Scrypted: delete ONVIF camera devices and recreate as RTSP via go2rtc
 *
 * Targets the 6 Hipcam ONVIF cameras (master_bathroom pair are already RTSP).
 * Creates new RTSP devices pointing to go2rtc, with:
 *   - Mixin chain: Rebroadcast, WebRTC, Snapshot, Custom Motion Sensor, HomeKit
 *   - Custom Motion Sensor linked to a Frigate-driven dummy switch
 *   - NO CoreML — motion comes from Frigate → MQTT → frigate_bridge → dummy switch
 *
 * HomeKit pairings for these cameras will need to be re-added in the Home app
 * after this script runs.
 *
 * Run on the Mac Mini:
 *   scp scrypted_replace_onvif_with_rtsp.mjs sn@192.168.1.85:/tmp/
 *   ssh sn@192.168.1.85 'PATH=/opt/homebrew/opt/node@20/bin:$PATH node /tmp/scrypted_replace_onvif_with_rtsp.mjs'
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

const GO2RTC = "192.168.1.85:8554";
const GO2RTC_SNAPSHOT = "http://192.168.1.85:1984";

// Camera name → { main stream, sub stream, dummy switch Scrypted ID }
const CAMERAS = [
  { name: "Office Camera",            main: "office_camera_main",            sub: "office_camera_sub",            switchId: 251 },
  { name: "Master Bedroom Camera 1",  main: "master_bedroom_camera_1_main",  sub: "master_bedroom_camera_1_sub",  switchId: 248 },
  { name: "Hallway Camera 1",         main: "hallway_camera_1_main",         sub: "hallway_camera_1_sub",         switchId: 249 },
  { name: "Hallway Camera 2",         main: "hallway_camera_2_main",         sub: "hallway_camera_2_sub",         switchId: 250 },
  { name: "Kitchen Camera 1",         main: "kitchen_camera_1_main",         sub: "kitchen_camera_1_sub",         switchId: 255 },
  { name: "Kitchen Camera 2",         main: "kitchen_camera_2_main",         sub: "kitchen_camera_2_sub",         switchId: 256 },
];

function readLogin() {
  const loginPath = path.join(os.homedir(), ".scrypted", "login.json");
  const login = JSON.parse(fs.readFileSync(loginPath, "utf8"));
  const entry = login["127.0.0.1:10443"];
  if (!entry?.username || !entry?.token)
    throw new Error(`Missing credentials in ${loginPath}.`);
  return entry;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const entry = readLogin();
  console.log("Connecting to Scrypted ...");
  const sdk = await connectScryptedClient({
    baseUrl: "https://127.0.0.1:10443",
    pluginId: "@scrypted/core",
    username: entry.username,
    password: entry.token,
  });
  const sm = sdk.systemManager;
  console.log("Connected.\n");

  const rtspPlugin      = sm.getDeviceByName("RTSP Camera Plugin");
  const rebroadcast     = sm.getDeviceByName("Rebroadcast Plugin");
  const snapshot        = sm.getDeviceByName("Snapshot Plugin");
  const webrtc          = sm.getDeviceByName("WebRTC Plugin");
  const homekit         = sm.getDeviceByName("HomeKit");
  const customMotion    = sm.getDeviceByName("Custom Motion Sensor");  // mixin id=234

  for (const [label, d] of [
    ["RTSP Camera Plugin", rtspPlugin],
    ["Rebroadcast Plugin", rebroadcast],
    ["Snapshot Plugin", snapshot],
    ["WebRTC Plugin", webrtc],
    ["HomeKit", homekit],
    ["Custom Motion Sensor", customMotion],
  ]) {
    if (!d) throw new Error(`Required plugin/device not found: "${label}" — is Scrypted fully started?`);
  }

  // Mixin chain: Rebroadcast, WebRTC, Snapshot, Custom Motion Sensor, HomeKit
  // NO CoreML — motion is driven by Frigate → MQTT → frigate_bridge → dummy switch
  const mixinIds = [rebroadcast.id, webrtc.id, snapshot.id, customMotion.id, homekit.id];

  console.log("=== Step 1: Remove existing ONVIF devices ===");
  for (const cam of CAMERAS) {
    const device = sm.getDeviceByName(cam.name);
    if (!device) {
      console.log(`  - ${cam.name} — not found, skipping`);
      continue;
    }
    try {
      await device.remove();
      console.log(`  ✓ removed ${cam.name}  (was id=${device.id})`);
      await sleep(1000);
    } catch (e) {
      console.log(`  ✗ ${cam.name} remove failed — ${e.message}`);
    }
  }

  await sleep(3000);

  console.log("\n=== Step 2: Create RTSP devices pointing to go2rtc ===");
  for (const cam of CAMERAS) {
    const mainUrl = `rtsp://${GO2RTC}/${cam.main}`;
    const subUrl  = `rtsp://${GO2RTC}/${cam.sub}`;
    try {
      const id = await rtspPlugin.createDevice({ name: cam.name, url: mainUrl });
      console.log(`  created ${cam.name} id=${id}, waiting for init...`);
      await sleep(8000);

      const device = sm.getDeviceById(id);
      if (!device) throw new Error(`getDeviceById(${id}) returned null`);

      await device.putSetting("urls", [mainUrl, subUrl]);
      await device.setMixins(mixinIds);
      await sleep(2000);

      // Prebuffer stream assignments
      await device.putSetting("prebuffer:defaultStream",          mainUrl);
      await device.putSetting("prebuffer:lowResolutionStream",    subUrl);
      await device.putSetting("prebuffer:remoteStream",           subUrl);
      await device.putSetting("prebuffer:recordingStream",        mainUrl);
      await device.putSetting("prebuffer:remoteRecordingStream",  subUrl);

      // Snapshot from go2rtc frame API
      await device.putSetting("snapshot:snapshotUrl",            `${GO2RTC_SNAPSHOT}/api/frame.jpeg?src=${cam.main}`);
      await device.putSetting("snapshot:snapshotsFromPrebuffer", "Disabled");

      // HomeKit standalone mode
      await device.putSetting("homekit:standalone", true);

      // Custom Motion Sensor — link to Frigate dummy switch
      await device.putSetting("replaceMotionSensor:replaceMotionSensor", String(cam.switchId));

      console.log(`  ✓ ${cam.name}  (id=${id})  main=${mainUrl}  switch=${cam.switchId}`);
    } catch (e) {
      console.log(`  ✗ ${cam.name}  — ${e.message}`);
    }
  }

  console.log("\n=== Done ===");
  console.log("All 6 Hipcam cameras now consume go2rtc RTSP streams.");
  console.log("Motion: Frigate → MQTT → frigate_bridge → dummy switch → Custom Motion Sensor → HKSV");
  console.log("Re-pair each camera in the Home app using the PIN shown in Scrypted.");

  sdk.disconnect();
  process.exit(0);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
