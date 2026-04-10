/**
 * Fix "New Camera" names for the 8 Hipcam RTSP cameras created via go2rtc.
 * Reads each camera's configured URL to identify it, then renames it correctly.
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
  if (!entry) throw new Error("Unable to locate @scrypted/client.");
  return entry;
}

const { connectScryptedClient } = await import(findClientEntry());

// Map go2rtc stream name suffix → correct camera name
const STREAM_TO_NAME = {
  master_bathroom_camera_1_main: "Master Bathroom Camera 1",
  master_bathroom_camera_2_main: "Master Bathroom Camera 2",
  master_bedroom_camera_1_main:  "Master Bedroom Camera 1",
  hallway_camera_1_main:         "Hallway Camera 1",
  hallway_camera_2_main:         "Hallway Camera 2",
  kitchen_camera_1_main:         "Kitchen Camera 1",
  kitchen_camera_2_main:         "Kitchen Camera 2",
  office_camera_main:            "Office Camera",
};

const CANDIDATE_IDS = [150, 151, 152, 153, 154, 155, 156, 157];
const GO2RTC = "192.168.1.85:8554";

function readLogin() {
  const loginPath = path.join(os.homedir(), ".scrypted", "login.json");
  const login = JSON.parse(fs.readFileSync(loginPath, "utf8"));
  const entry = login["127.0.0.1:10443"];
  if (!entry?.username || !entry?.token) throw new Error("Missing credentials.");
  return entry;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const entry = readLogin();
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

  for (const id of CANDIDATE_IDS) {
    const device = sm.getDeviceById(String(id));
    if (!device) { console.log(`  id=${id} not found`); continue; }

    // Get the configured URL from settings
    const settings = await device.getSettings();
    const urlSetting = settings?.find(s => s.key === "url" || s.key === "rtspUrl" || s.key === "urls");
    const url = Array.isArray(urlSetting?.value) ? urlSetting.value[0] : urlSetting?.value || "";

    // Match URL to camera name
    const streamKey = Object.keys(STREAM_TO_NAME).find(k => url.includes(k));
    const correctName = streamKey ? STREAM_TO_NAME[streamKey] : null;

    const currentName = sm.getSystemState()[id]?.name?.value;
    console.log(`id=${id} url="${url.replace(`rtsp://${GO2RTC}/`, '')}" current="${currentName}" → ${correctName || "UNKNOWN"}`);

    if (!correctName) continue;

    // Rename
    await device.putSetting("name", correctName);
    await sleep(500);

    // Apply mixins with CoreML
    const mixinIds = [rebroadcast.id, webrtc.id, snapshot.id, homekit.id];
    if (coreml) mixinIds.push(coreml.id);
    await device.setMixins(mixinIds);
    await sleep(1000);

    // Configure streams
    const mainUrl = `rtsp://${GO2RTC}/${streamKey}`;
    const subKey  = streamKey.replace("_main", "_sub");
    const subUrl  = `rtsp://${GO2RTC}/${subKey}`;
    await device.putSetting("prebuffer:defaultStream", mainUrl);
    await device.putSetting("prebuffer:lowResolutionStream", subUrl);
    await device.putSetting("prebuffer:remoteStream", subUrl);
    await device.putSetting("prebuffer:recordingStream", mainUrl);
    await device.putSetting("snapshot:snapshotUrl", `http://192.168.1.85:1984/api/frame.jpeg?src=${streamKey}`);
    await device.putSetting("snapshot:snapshotsFromPrebuffer", "Disabled");
    await device.putSetting("homekit:standalone", true);

    console.log(`  ✓ renamed to "${correctName}" + applied CoreML mixins`);
  }

  console.log("\nDone.");
  sdk.disconnect();
  process.exit(0);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
