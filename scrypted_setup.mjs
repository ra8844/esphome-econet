/**
 * Scrypted Camera Setup Script
 *
 * Adds all cameras to a fresh native Scrypted install on Mac Mini M1 and
 * applies the required mixins for HomeKit Secure Video.
 *
 * Run via SSH:
 *   PATH=/opt/homebrew/opt/node@20/bin:$PATH node /tmp/scrypted_setup.mjs
 *
 * Prerequisites:
 *   - Scrypted running natively at https://127.0.0.1:10443
 *   - Admin account created (see CAMERAS.md for credentials)
 *   - API token obtained via POST /login and stored in ~/.scrypted/login.json
 *   - All plugins installed via: npx scrypted install <plugin> 127.0.0.1
 *
 * Plugins required:
 *   @scrypted/rtsp, @scrypted/reolink, @scrypted/homekit, @scrypted/coreml
 *   @scrypted/objectdetector, @scrypted/webrtc, @scrypted/prebuffer-mixin
 *   @scrypted/snapshot, @apocaliss92/scrypted-reolink-native
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

// ── Garage Outside Camera — @scrypted/reolink via go2rtc ────────────────────
// Routes through go2rtc (rtsp://192.168.5.87:8554/garage_outside_camera_main)
// instead of directly to the camera (rtsp://192.168.5.84:554/...).
//
// WHY go2rtc is required for this camera (Reolink RLC-823A 16X):
//   The camera runs at 2560x1440 (H.264 High profile-level-id=640033 / High 5.1)
//   which HomeKit does not support. Scrypted must transcode to 1920x1080 at
//   profile-level-id=640028 (High 4.0) via h264_videotoolbox (Apple GPU).
//   After any ffmpeg crash, retrying the direct RTSP connection (port 554)
//   results in "Connection refused" for 15-20 seconds while the camera cleans
//   up the previous session — HomeKit's 30s session timeout expires during this
//   window. go2rtc maintains a persistent RTSP connection to the camera and
//   rebroadcasts locally, so Scrypted reconnects in milliseconds.
//
// WHY @scrypted/reolink instead of @apocaliss92/scrypted-reolink-native:
//   The reolink-native plugin uses the Baichuan binary protocol, which opens
//   multiple simultaneous sessions (video, audio, motion, PTZ) per camera.
//   The RLC-823A 16X has many channels (main, sub, ext, plus 16× zoom), pushing
//   the total Baichuan session count over the camera's limit, causing a
//   continuous reboot loop. @scrypted/reolink uses RTMP/RTSP + HTTP polling,
//   which avoids this session overflow entirely.
//   Motion/AI detection (person/vehicle/animal) continues to work via HTTP
//   polling to the camera's port 80 API — independent of the RTSP video path.
const GARAGE_OUTSIDE_CAMERA = {
  name: "Garage Outside Camera",
  url:  "rtsp://192.168.5.87:8554/garage_outside_camera_main",
  sub:  "rtsp://192.168.5.87:8554/garage_outside_camera_sub",
  ip:   "192.168.5.84",
};

const REOLINK_CAMERAS = [
  { name: "Courtyard Doorbell",      ip: "192.168.5.141" },
  { name: "Backyard Doorbell",       ip: "192.168.5.74" },
  { name: "Garage Outside Doorbell", ip: "192.168.5.163" },
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function applyRtspMixins(device, mixins) {
  await device.setMixins([
    mixins.rebroadcast.id,
    mixins.webrtc.id,
    mixins.snapshot.id,
    mixins.homekit.id,
    mixins.coreml.id,
  ]);
  await device.putSetting("homekit:standalone", true);
}

async function applyReolinkMixins(device, mixins) {
  await device.setMixins([
    mixins.rebroadcast.id,
    mixins.webrtc.id,
    mixins.snapshot.id,
    mixins.homekit.id,
  ]);
  await device.putSetting("homekit:standalone", true);
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
  const reolinkPlugin = sm.getDeviceByName("Reolink Camera Plugin");
  const reolinkNative = sm.getDeviceByName("Reolink Native");
  const rebroadcast = sm.getDeviceByName("Rebroadcast Plugin");
  const snapshot = sm.getDeviceByName("Snapshot Plugin");
  const webrtc = sm.getDeviceByName("WebRTC Plugin");
  const homekit = sm.getDeviceByName("HomeKit");
  const coreml = sm.getDeviceByName("CoreML Object Detection");
  const objectDetector = sm.getDeviceByName("Video Analysis Plugin");

  if (!rtspPlugin) throw new Error("RTSP Camera Plugin not found — is @scrypted/rtsp installed?");
  if (!reolinkPlugin) throw new Error("Reolink Camera Plugin not found — is @scrypted/reolink installed?");
  if (!reolinkNative) throw new Error("Reolink Native not found — is @apocaliss92/scrypted-reolink-native installed?");
  if (!rebroadcast) throw new Error("Rebroadcast Plugin not found — is @scrypted/prebuffer-mixin installed?");
  if (!snapshot) throw new Error("Snapshot Plugin not found — is @scrypted/snapshot installed?");
  if (!webrtc) throw new Error("WebRTC Plugin not found — is @scrypted/webrtc installed?");
  if (!homekit) throw new Error("HomeKit not found — is @scrypted/homekit installed?");
  if (!coreml) throw new Error("CoreML Object Detection not found — is @scrypted/coreml installed?");
  if (!objectDetector) throw new Error("Video Analysis Plugin not found — is @scrypted/objectdetector installed?");

  const mixins = { rebroadcast, snapshot, webrtc, homekit, coreml, objectDetector };

  console.log("Enabling Video Analysis developer mode and linking it to CoreML ...");
  await objectDetector.putSetting("developerMode", true);
  await coreml.setMixins([objectDetector.id]);

  console.log(`RTSP Plugin ID: ${rtspPlugin.id}`);
  console.log(`Reolink Plugin ID: ${reolinkPlugin.id}`);
  console.log(`Reolink Native ID: ${reolinkNative.id}\n`);

  console.log("=== Adding RTSP cameras (Hipcam + Wyze via go2rtc) ===");
  for (const cam of RTSP_CAMERAS) {
    try {
      const id = await rtspPlugin.createDevice({ name: cam.name, url: cam.url });
      const device = sm.getDeviceById(id);
      await device.putSetting("urls", [cam.url]);
      await sleep(10000);
      await applyRtspMixins(device, mixins);
      await sleep(2000);
      const streamName = cam.url.split("/").pop();
      await device.putSetting("snapshot:snapshotUrl", `http://192.168.5.87:1984/api/stream.jpeg?src=${streamName}`);
      await device.putSetting("snapshot:snapshotsFromPrebuffer", "Disabled");
      console.log(`  ✓ ${cam.name}  (id=${id})`);
    } catch (e) {
      console.log(`  ✗ ${cam.name}  — ${e.message}`);
    }
  }

  console.log("\n=== Adding Garage Outside Camera (@scrypted/reolink via go2rtc) ===");
  try {
    const id = await reolinkPlugin.createDevice({ name: GARAGE_OUTSIDE_CAMERA.name });
    const device = sm.getDeviceById(id);
    await device.putSetting("urls", [GARAGE_OUTSIDE_CAMERA.url]);
    await sleep(10000);

    await applyReolinkMixins(device, mixins);
    await sleep(2000);

    await device.putSetting("prebuffer:synthenticStreams", [
      GARAGE_OUTSIDE_CAMERA.url,
      GARAGE_OUTSIDE_CAMERA.sub,
    ]);
    await sleep(2000);

    const main = GARAGE_OUTSIDE_CAMERA.url;
    const sub = GARAGE_OUTSIDE_CAMERA.sub;
    await device.putSetting("prebuffer:enabledStreams", [main]);
    await device.putSetting("prebuffer:defaultStream", main);
    await device.putSetting("prebuffer:remoteStream", sub);
    await device.putSetting("prebuffer:lowResolutionStream", sub);
    await device.putSetting("prebuffer:recordingStream", main);
    await device.putSetting("prebuffer:remoteRecordingStream", sub);

    await device.putSetting(`prebuffer:rtspParser-${main}`, "FFmpeg (TCP)");
    await device.putSetting(`prebuffer:ffmpegInputArguments-${main}`, "-hwaccel videotoolbox");
    await device.putSetting(`prebuffer:ffmpegOutputArguments-${main}`, "-vf scale=1920:1080 -c:v h264_videotoolbox -b:v 4000k -profile:v high -level:v 4.0 -realtime 1 -c:a copy");

    await device.putSetting(`prebuffer:syntheticInputIdKey-${main}`, "h264Preview_01_main");
    await device.putSetting(`prebuffer:syntheticInputIdKey-${sub}`, "h264Preview_01_sub");

    const garageCamPass = encodeURIComponent(process.env.GARAGE_CAMERA_PASSWORD || "<garage-camera-password>");
    await device.putSetting("snapshot:snapshotUrl", `http://${GARAGE_OUTSIDE_CAMERA.ip}/cgi-bin/api.cgi?cmd=Snap&channel=0&user=admin&password=${garageCamPass}`);
    await device.putSetting("snapshot:snapshotsFromPrebuffer", "Disabled");

    await sleep(500);
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
      console.log(`  ✓ ${cam.name}  (id=${id})`);
      await sleep(500);

      const device = sm.getDeviceById(id);
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
      const pass = process.env.REOLINK_PASSWORD || "<reolink-password>";
      await device.putSetting("snapshot:snapshotUrl", `http://${cam.ip}/cgi-bin/api.cgi?cmd=Snap&channel=0&user=admin&password=${encodeURIComponent(pass)}`);
      await device.putSetting("snapshot:snapshotsFromPrebuffer", "Disabled");
      await sleep(500);
    } catch (e) {
      console.log(`  ✗ ${cam.name}  — ${e.message}`);
    }
  }

  console.log("\n=== Done ===");
  console.log("Next step (in Home app):");
  console.log("  Pair each camera using the HomeKit PIN from Scrypted.");

  sdk.disconnect();
  process.exit(0);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
