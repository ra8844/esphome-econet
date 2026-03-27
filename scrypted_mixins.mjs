/**
 * Scrypted mixin repair script for existing camera devices.
 *
 * Use this on a running Scrypted install when cameras already exist but the
 * mixin chain or HomeKit pairing state needs to be repaired.
 *
 * Run via SSH:
 *   scp scrypted_mixins.mjs sn@192.168.5.87:/tmp/
 *   ssh sn@192.168.5.87 'PATH=/opt/homebrew/opt/node@20/bin:$PATH node /tmp/scrypted_mixins.mjs'
 *
 * What this does:
 *   1. Enables developer mode on Video Analysis Plugin
 *   2. Applies Video Analysis Plugin as a mixin to CoreML Object Detection
 *   3. Re-applies the expected RTSP camera mixins:
 *        Rebroadcast + WebRTC + Snapshot + HomeKit + CoreML
 *   4. Resets HomeKit accessory state for RTSP cameras so they can be re-paired
 *      with the corrected capabilities in the Home app
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
  if (!entry) {
    throw new Error("Unable to locate @scrypted/client under ~/.npm/_npx.");
  }

  return entry;
}

const { connectScryptedClient } = await import(findClientEntry());

const RTSP_CAMERA_NAMES = [
  "Master Bathroom Camera 1",
  "Master Bathroom Camera 2",
  "Master Bedroom Camera 1",
  "Hallway Camera 1",
  "Hallway Camera 2",
  "Kitchen Camera 1",
  "Kitchen Camera 2",
  "Office Camera",
  "Living Room Camera",
  "Front Door Camera",
];

function readLogin() {
  const loginPath = path.join(os.homedir(), ".scrypted", "login.json");
  const login = JSON.parse(fs.readFileSync(loginPath, "utf8"));
  const entry = login["127.0.0.1:10443"];
  if (!entry?.username || !entry?.token) {
    throw new Error(`Missing 127.0.0.1:10443 credentials in ${loginPath}.`);
  }

  return entry;
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

  const rebroadcast = sm.getDeviceByName("Rebroadcast Plugin");
  const snapshot = sm.getDeviceByName("Snapshot Plugin");
  const webrtc = sm.getDeviceByName("WebRTC Plugin");
  const homekit = sm.getDeviceByName("HomeKit");
  const coreml = sm.getDeviceByName("CoreML Object Detection");
  const objectDetector = sm.getDeviceByName("Video Analysis Plugin");

  for (const device of [rebroadcast, snapshot, webrtc, homekit, coreml, objectDetector]) {
    if (!device) {
      throw new Error("Required plugin device not found.");
    }
  }

  console.log("Enabling Video Analysis developer mode and linking it to CoreML ...");
  await objectDetector.putSetting("developerMode", true);
  await coreml.setMixins([objectDetector.id]);

  console.log("Re-applying RTSP camera mixins and resetting HomeKit accessories ...");
  for (const name of RTSP_CAMERA_NAMES) {
    const camera = sm.getDeviceByName(name);
    if (!camera) {
      console.log(`  ✗ ${name} — not found`);
      continue;
    }

    await camera.setMixins([
      rebroadcast.id,
      webrtc.id,
      snapshot.id,
      homekit.id,
      coreml.id,
    ]);
    await camera.putSetting("homekit:standalone", true);
    await camera.putSetting("homekit:resetAccessory", "RESET");
    console.log(`  ✓ ${name}`);
  }

  console.log("\n=== Done ===");
  console.log("Next step: remove/re-add the RTSP cameras in Home using the HomeKit PIN shown in Scrypted.");

  sdk.disconnect();
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal:", error.message);
  process.exit(1);
});
