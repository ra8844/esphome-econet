/**
 * Switch Scrypted RTSP camera prebuffer from main stream to sub stream.
 * This reduces constant memory/CPU usage since sub streams are lower bitrate.
 *
 * Run via SSH:
 *   scp scrypted_set_prebuffer_sub.mjs sn@192.168.1.85:/tmp/
 *   ssh sn@192.168.1.85 'PATH=/opt/homebrew/opt/node@20/bin:$PATH node /tmp/scrypted_set_prebuffer_sub.mjs'
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

const GO2RTC = "192.168.1.85:8554";

const RTSP_CAMERAS = [
  { name: "Living Room Camera",       main: "living_room_camera_main",       sub: "living_room_camera_sub" },
  { name: "Front Door Camera",        main: "front_door_camera_main",        sub: "front_door_camera_sub" },
  { name: "Master Bathroom Camera 1", main: "master_bathroom_camera_1_main", sub: "master_bathroom_camera_1_sub" },
  { name: "Master Bathroom Camera 2", main: "master_bathroom_camera_2_main", sub: "master_bathroom_camera_2_sub" },
  { name: "Master Bedroom Camera 1",  main: "master_bedroom_camera_1_main",  sub: "master_bedroom_camera_1_sub" },
  { name: "Hallway Camera 1",         main: "hallway_camera_1_main",         sub: "hallway_camera_1_sub" },
  { name: "Hallway Camera 2",         main: "hallway_camera_2_main",         sub: "hallway_camera_2_sub" },
  { name: "Kitchen Camera 1",         main: "kitchen_camera_1_main",         sub: "kitchen_camera_1_sub" },
  { name: "Kitchen Camera 2",         main: "kitchen_camera_2_main",         sub: "kitchen_camera_2_sub" },
  { name: "Office Camera",            main: "office_camera_main",            sub: "office_camera_sub" },
  { name: "Eufy Garage Camera 1",     main: "eufy_garage_camera_1_main",     sub: "eufy_garage_camera_1_sub" },
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

  for (const cam of RTSP_CAMERAS) {
    const mainUrl = `rtsp://${GO2RTC}/${cam.main}`;
    const subUrl  = `rtsp://${GO2RTC}/${cam.sub}`;
    const device = sm.getDeviceByName(cam.name);
    if (!device) {
      console.log(`  ✗ ${cam.name} — not found in Scrypted`);
      continue;
    }
    try {
      // Prebuffer sub stream instead of main — reduces constant memory/CPU
      await device.putSetting("prebuffer:defaultStream", subUrl);
      await device.putSetting("prebuffer:enabledStreams", [subUrl]);
      await device.putSetting("prebuffer:remoteStream", subUrl);
      await device.putSetting("prebuffer:lowResolutionStream", subUrl);
      // Keep main for recording streams — full quality when triggered
      await device.putSetting("prebuffer:recordingStream", mainUrl);
      await device.putSetting("prebuffer:remoteRecordingStream", subUrl);
      console.log(`  ✓ ${cam.name} — prebuffer → sub`);
    } catch (e) {
      console.log(`  ✗ ${cam.name} — ${e.message}`);
    }
  }

  console.log("\nDone. Restart Scrypted to apply changes.");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
