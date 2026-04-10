/**
 * Scrypted migration: ONVIF → RTSP plugin (via go2rtc)
 *
 * For cameras where ONVIF is not working well, removes the ONVIF device and
 * recreates it as an RTSP camera pointing to go2rtc localhost streams.
 * Dummy switch + Custom Motion Sensor mixin is applied for HKSV motion.
 *
 * Run on the Mac Mini:
 *   scp scrypted_onvif_to_rtsp.mjs sn@192.168.1.85:/tmp/
 *   ssh sn@192.168.1.85 'PATH=/opt/homebrew/opt/node@20/bin:$PATH node /tmp/scrypted_onvif_to_rtsp.mjs'
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

const GO2RTC = "192.168.1.85:8554";

// Cameras to move from ONVIF → RTSP (via go2rtc)
const CAMERAS = [
  { name: "Master Bathroom Camera 1", main: "master_bathroom_camera_1_main", sub: "master_bathroom_camera_1_sub" },
  { name: "Master Bathroom Camera 2", main: "master_bathroom_camera_2_main", sub: "master_bathroom_camera_2_sub" },
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

  const rtspPlugin          = sm.getDeviceByName("RTSP Camera Plugin");
  const rebroadcast         = sm.getDeviceByName("Rebroadcast Plugin");
  const snapshot            = sm.getDeviceByName("Snapshot Plugin");
  const webrtc              = sm.getDeviceByName("WebRTC Plugin");
  const homekit             = sm.getDeviceByName("HomeKit");
  const replaceMotionPlugin = sm.getDeviceByName("Custom Motion Sensor");

  for (const [name, d] of [
    ["RTSP Camera Plugin", rtspPlugin],
    ["Rebroadcast Plugin", rebroadcast],
    ["Snapshot Plugin", snapshot],
    ["WebRTC Plugin", webrtc],
    ["HomeKit", homekit],
  ]) {
    if (!d) throw new Error(`${name} not found`);
  }

  console.log("=== Migrating ONVIF cameras → RTSP (go2rtc) ===\n");

  for (const cam of CAMERAS) {
    const mainUrl = `rtsp://${GO2RTC}/${cam.main}`;
    const subUrl  = `rtsp://${GO2RTC}/${cam.sub}`;
    const motionName = `${cam.name} Motion`;

    // 1. Remove existing ONVIF device
    const existing = sm.getDeviceByName(cam.name);
    if (existing) {
      console.log(`  Removing existing device "${cam.name}" id=${existing.id} (${existing.pluginId}) ...`);
      await sm.removeDevice(existing.id);
      await sleep(2000);
    }

    // 2. Create new RTSP device
    console.log(`  Creating RTSP device "${cam.name}" ...`);
    let id;
    try {
      id = await rtspPlugin.createDevice({ name: cam.name, url: mainUrl });
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

    // 3. Set stream URLs
    await device.putSetting("name", cam.name);
    await device.putSetting("urls", [mainUrl, subUrl]);

    // 4. Apply mixins
    const mixinIds = [rebroadcast.id, webrtc.id, snapshot.id, homekit.id];
    if (replaceMotionPlugin) mixinIds.push(replaceMotionPlugin.id);
    await device.setMixins(mixinIds);
    await sleep(2000);

    // 5. Configure streams
    await device.putSetting("homekit:standalone", true);
    await device.putSetting("prebuffer:defaultStream", mainUrl);
    await device.putSetting("prebuffer:lowResolutionStream", subUrl);
    await device.putSetting("prebuffer:remoteStream", subUrl);
    await device.putSetting("prebuffer:recordingStream", mainUrl);
    await device.putSetting("prebuffer:remoteRecordingStream", subUrl);

    // 6. Snapshot from go2rtc JPEG API
    await device.putSetting("snapshot:snapshotUrl", `http://192.168.1.85:1984/api/frame.jpeg?src=${cam.main}`);
    await device.putSetting("snapshot:snapshotsFromPrebuffer", "Disabled");

    // 7. Link dummy switch if it exists
    const motionSwitch = sm.getDeviceByName(motionName);
    if (motionSwitch && replaceMotionPlugin) {
      await device.putSetting("replaceMotionSensor:replaceMotionSensor", motionSwitch.id);
      console.log(`  Linked motion switch "${motionName}" (id=${motionSwitch.id})`);
    } else {
      console.log(`  No dummy switch found for "${motionName}" — create one manually for HKSV`);
    }

    console.log(`  ✓ ${cam.name} id=${id} → ${mainUrl}`);
    console.log();
  }

  console.log("=== Done ===");
  console.log("Re-deploy go2rtc.yaml, then restart go2rtc to activate the new streams.");
  console.log("Re-pair cameras in Home app using PIN shown in Scrypted UI.");

  sdk.disconnect();
  process.exit(0);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
