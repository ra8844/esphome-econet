/**
 * Scrypted localhost migration + mixin repair script
 *
 * For all go2rtc-backed RTSP cameras in Scrypted:
 *   - Switches RTSP stream URLs to localhost (192.168.1.85:8554 → 127.0.0.1:8554)
 *   - Switches snapshot URLs to localhost (192.168.1.85:1984 → 127.0.0.1:1984)
 *   - Re-applies full mixin chain: rebroadcast, webrtc, snapshot, homekit, coreml
 *   - Sets all prebuffer stream assignments (default, sub, remote, recording)
 *   - Creates Kitchen Camera 1 and Eufy Garage Camera 1 if not found
 *
 * Safe to re-run — existing HomeKit pairings are preserved.
 *
 * Run on the Mac Mini:
 *   scp scrypted_migrate_localhost.mjs sn@192.168.1.85:/tmp/
 *   ssh sn@192.168.1.85 'PATH=/opt/homebrew/opt/node@20/bin:$PATH node /tmp/scrypted_migrate_localhost.mjs'
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

const GO2RTC_RTSP = "192.168.1.85:8554";
const GO2RTC_HTTP = "http://127.0.0.1:1984";

const CAMERAS = [
  // Wyze cameras
  { name: "Living Room Camera",       main: "living_room_camera_main",       sub: "living_room_camera_sub" },
  { name: "Front Door Camera",        main: "front_door_camera_main",        sub: "front_door_camera_sub" },

  // Hipcam knockoff cameras
  { name: "Master Bathroom Camera 1", main: "master_bathroom_camera_1_main", sub: "master_bathroom_camera_1_sub" },
  { name: "Master Bathroom Camera 2", main: "master_bathroom_camera_2_main", sub: "master_bathroom_camera_2_sub" },
  { name: "Master Bedroom Camera 1",  main: "master_bedroom_camera_1_main",  sub: "master_bedroom_camera_1_sub" },
  { name: "Hallway Camera 1",         main: "hallway_camera_1_main",         sub: "hallway_camera_1_sub" },
  { name: "Hallway Camera 2",         main: "hallway_camera_2_main",         sub: "hallway_camera_2_sub" },
  { name: "Kitchen Camera 1",         main: "kitchen_camera_1_main",         sub: "kitchen_camera_1_sub" },
  { name: "Kitchen Camera 2",         main: "kitchen_camera_2_main",         sub: "kitchen_camera_2_sub" },
  { name: "Office Camera",            main: "office_camera_main",            sub: "office_camera_sub" },

  // Eufy garage camera
  { name: "Eufy Garage Camera 1",     main: "eufy_garage_camera_1_main",     sub: "eufy_garage_camera_1_sub" },
];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function configureCamera(device, cam, mixinIds) {
  const mainUrl = `rtsp://${GO2RTC_RTSP}/${cam.main}`;
  const subUrl  = `rtsp://${GO2RTC_RTSP}/${cam.sub}`;
  const snapUrl = `${GO2RTC_HTTP}/api/frame.jpeg?src=${cam.main}`;

  await device.putSetting("urls", [mainUrl, subUrl]);
  await sleep(1000);

  await device.setMixins(mixinIds);
  await sleep(2000);

  await device.putSetting("homekit:standalone", true);

  await device.putSetting("prebuffer:defaultStream", mainUrl);
  await device.putSetting("prebuffer:lowResolutionStream", subUrl);
  await device.putSetting("prebuffer:remoteStream", subUrl);
  await device.putSetting("prebuffer:recordingStream", mainUrl);
  await device.putSetting("prebuffer:remoteRecordingStream", subUrl);

  await device.putSetting("snapshot:snapshotUrl", snapUrl);
  await device.putSetting("snapshot:snapshotsFromPrebuffer", "Disabled");

  return { mainUrl, subUrl, snapUrl };
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

  const rtspPlugin    = sm.getDeviceByName("RTSP Camera Plugin");
  const rebroadcast   = sm.getDeviceByName("Rebroadcast Plugin");
  const snapshot      = sm.getDeviceByName("Snapshot Plugin");
  const webrtc        = sm.getDeviceByName("WebRTC Plugin");
  const homekit       = sm.getDeviceByName("HomeKit");
  const coreml        = sm.getDeviceByName("CoreML Object Detection");
  const objectDetector = sm.getDeviceByName("Video Analysis Plugin");

  for (const [name, d] of [
    ["RTSP Camera Plugin", rtspPlugin],
    ["Rebroadcast Plugin", rebroadcast],
    ["Snapshot Plugin", snapshot],
    ["WebRTC Plugin", webrtc],
    ["HomeKit", homekit],
  ]) {
    if (!d) throw new Error(`${name} not found — is the plugin installed?`);
  }

  if (!coreml) console.warn("WARNING: CoreML not found — cameras will be set up without motion detection.");

  if (coreml && objectDetector) {
    console.log("Linking Video Analysis to CoreML ...");
    await objectDetector.putSetting("developerMode", true);
    await coreml.setMixins([objectDetector.id]);
    await sleep(1000);
  }

  const mixinIds = [rebroadcast.id, webrtc.id, snapshot.id, homekit.id];
  if (coreml) mixinIds.push(coreml.id);

  console.log(`\nMixin chain: [${mixinIds.map(id => sm.getDeviceById(id)?.name ?? id).join(", ")}]\n`);
  console.log("=== Applying settings to all go2rtc cameras ===\n");

  for (const cam of CAMERAS) {
    let device = sm.getDeviceByName(cam.name);

    if (!device) {
      // Create missing camera
      console.log(`  + ${cam.name} — not found, creating ...`);
      try {
        const mainUrl = `rtsp://${GO2RTC_RTSP}/${cam.main}`;
        const id = await rtspPlugin.createDevice({ name: cam.name, url: mainUrl });
        await sleep(8000);
        device = sm.getDeviceById(id);
        await device.putSetting("name", cam.name);
        console.log(`    created id=${id}`);
      } catch (e) {
        console.log(`  ✗ ${cam.name} — create failed: ${e.message}`);
        continue;
      }
    }

    try {
      const { mainUrl, subUrl, snapUrl } = await configureCamera(device, cam, mixinIds);
      console.log(`  ✓ ${cam.name}`);
      console.log(`      stream:   ${mainUrl}`);
      console.log(`      sub:      ${subUrl}`);
      console.log(`      snapshot: ${snapUrl}`);
    } catch (e) {
      console.log(`  ✗ ${cam.name} — ${e.message}`);
    }
  }

  console.log("\n=== Done ===");
  console.log("Next: verify cameras stream in Scrypted UI, then check HomeKit for HKSV.");

  sdk.disconnect();
  process.exit(0);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
