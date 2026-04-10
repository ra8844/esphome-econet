/**
 * Scrypted Motion Webhook Setup Script
 *
 * For each RTSP camera:
 *   1. Creates a dummy switch configured as a MotionSensor with 30s auto-reset
 *   2. Adds Webhook mixin to the dummy switch
 *   3. Links the dummy switch to the camera via Custom Motion Sensor mixin
 *   4. Prints the webhook turnOn URL to paste into each camera's HTTP alarm setting
 *
 * The Custom Motion Sensor mixin adds MotionSensor to the camera's interfaces,
 * which enables HomeKit Secure Video recording.
 *
 * Run via SSH:
 *   scp scrypted_motion_webhooks.mjs sn@192.168.1.85:/tmp/
 *   ssh sn@192.168.1.85 'PATH=/opt/homebrew/opt/node@20/bin:$PATH node /tmp/scrypted_motion_webhooks.mjs'
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

// RTSP cameras to set up motion webhooks for
const CAMERAS = [
  "Living Room Camera",
  "Front Door Camera",
  "Master Bathroom Camera 1",
  "Master Bathroom Camera 2",
  "Master Bedroom Camera 1",
  "Hallway Camera 1",
  "Hallway Camera 2",
  "Kitchen Camera 1",
  "Kitchen Camera 2",
  "Office Camera",
  "Garage Camera 1",  // Eufy — device is named "Garage Camera 1" in Scrypted
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

  // Find required plugins
  const webhookPlugin       = sm.getDeviceByName("Webhook Plugin") || sm.getDeviceByName("Webhook");
  const dummySwitchPlugin   = sm.getDeviceByName("Dummy Switch Plugin") || sm.getDeviceByName("Dummy Switch");
  const replaceMotionPlugin = sm.getDeviceByName("Custom Motion Sensor");

  if (!webhookPlugin)       throw new Error("Webhook plugin not found — install @scrypted/webhook");
  if (!dummySwitchPlugin)   throw new Error("Dummy Switch plugin not found — install @scrypted/dummy-switch");
  if (!replaceMotionPlugin) throw new Error("Custom Motion Sensor not found — it is a child device of Dummy Switch plugin");

  console.log(`Webhook plugin id:       ${webhookPlugin.id}`);
  console.log(`Dummy Switch plugin id:  ${dummySwitchPlugin.id}`);
  console.log(`Custom Motion Sensor id: ${replaceMotionPlugin.id}`);
  console.log();

  const networkBase = `http://192.168.1.85:10080/endpoint/@scrypted/webhook/public`;

  console.log("=== Setting up motion webhooks ===\n");

  for (const cameraName of CAMERAS) {
    const camera = sm.getDeviceByName(cameraName);
    if (!camera) {
      console.log(`  ✗ ${cameraName} — camera not found, skipping`);
      continue;
    }

    const motionName = `${cameraName} Motion`;
    let motionSwitch = sm.getDeviceByName(motionName);

    // 1. Create dummy switch if it doesn't exist
    if (!motionSwitch) {
      console.log(`  Creating dummy switch "${motionName}" ...`);
      let id;
      try {
        id = await dummySwitchPlugin.createDevice({ name: motionName });
      } catch (e) {
        console.log(`  ✗ ${cameraName} — createDevice failed: ${e.message}`);
        continue;
      }
      console.log(`  Created id=${id}, waiting for device to initialize ...`);
      await sleep(8000);
      motionSwitch = sm.getDeviceById(id);
      if (!motionSwitch) {
        console.log(`  ✗ ${cameraName} — device id=${id} not found after creation`);
        continue;
      }
    } else {
      console.log(`  Dummy switch "${motionName}" already exists (id=${motionSwitch.id})`);
    }

    // 2. Configure as MotionSensor with 30s auto-reset
    try {
      await motionSwitch.putSetting("sensorTypes", ["MotionSensor"]);
      await motionSwitch.putSetting("reset", 30);
    } catch (e) {
      console.log(`  ! Could not configure sensorTypes/reset: ${e.message} — configure manually`);
    }
    await sleep(500);

    // 3. Add Webhook mixin to the dummy switch
    try {
      const switchMixins = [...(motionSwitch.mixins || [])];
      if (!switchMixins.includes(webhookPlugin.id)) {
        await motionSwitch.setMixins([...switchMixins, webhookPlugin.id]);
        await sleep(1500);
      }
    } catch (e) {
      console.log(`  ! Webhook mixin error: ${e.message}`);
    }

    // 4. Read webhook token from mixin storage
    let token;
    try {
      const webhookStorage = sdk.deviceManager.getMixinStorage(motionSwitch.id, webhookPlugin.nativeId);
      token = webhookStorage?.getItem("token");
    } catch (e) {}

    // 5. Add Custom Motion Sensor mixin to the camera
    try {
      const cameraMixins = [...(camera.mixins || [])];
      if (!cameraMixins.includes(replaceMotionPlugin.id)) {
        await camera.setMixins([...cameraMixins, replaceMotionPlugin.id]);
        await sleep(1500);
      }
    } catch (e) {
      console.log(`  ! Custom Motion Sensor mixin error: ${e.message}`);
    }

    // 6. Link dummy switch → camera
    try {
      await camera.putSetting("replaceMotionSensor:replaceMotionSensor", motionSwitch.id);
    } catch (e) {
      console.log(`  ! Link error: ${e.message}`);
    }
    await sleep(500);

    // Print results
    console.log(`  ✓ ${cameraName} (id=${camera.id}) → "${motionName}" (id=${motionSwitch.id})`);
    if (token) {
      console.log(`    Webhook: ${networkBase}/${motionSwitch.id}/${token}/turnOn`);
    } else {
      console.log(`    Webhook token not found — check dummy switch console in Scrypted UI`);
      console.log(`    Pattern: ${networkBase}/${motionSwitch.id}/<token>/turnOn`);
    }
    console.log();
  }

  console.log("=== Done ===");
  console.log("Paste each webhook URL into the camera's web UI:");
  console.log("  Hipcam: http://<camera-ip>:81 → Alarm → Motion Detection → HTTP URL");
  console.log("  Method: GET, no auth needed");

  sdk.disconnect();
  process.exit(0);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
