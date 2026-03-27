/**
 * Scrypted Camera Setup Script
 *
 * Adds all cameras to fresh native Scrypted install on Mac Mini M1.
 * Run via SSH: PATH=/opt/homebrew/opt/node@20/bin:$PATH node /tmp/scrypted_setup.mjs
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
//
// FUTURE: If @apocaliss92/scrypted-reolink-native adds session-count limits or
// the camera firmware is updated to raise its Baichuan session cap, the camera
// can be moved back to reolink-native. See commented-out block in REOLINK_CAMERAS.
//
// go2rtc streams must be added to go2rtc.yaml BEFORE running this script:
//   garage_outside_camera_main: rtsp://admin:<password>@192.168.5.84:554/h264Preview_01_main
//   garage_outside_camera_sub:  rtsp://admin:<password>@192.168.5.84:554/h264Preview_01_sub
const GARAGE_OUTSIDE_CAMERA = {
  name: "Garage Outside Camera",
  url:  "rtsp://192.168.5.87:8554/garage_outside_camera_main",
  sub:  "rtsp://192.168.5.87:8554/garage_outside_camera_sub",
};

const REOLINK_CAMERAS = [
  // ── Reolink doorbells (direct to camera via reolink-native, no go2rtc) ────
  // Baichuan protocol: instant doorbell press events, two-way audio.
  // AAC audio natively — no transcoding needed. Motion via camera onboard AI.
  // Doorbell models have a standard 2-channel layout (main + sub) so Baichuan
  // session count stays well within camera limits — no overflow issue.
  { name: "Courtyard Doorbell",      ip: "192.168.5.141" },
  { name: "Backyard Doorbell",       ip: "192.168.5.74" },
  { name: "Garage Outside Doorbell", ip: "192.168.5.163" },

  // ── Garage Outside Camera — DISABLED (see above for why) ──────────────────
  // Uncomment when reolink-native Baichuan session overflow is resolved:
  // { name: "Garage Outside Camera", ip: "192.168.5.84" },
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
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

  const rtspPlugin    = sm.getDeviceByName("RTSP Camera Plugin");
  const reolinkPlugin = sm.getDeviceByName("Reolink Camera Plugin");
  const reolinkNative = sm.getDeviceByName("Reolink Native");

  if (!rtspPlugin)    throw new Error("RTSP Camera Plugin not found — is @scrypted/rtsp installed?");
  if (!reolinkPlugin) throw new Error("Reolink Camera Plugin not found — is @scrypted/reolink installed?");
  if (!reolinkNative) throw new Error("Reolink Native not found — is @apocaliss92/scrypted-reolink-native installed?");

  console.log(`RTSP Plugin ID: ${rtspPlugin.id}`);
  console.log(`Reolink Plugin ID: ${reolinkPlugin.id}`);
  console.log(`Reolink Native ID: ${reolinkNative.id}\n`);

  // ── Add RTSP cameras (Hipcam + Wyze via go2rtc) ───────────────────────────
  console.log("=== Adding RTSP cameras (Hipcam + Wyze via go2rtc) ===");
  for (const cam of RTSP_CAMERAS) {
    try {
      const id = await rtspPlugin.createDevice({ name: cam.name, url: cam.url });
      // createDevice does not persist the URL into settings — must set explicitly as array
      const device = sm.getDeviceById(id);
      await device.putSetting("urls", [cam.url]);
      await sleep(10000); // plugin needs ~10s to process each URL change
      // go2rtc JPEG snapshot: decouples snapshots from Scrypted's prebuffer —
      // go2rtc caches the last frame independently so snapshots stay valid during
      // prebuffer restarts (prevents black snapshot flashes in HomeKit).
      const streamName = cam.url.split("/").pop();
      await device.putSetting("snapshot:snapshotUrl", `http://192.168.5.87:1984/api/stream.jpeg?src=${streamName}`);
      await device.putSetting("snapshot:snapshotsFromPrebuffer", "Disabled");
      console.log(`  ✓ ${cam.name}  (id=${id})`);
    } catch (e) {
      console.log(`  ✗ ${cam.name}  — ${e.message}`);
    }
  }

  // ── Add Garage Outside Camera (@scrypted/reolink via go2rtc) ──────────────
  // Uses go2rtc for stream stability + VideoToolbox transcoding for HomeKit.
  // See GARAGE_OUTSIDE_CAMERA comment block above for full explanation.
  console.log("\n=== Adding Garage Outside Camera (@scrypted/reolink via go2rtc) ===");
  try {
    const id = await reolinkPlugin.createDevice({ name: GARAGE_OUTSIDE_CAMERA.name });
    const device = sm.getDeviceById(id);
    await device.putSetting("urls", [GARAGE_OUTSIDE_CAMERA.url]);
    await sleep(10000);

    // Add go2rtc sub stream as a synthetic stream for remote/low-res use
    await device.putSetting("prebuffer:synthenticStreams", [
      GARAGE_OUTSIDE_CAMERA.url,
      GARAGE_OUTSIDE_CAMERA.sub,
    ]);
    await sleep(2000);

    // Route all stream roles to go2rtc URLs
    const main = GARAGE_OUTSIDE_CAMERA.url;
    const sub  = GARAGE_OUTSIDE_CAMERA.sub;
    await device.putSetting("prebuffer:enabledStreams",        [main]);
    await device.putSetting("prebuffer:defaultStream",         main);
    await device.putSetting("prebuffer:remoteStream",          sub);
    await device.putSetting("prebuffer:lowResolutionStream",   sub);
    await device.putSetting("prebuffer:recordingStream",       main);
    await device.putSetting("prebuffer:remoteRecordingStream", sub);

    // VideoToolbox transcoding: camera outputs 2560x1440 H.264 High 5.1
    // (profile-level-id=640033) which HomeKit does not accept.
    // Scale to 1920x1080 and force High 4.0 (640028) via Apple GPU encoder.
    await device.putSetting(`prebuffer:rtspParser-${main}`,            "FFmpeg (TCP)");
    await device.putSetting(`prebuffer:ffmpegInputArguments-${main}`,  "-hwaccel videotoolbox");
    await device.putSetting(`prebuffer:ffmpegOutputArguments-${main}`, "-vf scale=1920:1080 -c:v h264_videotoolbox -b:v 4000k -profile:v high -level:v 4.0 -realtime 1 -c:a copy");

    // Link synthetic streams to native stream codec metadata
    await device.putSetting(`prebuffer:syntheticInputIdKey-${main}`, "h264Preview_01_main");
    await device.putSetting(`prebuffer:syntheticInputIdKey-${sub}`,  "h264Preview_01_sub");

    // Use go2rtc JPEG snapshot API instead of prebuffer snapshot.
    // go2rtc keeps a persistent RTSP connection to the camera and caches the last frame.
    // When Scrypted's FFmpeg pipeline restarts, go2rtc still serves the last good JPEG —
    // preventing the black snapshot that appears during the FFmpeg restart window.
    await device.putSetting("snapshot:snapshotUrl", "http://192.168.5.87:1984/api/stream.jpeg?src=garage_outside_camera_main");
    await device.putSetting("snapshot:snapshotsFromPrebuffer", "Disabled");

    await sleep(500);
    console.log(`  ✓ Garage Outside Camera  (id=${id})`);
  } catch (e) {
    console.log(`  ✗ Garage Outside Camera  — ${e.message}`);
  }

  // ── Add Reolink doorbells (@apocaliss92/scrypted-reolink-native, direct) ──
  // Also configures VideoToolbox transcoding prebuffer settings immediately after creation.
  // Doorbells output H.264 High 5.1 (profile-level-id=640033, 2560x1920) which HomeKit
  // does not support (HomeKit max = High 4.0 / 640028). Without this, HomeKit logs
  // "h264 undefined" and kills sessions at 30s.
  //
  // Fix: force the RTSP main stream through FFmpeg VideoToolbox to scale + re-encode
  // to 1280x960 High 4.0 @ 2Mbps.
  //
  // Key format: setting suffix is "h264Preview_01_main" (the RTSP stream path ID),
  // NOT "RTSP main" (the display name). Wrong key = setting silently ignored.
  //
  // reolink-native bypasses FFmpeg for Baichuan/Native streams (channel_0_main/sub/ext).
  // Only the RTSP main stream uses FFmpeg. Baichuan still handles audio, events, doorbell press.
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

      // Configure VideoToolbox transcoding for HomeKit via RTSP main stream.
      const device = sm.getDeviceById(id);
      await device.putSetting("prebuffer:enabledStreams",  ["RTSP main"]);
      await device.putSetting("prebuffer:defaultStream",   "RTSP main");
      await device.putSetting("prebuffer:remoteStream",    "RTSP main");
      await device.putSetting("prebuffer:recordingStream", "RTSP main");
      await sleep(1000);
      await device.putSetting(`prebuffer:rtspParser-${DOORBELL_RTSP_KEY}`,            "FFmpeg (TCP)");
      await device.putSetting(`prebuffer:ffmpegInputArguments-${DOORBELL_RTSP_KEY}`,  "-hwaccel videotoolbox");
      await device.putSetting(`prebuffer:ffmpegOutputArguments-${DOORBELL_RTSP_KEY}`, "-vf scale=1280:960 -c:v h264_videotoolbox -b:v 2000k -profile:v high -level:v 4.0 -realtime 1 -c:a copy");
      // Doorbells are direct (no go2rtc) — use camera's HTTP JPEG snapshot API directly.
      const pass = process.env.REOLINK_PASSWORD || "<reolink-password>";
      await device.putSetting("snapshot:snapshotUrl", `http://${cam.ip}/cgi-bin/api.cgi?cmd=Snap&channel=0&user=admin&password=${encodeURIComponent(pass)}`);
      await device.putSetting("snapshot:snapshotsFromPrebuffer", "Disabled");
      await sleep(500);
    } catch (e) {
      console.log(`  ✗ ${cam.name}  — ${e.message}`);
    }
  }

  console.log("\n=== Done ===");
  console.log("Next steps (in Scrypted UI https://192.168.5.87:10443):");
  console.log("  1. For each Hipcam + Wyze camera: add mixins → Rebroadcast, Snapshot, Video Analysis (CoreML), HomeKit");
  console.log("  2. In Video Analysis mixin: set Detection Model = CoreML");
  console.log("  3. Garage Outside Camera: add mixins → Rebroadcast, Snapshot, HomeKit");
  console.log("  4. For each Reolink doorbell: add mixins → Rebroadcast, Snapshot, HomeKit");
  console.log("     (Prebuffer VideoToolbox transcoding settings are pre-applied by this script)");
  console.log("  5. Pair HomeKit bridge in Home app");

  sdk.disconnect();
  process.exit(0);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
