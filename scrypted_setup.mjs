/**
 * Scrypted Camera Setup Script
 *
 * Adds all Scrypted-managed cameras to a fresh native Scrypted install on the
 * Mac Mini M1 and applies the required mixins for HomeKit Secure Video.
 *
 * All non-Reolink cameras route through go2rtc as the single RTSP producer.
 * Scrypted prebuffer consumes rtsp://localhost:8554/<stream> only —
 * never a direct camera connection. Motion detection via CoreML (M1 Neural Engine).
 *
 * Run via SSH:
 *   scp scrypted_setup.mjs sn@192.168.1.85:/tmp/
 *   ssh sn@192.168.1.85 'PATH=/opt/homebrew/opt/node@20/bin:$PATH node /tmp/scrypted_setup.mjs'
 *
 * Prerequisites:
 *   - Scrypted running natively at https://127.0.0.1:10443
 *   - ~/.scrypted/login.json present with valid token for 127.0.0.1:10443
 *   - go2rtc running with all streams configured (verify at http://192.168.1.85:1984)
 *   - Plugins installed: @scrypted/rtsp, @scrypted/reolink, @scrypted/homekit,
 *     @scrypted/coreml, @scrypted/objectdetector, @scrypted/webrtc,
 *     @scrypted/prebuffer-mixin, @scrypted/snapshot,
 *     @apocaliss92/scrypted-reolink-native
 *
 * After running:
 *   - Run scrypted_snapshots.mjs to apply snapshot URLs
 *   - Pair each camera in Home app using PIN shown in Scrypted UI
 *
 * See CAMERAS.md for full architecture documentation.
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

// All go2rtc-backed cameras: Wyze + Hipcam knockoffs + Eufy
// Scrypted RTSP plugin consumes go2rtc localhost streams.
// Motion detection: CoreML on M1 Neural Engine for all of these.
const RTSP_CAMERAS = [
  // ── Wyze cameras (wyze:// P2P → go2rtc → Scrypted + CoreML) ──────────────
  { name: "Living Room Camera",       main: "living_room_camera_main",       sub: "living_room_camera_sub" },
  { name: "Front Door Camera",        main: "front_door_camera_main",        sub: "front_door_camera_sub" },

  // ── Hipcam knockoff cameras (direct RTSP → go2rtc → Scrypted + CoreML) ───
  { name: "Master Bathroom Camera 1", main: "master_bathroom_camera_1_main", sub: "master_bathroom_camera_1_sub" },
  { name: "Master Bathroom Camera 2", main: "master_bathroom_camera_2_main", sub: "master_bathroom_camera_2_sub" },
  { name: "Master Bedroom Camera 1",  main: "master_bedroom_camera_1_main",  sub: "master_bedroom_camera_1_sub" },
  { name: "Hallway Camera 1",         main: "hallway_camera_1_main",         sub: "hallway_camera_1_sub" },
  { name: "Hallway Camera 2",         main: "hallway_camera_2_main",         sub: "hallway_camera_2_sub" },
  { name: "Kitchen Camera 1",         main: "kitchen_camera_1_main",         sub: "kitchen_camera_1_sub" },
  { name: "Kitchen Camera 2",         main: "kitchen_camera_2_main",         sub: "kitchen_camera_2_sub" },
  { name: "Office Camera",            main: "office_camera_main",            sub: "office_camera_sub" },

  // ── Eufy garage camera (RTSP → go2rtc → Scrypted + CoreML) ───────────────
  // NOTE: Verify Eufy IP in go2rtc.yaml before running — router may reassign it.
  { name: "Eufy Garage Camera 1",     main: "eufy_garage_camera_1_main",     sub: "eufy_garage_camera_1_sub" },

  // ── August front doorbell — ON HOLD (device unreachable 2026-03-27) ───────
  // Uncomment when RTSP connectivity is resolved.
  // { name: "Front Doorbell", main: "front_doorbell_main", sub: "front_doorbell_sub" },
];

// ── Garage Outside Camera — @scrypted/reolink direct to camera RTSP ─────────
// Cannot use reolink-native: RLC-823A 16X has too many channels, causes
// Baichuan session overflow and continuous reboot loop on the camera.
const GARAGE_OUTSIDE_CAMERA = {
  name:        "Garage Outside Camera",
  url:         "RTSP h264Preview_01_main",
  sub:         "RTSP h264Preview_01_sub",
  ip:          "192.168.5.84",
  mainRtspKey: "h264Preview_01_main",
  subRtspKey:  "h264Preview_01_sub",
};

// ── Reolink doorbells — @apocaliss92/scrypted-reolink-native direct ──────────
// Baichuan protocol: instant doorbell press, two-way audio, AI motion.
const REOLINK_CAMERAS = [
  { name: "Courtyard Doorbell",      ip: "192.168.5.141" },
  { name: "Backyard Doorbell",       ip: "192.168.5.74" },
  { name: "Garage Outside Doorbell", ip: "192.168.5.163" },
];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function applyRtspMixins(device, mixins) {
  const ids = [mixins.rebroadcast.id, mixins.webrtc.id, mixins.snapshot.id, mixins.homekit.id];
  if (mixins.coreml) ids.push(mixins.coreml.id);
  await device.setMixins(ids);
  await device.putSetting("homekit:standalone", true);
}

async function applyReolinkMixins(device, mixins) {
  await device.setMixins([mixins.rebroadcast.id, mixins.webrtc.id, mixins.snapshot.id, mixins.homekit.id]);
  await device.putSetting("homekit:standalone", true);
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
  const reolinkPlugin = sm.getDeviceByName("Reolink Camera Plugin");
  const reolinkNative = sm.getDeviceByName("Reolink Native");
  const rebroadcast   = sm.getDeviceByName("Rebroadcast Plugin");
  const snapshot      = sm.getDeviceByName("Snapshot Plugin");
  const webrtc        = sm.getDeviceByName("WebRTC Plugin");
  const homekit       = sm.getDeviceByName("HomeKit");
  const coreml        = sm.getDeviceByName("CoreML Object Detection");
  const objectDetector = sm.getDeviceByName("Video Analysis Plugin");

  for (const [name, d] of [
    ["RTSP Camera Plugin", rtspPlugin],
    ["Reolink Camera Plugin", reolinkPlugin],
    ["Reolink Native", reolinkNative],
    ["Rebroadcast Plugin", rebroadcast],
    ["Snapshot Plugin", snapshot],
    ["WebRTC Plugin", webrtc],
    ["HomeKit", homekit],
  ]) {
    if (!d) throw new Error(`${name} not found — is the plugin installed?`);
  }

  if (!coreml) console.warn("WARNING: CoreML not found — motion detection will be unavailable until installed.");
  if (coreml && objectDetector) {
    console.log("Enabling Video Analysis developer mode and linking to CoreML ...");
    await objectDetector.putSetting("developerMode", true);
    await coreml.setMixins([objectDetector.id]);
  }

  const mixins = { rebroadcast, snapshot, webrtc, homekit, coreml };

  console.log(`\n=== Adding RTSP cameras (via go2rtc at ${GO2RTC}) ===`);
  for (const cam of RTSP_CAMERAS) {
    const mainUrl = `rtsp://${GO2RTC}/${cam.main}`;
    const subUrl  = `rtsp://${GO2RTC}/${cam.sub}`;
    try {
      const id = await rtspPlugin.createDevice({ name: cam.name, url: mainUrl });
      const device = sm.getDeviceById(id);
      await sleep(8000);

      // RTSP plugin may not honour name in createDevice — set explicitly
      await device.putSetting("name", cam.name);
      await device.putSetting("urls", [mainUrl, subUrl]);
      await applyRtspMixins(device, mixins);
      await sleep(2000);

      await device.putSetting("prebuffer:defaultStream", mainUrl);
      await device.putSetting("prebuffer:lowResolutionStream", subUrl);
      await device.putSetting("prebuffer:remoteStream", subUrl);
      await device.putSetting("prebuffer:recordingStream", mainUrl);
      await device.putSetting("prebuffer:remoteRecordingStream", subUrl);

      // Snapshot from go2rtc JPEG API — set by scrypted_snapshots.mjs
      await device.putSetting("snapshot:snapshotUrl", `http://127.0.0.1:1984/api/frame.jpeg?src=${cam.main}`);
      await device.putSetting("snapshot:snapshotsFromPrebuffer", "Disabled");

      console.log(`  ✓ ${cam.name}  (id=${id})`);
    } catch (e) {
      console.log(`  ✗ ${cam.name}  — ${e.message}`);
    }
  }

  console.log("\n=== Adding Garage Outside Camera (@scrypted/reolink direct RTSP) ===");
  try {
    const id = await reolinkPlugin.createDevice({ name: GARAGE_OUTSIDE_CAMERA.name });
    const device = sm.getDeviceById(id);
    await sleep(10000);

    await applyReolinkMixins(device, mixins);
    await sleep(2000);

    await device.putSetting("prebuffer:synthenticStreams", []);
    const main = GARAGE_OUTSIDE_CAMERA.url;
    const sub  = GARAGE_OUTSIDE_CAMERA.sub;
    await device.putSetting("prebuffer:enabledStreams", [main]);
    await device.putSetting("prebuffer:defaultStream", main);
    await device.putSetting("prebuffer:remoteStream", sub);
    await device.putSetting("prebuffer:lowResolutionStream", sub);
    await device.putSetting("prebuffer:recordingStream", main);
    await device.putSetting("prebuffer:remoteRecordingStream", sub);

    await device.putSetting(`prebuffer:rtspParser-${GARAGE_OUTSIDE_CAMERA.mainRtspKey}`, "FFmpeg (TCP)");
    await device.putSetting(`prebuffer:ffmpegInputArguments-${GARAGE_OUTSIDE_CAMERA.mainRtspKey}`, "-hwaccel videotoolbox");
    await device.putSetting(`prebuffer:ffmpegOutputArguments-${GARAGE_OUTSIDE_CAMERA.mainRtspKey}`, "-vf scale=1920:1080 -c:v h264_videotoolbox -b:v 4000k -profile:v high -level:v 4.0 -realtime 1 -c:a copy");

    // Snapshot applied by scrypted_snapshots.mjs
    console.log(`  ✓ Garage Outside Camera  (id=${id})`);
  } catch (e) {
    console.log(`  ✗ Garage Outside Camera  — ${e.message}`);
  }

  console.log("\n=== Adding Reolink doorbells (direct via reolink-native) ===");
  const DOORBELL_RTSP_KEY = "h264Preview_01_main";
  for (const cam of REOLINK_CAMERAS) {
    try {
      const id = await reolinkNative.createDevice({
        name: cam.name,
        ip: cam.ip,
        username: "admin",
        password: process.env.REOLINK_PASSWORD || "<reolink-password>",
      });
      const device = sm.getDeviceById(id);
      await sleep(500);
      await applyReolinkMixins(device, mixins);
      await sleep(1000);

      await device.putSetting("prebuffer:enabledStreams", ["RTSP main"]);
      await device.putSetting("prebuffer:defaultStream", "RTSP main");
      await device.putSetting("prebuffer:remoteStream", "RTSP main");
      await device.putSetting("prebuffer:recordingStream", "RTSP main");
      await sleep(1000);
      await device.putSetting(`prebuffer:rtspParser-${DOORBELL_RTSP_KEY}`, "FFmpeg (TCP)");
      await device.putSetting(`prebuffer:ffmpegInputArguments-${DOORBELL_RTSP_KEY}`, "-hwaccel videotoolbox");
      await device.putSetting(`prebuffer:ffmpegOutputArguments-${DOORBELL_RTSP_KEY}`, "-vf scale=1280:960 -c:v h264_videotoolbox -b:v 2000k -profile:v high -level:v 4.0 -realtime 1 -c:a copy");

      // Snapshot applied by scrypted_snapshots.mjs
      console.log(`  ✓ ${cam.name}  (id=${id})`);
    } catch (e) {
      console.log(`  ✗ ${cam.name}  — ${e.message}`);
    }
  }

  console.log("\n=== Done ===");
  console.log("Next steps:");
  console.log("  1. Run scrypted_snapshots.mjs to apply snapshot URLs");
  console.log("  2. Pair each camera in the Home app using the PIN shown in Scrypted UI");

  sdk.disconnect();
  process.exit(0);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
