# Home Camera Strategy

## Overview

Cameras are split across two systems:
- **Home Assistant (HA)** — motion/event recording, automations, entity sensors, native Reolink integration
- **Scrypted** — HomeKit Secure Video (HKSV), HomeKit streaming, hardware transcoding, CoreML motion (Wyze + ONVIF)

**go2rtc** runs natively on the Mac Mini M1 (`192.168.5.87`) as a stream rebroadcaster and protocol bridge. It handles Wyze P2P (`wyze://`), ONVIF, and RTSP sources and rebroadcasts them as RTSP for HA and Scrypted.

**Scrypted** runs natively on the Mac Mini M1 as a LaunchAgent. It handles HomeKit Secure Video and uses CoreML (M1 Neural Engine) for Wyze/ONVIF motion detection on go2rtc RTSP streams.

**wyze-bridge is not used.** go2rtc handles Wyze P2P natively via `wyze://` and rebroadcasts as RTSP to both HA and Scrypted.

**@apocaliss92/scrypted-reolink-native** connects directly to Reolink doorbells (not via go2rtc) for HKSV, doorbell press events, and two-way audio.

**@scrypted/reolink** connects the Garage Outside Camera via go2rtc RTSP. See the Garage Outside Camera section below for why this camera cannot use reolink-native.

---

## Architecture

```
Camera Hardware
      │
      ├─── Reolink doorbells (3) ──────────────────┬─► HA (native Reolink integration, direct)
      │     Courtyard, Backyard,                    │         camera entity + motion/person/vehicle/PTZ
      │     Garage Outside Doorbell                 │
      │                                             └─► Scrypted (reolink-native plugin, direct)
      │                                                       │   Baichuan protocol — instant doorbell
      │                                                       │   press events, two-way audio
      │                                                       └─► HomeKit (HKSV + doorbell + 2-way audio)
      │
      ├─── Garage Outside Camera ──────────────────► go2rtc (persistent RTSP → local rebroadcast)
      │     RLC-823A 16X (192.168.5.84)                       │   Prevents RTSP reconnect delay after
      │     [uses @scrypted/reolink — see note]               │   ffmpeg crash (camera refuses 15-20s)
      │                                                        │
      │                                                        └─► Scrypted (@scrypted/reolink plugin)
      │                                                                  │   HTTP polling for AI motion
      │                                                                  │   FFmpeg VideoToolbox transcode
      │                                                                  │   2560x1440→1920x1080 (High 4.0)
      │                                                                  └─► HomeKit (HKSV + motion)
      │
      ├─── Hipcam Knockoff cameras (8) ───────────► go2rtc (single producer — ONVIF → RTSP + Opus)
      │                                                       │
      │                                                       ├─► HA (WebRTC/RTSP for dashboard)
      │                                                       │
      │                                                       └─► Scrypted (RTSP Plugin)
      │                                                                 │
      │                                                                 ├─► CoreML (M1 Neural Engine)
      │                                                                 │         motion detection
      │                                                                 └─► HomeKit (HKSV + motion)
      │
      ├─── Wyze cameras (2) ───────────────────────► go2rtc (wyze:// P2P → RTSP rebroadcast)
      │                                                       │
      │                                                       ├─► HA (RTSP stream for dashboard)
      │                                                       │
      │                                                       └─► Scrypted (RTSP Plugin)
      │                                                                 │
      │                                                                 ├─► CoreML (M1 Neural Engine)
      │                                                                 │         motion detection
      │                                                                 └─► HomeKit (HKSV + motion)
      │
      ├─── Eufy garage camera ─────────────────────► go2rtc (RTSP source)
      │         [Scrypted/HomeKit: pending]                   │
      │                                                       └─► Scrypted (RTSP Plugin) [pending]
      │
      └─── Front doorbell (August) ────────────────► go2rtc (RTSP source)
                [ON HOLD — connectivity issues]
```

---

## Camera Inventory

### Reolink Doorbells (3 total) — @apocaliss92/scrypted-reolink-native

| Camera | Location | IP | Scrypted ID |
|--------|----------|----|-------------|
| Courtyard Doorbell | Front courtyard | 192.168.5.141 | 48 |
| Backyard Doorbell | Backyard | 192.168.5.74 | 59 |
| Garage Outside Doorbell | Garage exterior | 192.168.5.163 | 53 |

**Credentials:** username `admin` (see local credentials store)

**HA:** Native Reolink integration — connects directly to camera
- Provides: camera entity, motion, person/vehicle/pet/visitor detection, siren, floodlight

**Scrypted:** `@apocaliss92/scrypted-reolink-native` — connects **directly to camera** via Baichuan protocol
- Baichuan push: instant doorbell press events (no polling delay)
- Two-way audio in Home app
- Motion/AI detection via camera onboard AI (person/vehicle/animal)
- Each doorbell is a standalone HomeKit accessory
- **Snapshot URL:** `http://<ip>/cgi-bin/api.cgi?cmd=Snap&channel=0&user=admin&password=<pass>` (camera HTTP API — doorbells are not via go2rtc)

**HomeKit video transcoding (VideoToolbox):**

Reolink doorbells output H.264 High 5.1 (`profile-level-id=640033`, 2560x1920). HomeKit's maximum
is High 4.0 (`640028`). Without transcoding, HomeKit logs `h264 undefined` and kills streaming
sessions at the 30-second timeout.

Fix: the Rebroadcast (prebuffer) mixin is configured to force the RTSP main stream through FFmpeg
with Apple VideoToolbox GPU encoding:
- Input: `rtsp://camera:554/h264Preview_01_main` via FFmpeg TCP
- Input args: `-hwaccel videotoolbox`
- Output args: `-vf scale=1280:960 -c:v h264_videotoolbox -b:v 2000k -profile:v high -level:v 4.0 -realtime 1 -c:a copy`
- Result: 1280x960 H.264 High 4.0 @ 2Mbps — HomeKit compatible

**Setting key format:** The prebuffer uses the RTSP path ID as the setting suffix (`h264Preview_01_main`),
**not** the display name (`RTSP main`). Using the wrong suffix causes the setting to be silently ignored.

**Baichuan streams unaffected:** reolink-native bypasses FFmpeg entirely for Baichuan/Native streams
(`channel_0_main/sub/ext`). Only the RTSP main stream uses FFmpeg. Doorbell press events, two-way
audio, and AI motion events continue via Baichuan uninterrupted.

These settings are automatically applied by `scrypted_setup.mjs` at camera creation time.

**HomeKit pairing PINs (standalone accessories):**

| Camera | PIN |
|--------|-----|
| Garage Outside Doorbell | TBD |
| Backyard Doorbell | TBD |
| Courtyard Doorbell | TBD |

---

### Garage Outside Camera — @scrypted/reolink via go2rtc

| Camera | Location | Model | IP | Scrypted ID |
|--------|----------|-------|----|-------------|
| Garage Outside Camera | Garage exterior | Reolink RLC-823A 16X | 192.168.5.84 | 75 |

**Credentials:** username `admin` (see local credentials store)

**HA:** Native Reolink integration — connects directly to camera

**Scrypted:** `@scrypted/reolink` plugin — connects via **go2rtc RTSP rebroadcast** (not direct to camera)
- go2rtc streams: `rtsp://192.168.5.87:8554/garage_outside_camera_main` / `_sub`
- Motion/AI detection via HTTP polling to camera port 80 (independent of RTSP video path)
- FFmpeg VideoToolbox transcoding: 2560x1440 H.264 High 5.1 → 1920x1080 H.264 High 4.0 for HomeKit
- **Snapshot URL:** `http://192.168.5.87:1984/api/stream.jpeg?src=garage_outside_camera_main` (go2rtc JPEG API — stays valid during FFmpeg restart windows)
- Standalone HomeKit accessory

**Why @scrypted/reolink instead of reolink-native:**

The RLC-823A 16X has a large number of channels (main, sub, ext, plus 16× optical zoom channel).
`@apocaliss92/scrypted-reolink-native` uses the Baichuan binary protocol, which opens multiple
concurrent sessions per camera (video, audio, motion, PTZ, AI events). The session count on this
camera exceeds the firmware's limit, causing it to enter a continuous reboot loop.

`@scrypted/reolink` uses RTMP/RTSP for video and HTTP polling for AI events, keeping the session
count within limits. Motion detection (person/vehicle/animal) continues to work via HTTP polling
to port 80 — this is independent of the RTSP video stream path.

**Why go2rtc instead of direct RTSP:**

The camera outputs 2560x1440 H.264 High 5.1 (`profile-level-id=640033`). HomeKit requires
H.264 High 4.0 (`profile-level-id=640028`) or lower. Scrypted must transcode via ffmpeg
(`h264_videotoolbox` on M1 GPU). After any ffmpeg crash, the camera refuses new RTSP connections
on port 554 for 15-20 seconds while cleaning up the previous session. HomeKit's 30-second session
timeout expires during this reconnect window. go2rtc maintains a persistent RTSP connection to
the camera and rebroadcasts locally — ffmpeg reconnects to go2rtc in milliseconds rather than
waiting for the camera.

**Future:** If reolink-native adds Baichuan session-count limits or the camera firmware raises
its session cap, this camera can move to reolink-native. The commented-out entry in
`scrypted_setup.mjs` (`REOLINK_CAMERAS`) documents how to do this.

**HomeKit pairing PIN:**

| Camera | PIN |
|--------|-----|
| Garage Outside Camera | TBD |

---

### Hipcam Knockoff Cameras (8 total)

Brand: GF-PH200 / Hipcam (cheap ONVIF knockoff cameras)

| Camera | Location | IP | ONVIF Port | Scrypted ID |
|--------|----------|----|------------|-------------|
| Master Bathroom Camera 1 | Master bathroom | 192.168.5.174 | 8080 | 38 |
| Master Bathroom Camera 2 | Master bathroom | 192.168.5.142 | 8080 | 39 |
| Master Bedroom Camera 1 | Master bedroom | 192.168.5.236 | 8080 | 40 |
| Hallway Camera 1 | Hallway | 192.168.5.245 | 8080 | 41 |
| Hallway Camera 2 | Hallway | 192.168.5.248 | 8080 | 42 |
| Kitchen Camera 1 | Kitchen | 192.168.5.18 | 8080 | 43 |
| Kitchen Camera 2 | Kitchen | 192.168.5.64 | 8080 | 44 |
| Office Camera | Office | 192.168.5.55 | 8080 | 45 |

**Credentials:** username `admin` (see local credentials store)

**RTSP streams:**
- Main: `/11` (e.g. `rtsp://admin:<password>@192.168.5.174:554/11`)
- Sub: `/12` (e.g. `rtsp://admin:<password>@192.168.5.174:554/12`)

**go2rtc config — camera-specific sources:**

| Camera | go2rtc source | Reason |
|--------|--------------|--------|
| Master Bathroom 1 & 2 | `ffmpeg:rtsp://...554/11#video=copy#audio=copy` | Firmware bug: `profile-level-id=000001` in SDP — ffmpeg reads actual bitstream SPS and regenerates correct SDP (`420032` = Baseline Level 5.0) |
| Hallway 1 & 2 | `ffmpeg:rtsp://...554/11#video=copy#audio=copy` | ONVIF connection was timing out intermittently |
| Kitchen 1 & 2, Master Bedroom, Office | `onvif://admin:<password>@<ip>:8080` | ONVIF working correctly, no issues |

```yaml
# Cameras with firmware SDP bug or ONVIF timeout — use ffmpeg source:
master_bathroom_camera_1_main:
  - ffmpeg:rtsp://admin:<password>@192.168.5.174:554/11#video=copy#audio=copy
  - ffmpeg:master_bathroom_camera_1_main#audio=opus
master_bathroom_camera_1_sub: rtsp://admin:<password>@192.168.5.174:554/12

# Cameras with working ONVIF — leave as-is:
kitchen_camera_1_main:
  - onvif://admin:<password>@192.168.5.18:8080
  - ffmpeg:kitchen_camera_1_main#audio=opus
kitchen_camera_1_sub: rtsp://admin:<password>@192.168.5.18:554/12
```
> Note: `ffmpeg:#audio=opus` transcodes from PCMA/G.711 A-law (garbled in HomeKit) to Opus.

> Note: `ffmpeg:rtsp://...#video=copy#audio=copy` requires ffmpeg to be in PATH for go2rtc's LaunchDaemon. See Infrastructure section.

**Scrypted:** `@scrypted/rtsp` plugin — connects to go2rtc RTSP rebroadcast (single producer)
- RTSP URLs: `rtsp://192.168.5.87:8554/<camera>_main` (Opus audio from go2rtc transcode)
- Motion: CoreML object detection (M1 Neural Engine) via `@scrypted/coreml` + `@scrypted/objectdetector` mixins
- go2rtc is single ONVIF connection to camera — protects cheap cameras from multiple connections
- Scrypted device IDs: see table above
- All have Rebroadcast + WebRTC + Snapshot + HomeKit + CoreML (ObjectDetector) mixins
- All set to standalone HomeKit accessory mode
- **Snapshot URL:** `http://192.168.5.87:1984/api/stream.jpeg?src=<camera>_main` (go2rtc JPEG API — see below)

**Snapshot source (go2rtc JPEG API):**

All Hipcam/Wyze cameras use go2rtc's JPEG snapshot API instead of Scrypted's prebuffer snapshot.
go2rtc maintains its own persistent connection to each camera and caches the latest frame independently
of Scrypted's FFmpeg pipeline — so snapshots remain valid during prebuffer restarts, preventing the
black flash in HomeKit that occurs when the prebuffer is rebuilding.

Snapshot URL pattern: `http://192.168.5.87:1984/api/stream.jpeg?src=<stream_name>`

| Camera | Snapshot URL |
|--------|-------------|
| Master Bathroom Camera 1 | `…?src=master_bathroom_camera_1_main` |
| Master Bathroom Camera 2 | `…?src=master_bathroom_camera_2_main` |
| Master Bedroom Camera 1 | `…?src=master_bedroom_camera_1_main` |
| Hallway Camera 1 | `…?src=hallway_camera_1_main` |
| Hallway Camera 2 | `…?src=hallway_camera_2_main` |
| Kitchen Camera 1 | `…?src=kitchen_camera_1_main` |
| Kitchen Camera 2 | `…?src=kitchen_camera_2_main` |
| Office Camera | `…?src=office_camera_main` |
| Living Room Camera | `…?src=living_room_camera_main` |
| Front Door Camera | `…?src=front_door_camera_main` |

Set automatically by `scrypted_setup.mjs`.

**Known limitations:**
- Two-way audio is disabled by manufacturer (firmware-locked, paid upgrade)
- ONVIF implementation is partial (hikwsd/hikxsd namespace variant)

**HomeKit pairing PINs (standalone accessories):**

| Camera | PIN |
|--------|-----|
| Master Bathroom Camera 1 | TBD (fresh install 2026-03-25) |
| Master Bathroom Camera 2 | TBD |
| Hallway Camera 1 | TBD |
| Hallway Camera 2 | TBD |
| Kitchen Camera 1 | TBD |
| Kitchen Camera 2 | TBD |
| Master Bedroom Camera 1 | TBD |
| Office Camera | TBD |

---

### Wyze Cameras (2 total)

| Camera | Location | IP | Model |
|--------|----------|----|-------|
| Living Room Camera | Living room | 192.168.5.62 | Wyze Cam v3 Pro (HL_CAM3P) |
| Front Door Camera | Front door | 192.168.5.177 | Wyze Cam Pan v3 (HL_PAN3) |

**go2rtc config:**
```yaml
# Living Room — wyze:// P2P (working, left as-is)
living_room_camera_main:
  - wyze://192.168.5.62?dtls=true&enr=gvnv3V%2FieXQ3b%2FTb&mac=D03F2798D5B3&model=HL_CAM3P&uid=Z6A8GPTL2HBJM1X1111A&quality=hd
  - ffmpeg:living_room_camera_main#audio=opus
living_room_camera_sub: wyze://...&quality=sd
living_room_camera_synology:
  - living_room_camera_main
  - ffmpeg:living_room_camera_main#audio=aac

# Front Door — using wyze:// P2P
front_door_camera_main:
  - wyze://192.168.5.177?dtls=true&enr=LXpAWo3xT%2Bs4ettg&mac=D03F27BCCA2D&model=HL_PAN3&uid=6LZN32SM98X9ULWF111A&quality=hd
  - ffmpeg:front_door_camera_main#audio=opus
front_door_camera_sub: wyze://...&quality=sd
front_door_camera_synology:
  - front_door_camera_main
  - ffmpeg:front_door_camera_main#audio=aac
```

> Note: The `_synology` variants are for Surveillance Station. They keep H.264 video and transcode audio to AAC. The existing main Wyze streams remain Opus for Scrypted/HomeKit.

**Scrypted:** `@scrypted/rtsp` plugin — connects to go2rtc RTSP rebroadcast
- RTSP URLs: `rtsp://192.168.5.87:8554/living_room_camera_main`, `rtsp://192.168.5.87:8554/front_door_camera_main`
- Scrypted IDs: 46 (Living Room Camera), 47 (Front Door Camera)
- Motion events: CoreML object detection (M1 Neural Engine) via `@scrypted/coreml` + `@scrypted/objectdetector` mixins
- HKSV triggered by CoreML motion — no MQTT, no wyze-bridge required

**Synology Surveillance Station:**
- RTSP URLs: `rtsp://192.168.5.87:8554/living_room_camera_synology`, `rtsp://192.168.5.87:8554/front_door_camera_synology`
- Use H.264 video with AAC audio

**HomeKit pairing PINs:**

| Camera | PIN |
|--------|-----|
| Living Room Camera | TBD (fresh install 2026-03-25) |
| Front Door Camera | TBD |

---

### Eufy Garage Camera (1 total)

| Camera | Location | IP |
|--------|----------|----|
| Eufy Garage Camera 1 | Garage interior | 192.168.5.179 |

**go2rtc config:**
```yaml
eufy_garage_camera_1_main: rtsp://admin:<password>@192.168.5.179/live0
```

**Scrypted:** `@scrypted/rtsp` plugin — **not yet added** (pending)

---

### Front Doorbell (August / 3rd party)

| Camera | Location | IP |
|--------|----------|----|
| Front Doorbell | Front door | 192.168.5.91 |

**go2rtc config:**
```yaml
front_doorbell_main: rtsp://192.168.5.91:554/live/stream0
front_doorbell_sub: rtsp://192.168.5.91:554/live/stream
```

**Status: ON HOLD** — connectivity issues; needs investigation before adding to Scrypted/HomeKit

---

## Infrastructure

### go2rtc

- **Host:** Mac Mini M1 (`192.168.5.87`)
- **Config:** `/Users/sn/docker/go2rtc.yaml`
- **Running as:** root (LaunchDaemon `/Library/LaunchDaemons/com.go2rtc.plist`)
- **Ports:** 1984 (Web UI/API), 8554 (RTSP), 8555 (WebRTC TCP/UDP)
- **Web UI:** `http://192.168.5.87:1984`
- **Restart:** `curl -X POST http://localhost:1984/api/restart` (or `sudo launchctl unload/load /Library/LaunchDaemons/com.go2rtc.plist`)
- **ffmpeg PATH:** `/opt/homebrew/bin` added to LaunchDaemon environment via `EnvironmentVariables` in plist — required for `ffmpeg:rtsp://` sources
- **Keepalive:** `~/Library/LaunchAgents/com.go2rtc.keepalive.plist` runs `~/go2rtc-keepalive.sh` — maintains persistent ffmpeg connections to all 10 Hipcam + Wyze cameras so they stay awake and go2rtc stays connected

**Adding ffmpeg PATH to go2rtc LaunchDaemon** (required once after fresh install):
```bash
sudo /usr/libexec/PlistBuddy -c "Add :EnvironmentVariables dict" /Library/LaunchDaemons/com.go2rtc.plist
sudo /usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:PATH string /opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" /Library/LaunchDaemons/com.go2rtc.plist
sudo launchctl unload /Library/LaunchDaemons/com.go2rtc.plist
sudo launchctl load /Library/LaunchDaemons/com.go2rtc.plist
```

**Installing the keepalive LaunchAgent** (required once after fresh install):
```bash
launchctl load ~/Library/LaunchAgents/com.go2rtc.keepalive.plist
```

### Scrypted

- **Host:** Mac Mini M1 (`192.168.5.87`)
- **Running as:** Native macOS LaunchAgent (`~/Library/LaunchAgents/com.scrypted.plist`)
- **Node.js:** `/opt/homebrew/opt/node@20/bin/node` (v20 LTS)
- **Install dir:** `~/.scrypted/`
- **Volume:** `~/.scrypted/volume/`
- **Web UI:** `https://192.168.5.87:10443`
- **Logs:** `/tmp/scrypted.log`
- **Restart:** `launchctl stop com.scrypted` (launchd auto-restarts due to KeepAlive)
- **Plugins installed:**
  - `@scrypted/rtsp` — Hipcam ONVIF cameras (via go2rtc RTSP) + Wyze cameras (via go2rtc RTSP)
  - `@scrypted/reolink` — Garage Outside Camera (via go2rtc RTSP; reolink-native causes Baichuan session overflow on this model)
  - `@apocaliss92/scrypted-reolink-native` — Reolink doorbells (direct to camera, Baichuan push for instant doorbell events)
  - `@scrypted/homekit` — HomeKit bridge
  - `@scrypted/coreml` — Apple Silicon CoreML / M1 Neural Engine object detection (Wyze + ONVIF motion)
  - `@scrypted/objectdetector` — Video Analysis Plugin (paired with CoreML for Wyze + ONVIF)
  - `@scrypted/webrtc` — WebRTC support
  - `@scrypted/prebuffer-mixin` (Rebroadcast) — prebuffering for HKSV
  - `@scrypted/snapshot` — snapshot support

> **Not installed:** `@scrypted/mqtt` (not needed — Wyze motion handled by CoreML, not MQTT)

### wyze-bridge

**Not used.** Docker container exists but is stopped and not started at boot.
- go2rtc handles all Wyze video via `wyze://` P2P protocol natively
- Scrypted CoreML handles Wyze motion detection
- wyze-bridge Docker image retained for reference only

### Home Assistant

- **Host:** `192.168.5.182`
- **Camera integrations:**
  - Reolink (native) — 5 cameras/doorbells
  - go2rtc streams — generic cameras and Wyze via RTSP
- **Wyze integration:** entities unavailable — needs cleanup

---

## Motion Detection Strategy

| Camera Type | Motion Source | HomeKit / HKSV | M1 GPU |
|-------------|--------------|----------------|--------|
| Reolink doorbells | Camera onboard AI via Baichuan push (person/vehicle/pet/visitor, instant) | ✅ reolink-native → HKSV | ✅ VideoToolbox — HKSV encode |
| Garage Outside Camera | Camera onboard AI via HTTP polling port 80 (person/vehicle/animal) | ✅ @scrypted/reolink → HKSV | ✅ VideoToolbox — transcode + HKSV encode |
| Hipcam Knockoff | CoreML via go2rtc RTSP (M1 Neural Engine — dedicated, no CPU competition) | ✅ Scrypted RTSP + CoreML → HKSV | ✅ Neural Engine (motion) + VideoToolbox (HKSV encode) — parallel hardware |
| Wyze | CoreML via go2rtc RTSP (M1 Neural Engine — dedicated, no CPU competition) | ✅ Scrypted CoreML → HKSV | ✅ Neural Engine (motion) + VideoToolbox (HKSV encode) — parallel hardware |
| Eufy | TBD | TBD | TBD |

---

## Key Design Decisions

1. **Reolink doorbells: direct connection (no go2rtc)** — HA native Reolink integration and Scrypted reolink-native plugin both connect directly to the doorbells. Reolink cameras output AAC audio natively — no audio transcoding needed. Baichuan protocol gives instant doorbell press events and two-way audio. Doorbell models have a simple 2-channel layout that stays within Baichuan session limits.

1a. **Garage Outside Camera (RLC-823A 16X): go2rtc + @scrypted/reolink** — This specific camera model cannot use reolink-native because its many channels (main/sub/ext/16× zoom) push the Baichuan session count over the firmware limit, causing a reboot loop. Uses `@scrypted/reolink` (HTTP + RTSP) instead. go2rtc is required because the camera's H.264 High 5.1 output must be transcoded to High 4.0 for HomeKit and the direct RTSP reconnect delay after ffmpeg crashes exceeds HomeKit's session timeout. See the Garage Outside Camera section for full details.

2. **Hipcam Knockoff: go2rtc as single producer** — go2rtc makes one ONVIF connection per camera, transcodes PCMA → Opus (CPU, via ffmpeg), rebroadcasts RTSP to both HA (WebRTC) and Scrypted (RTSP plugin). One connection protects cheap cameras from multiple simultaneous connections. go2rtc on M1 handles all 8 cameras efficiently.

3. **CoreML for ONVIF motion (preferred over native ONVIF events)** — Scrypted uses RTSP plugin (via go2rtc) + CoreML for motion. Three reasons: (1) **Quality** — CoreML detects person/vehicle/animal vs cameras' basic pixel-change (high false positives). (2) **Dedicated hardware** — CoreML runs on the M1 Neural Engine, a separate 16-core silicon block that does not compete with CPU (go2rtc, audio transcode) or VideoToolbox (HKSV encode) — it runs in parallel at no cost to other workloads. (3) **Less CPU** — native ONVIF motion polling is HTTP/SOAP on CPU cores, competing with go2rtc and audio transcoding. Neural Engine sits idle without CoreML — using it here is free performance.

4. **CoreML for Wyze motion** — Wyze cameras have no accessible native motion event API. go2rtc pulls video via `wyze://` P2P and rebroadcasts as RTSP. Scrypted pulls those RTSP streams and runs CoreML (M1 Neural Engine) for person/vehicle/animal detection. Eliminates wyze-bridge entirely.

5. **Opus audio transcoding in go2rtc (ONVIF + Wyze)** — ONVIF cameras output PCMA/G.711 A-law; Wyze also transcoded. go2rtc transcodes once via `ffmpeg:#audio=opus` — both HA and Scrypted receive Opus. No duplicate transcoding.

6. **Cameras NOT in HA HomeKit bridge** — Scrypted provides better HKSV support, hardware transcoding (Apple Silicon), and prebuffering. HA HomeKit bridge is used for non-camera entities only (locks, lights, sensors, thermostats).

7. **Standalone HomeKit accessories** — Each Scrypted camera is configured with `homekit:standalone=true` and paired individually in Home app (not through HA bridge).

---

## Session Log: 2026-03-24 — Full Scrypted Rebuild

### What Happened

Scrypted's LevelDB database was corrupted after a forced process kill (`launchctl kickstart -k`) mid-write. Multiple repair attempts (`ClassicLevel.repair()`) each stripped more data. Eventually all camera devices and plugin state were lost.

**Resolution:** Clean slate — backed up the broken DB, wiped it, and rebuilt everything from scratch.

### What Was Rebuilt

1. **Plugins reinstalled** (manually via Scrypted UI):
   - `@scrypted/onvif` — generic ONVIF cameras
   - `@scrypted/rtsp` — Wyze cameras via go2rtc
   - `@apocaliss92/scrypted-reolink-native` — Reolink doorbells + cameras
   - `@scrypted/homekit` — HomeKit bridge
   - `@scrypted/mqtt` — Wyze motion sensors (MQTT virtual devices)
   - `@scrypted/coreml` — Apple Silicon object detection
   - `@scrypted/objectdetector` — Video Analysis Plugin
   - `@scrypted/webrtc` — WebRTC support
   - `@scrypted/prebuffer-mixin` (Rebroadcast)
   - `@scrypted/snapshot`

2. **All 14 cameras re-added** with correct plugin, credentials, and RTSP/ONVIF URLs sourced from `/Users/sn/docker/go2rtc.yaml` and HA Reolink integration.

3. **Mixins applied** to all cameras: HomeKit (standalone), Rebroadcast, Snapshot.

4. **MQTT motion sensors recreated** with `template: "motion-sensor.ts"` — required to get `MotionSensor` interface. Previously created without template, giving only `DeviceProvider,Settings` and no script.

5. **All HomeKit PINs regenerated** (new PINs — old PINs from the previous Scrypted instance became invalid).

### Key Lessons

- **Never use `launchctl kickstart -k` on Scrypted** — it kills mid-write and corrupts LevelDB. Use Scrypted UI restart or `launchctl stop` instead.
- **MQTT motion sensor devices** must be created with `template: "motion-sensor.ts"` in the `createDevice` call.
- **RTSP camera URL setting key** is `urls` (plural), not `url`.
- **ONVIF `createDevice`** needs `{ip, httpPort:"8080", username, password}` and benefits from `skipValidate:true` to avoid per-camera timeout.
- **HomeKit PINs** are only available after `homekit:standalone=true` is set and the mixin initializes (~30s).
- **Wyze motion (superseded)** — previously used wyze-bridge MQTT. Now handled by CoreML in Scrypted (see 2026-03-25 session).

### Recovery Sources Used

- **ONVIF camera IPs**: `/Users/sn/docker/go2rtc.yaml` on Mac Mini
- **Reolink camera IPs**: HA Reolink integration API (`192.168.5.182`)
- **Wyze go2rtc streams**: `/Users/sn/docker/go2rtc.yaml`

---

## Session Log: 2026-03-25 — Full Programmatic Setup (Fresh Native Scrypted)

### What Was Done

Complete programmatic setup of native Scrypted on Mac Mini M1. Camera creation and mixin setup are scripted; Home app pairing still remains a manual step.

1. **Admin account created** via HTTP POST `/login` — returned short API token
2. **CLI auth** — wrote token to `~/.scrypted/login.json` to allow `npx scrypted install` without TTY
3. **8 plugins installed** via `npx scrypted install <plugin> 127.0.0.1`
4. **All 14 cameras added** via `@scrypted/client` SDK (`createDevice()` on RTSP and Reolink plugin devices)
5. **All mixins applied** programmatically:
   - RTSP cameras: Rebroadcast + WebRTC + Snapshot + HomeKit + CoreML
   - Reolink cameras: Rebroadcast + WebRTC + Snapshot + HomeKit [native AI motion]
6. **CoreML applied to RTSP cameras** via discovered two-step process:
   - Enable `developerMode` on Video Analysis Plugin — unlocks `canMixin` for `ObjectDetection` devices
   - Apply Video Analysis Plugin as a mixin to CoreML Object Detection → CoreML gains `MixinProvider`
   - Apply CoreML Object Detection as a mixin to each RTSP camera → cameras gain `ObjectDetector`

### Key Technical Discovery

The Video Analysis Plugin does NOT directly mixin cameras. Its architecture:
- `canMixin` on Video Analysis Plugin only accepts `ObjectDetection` devices (with `developerMode` or `ObjectDetectionGenerator`)
- When applied to CoreML Object Detection, its `getMixin` creates an `I` instance with `canMixin` for Camera/Doorbell type
- CoreML then gains `MixinProvider` interface and can be applied to cameras
- Cameras receive `ObjectDetector` (+ `MotionSensor` only if model has "motion" class — CoreML object detection doesn't)

### Device IDs (example install)

Device IDs are install-specific and can change after a fresh install, plugin reinstall,
or repair workflow. Use device names in scripts where possible.

| Device | ID | Plugin |
|--------|----|--------|
| RTSP Camera Plugin | 1 | @scrypted/rtsp |
| Rebroadcast | 2 | @scrypted/prebuffer-mixin |
| Snapshot | 3 | @scrypted/snapshot |
| WebRTC | 7 | @scrypted/webrtc |
| CoreML Object Detection | 8 | @scrypted/coreml |
| Video Analysis Plugin | 83 | @scrypted/objectdetector |
| HomeKit | 10 | @scrypted/homekit |
| Reolink Native | 11 | @apocaliss92/scrypted-reolink-native |
| Master Bathroom Camera 1 | 38 | |
| Master Bathroom Camera 2 | 39 | |
| Master Bedroom Camera 1 | 40 | |
| Hallway Camera 1 | 41 | |
| Hallway Camera 2 | 42 | |
| Kitchen Camera 1 | 43 | |
| Kitchen Camera 2 | 44 | |
| Office Camera | 45 | |
| Living Room Camera (Wyze) | 46 | |
| Front Door Camera (Wyze) | 47 | |
| Courtyard Doorbell (Reolink) | 48 | @apocaliss92/scrypted-reolink-native |
| Garage Outside Doorbell (Reolink) | 53 | @apocaliss92/scrypted-reolink-native |
| Backyard Doorbell (Reolink) | 59 | @apocaliss92/scrypted-reolink-native |
| Reolink Camera Plugin | 74 | @scrypted/reolink |
| Garage Outside Camera | 75 | @scrypted/reolink |

### Remaining Manual Steps After Fresh Setup

- [ ] Pair each camera in Home app (get PIN from Scrypted UI → camera → Extensions → HomeKit)
- [ ] Remove Docker Scrypted and wyze-bridge containers once confirmed working
- [ ] Verify HomeKit recording options after pairing or re-pairing RTSP cameras

---

## Session Log: 2026-03-25 — Migrate Scrypted Docker → Native + CoreML for Wyze

### What Changed

1. **Scrypted migrated from Docker to native macOS LaunchAgent** — enables M1 Neural Engine access for CoreML (not available inside Docker on macOS).

2. **wyze-bridge Docker container eliminated** — was only used for Wyze motion events via MQTT. Replaced by CoreML in Scrypted.

3. **Wyze motion detection now uses CoreML** — Scrypted pulls Wyze RTSP streams from go2rtc and runs `@scrypted/coreml` + `@scrypted/objectdetector` for person/vehicle/animal detection directly on M1 Neural Engine.

4. **`@scrypted/mqtt` plugin removed** — no longer needed.

### Wyze Motion Flow (new)

```
Wyze Camera → go2rtc (wyze:// P2P) → RTSP rtsp://192.168.5.87:8554/<cam>_main
                                              │
                                        Scrypted RTSP Plugin
                                              │
                                        CoreML + ObjectDetector mixin
                                        (M1 Neural Engine — person/vehicle/animal)
                                              │
                                        HomeKit motion event → HKSV trigger
```

### Migration Notes

- **LevelDB incompatibility**: Docker Scrypted (Linux arm64) LevelDB database is not compatible with native macOS arm64 LevelDB. Fresh DB required — all devices and plugins must be re-added via Scrypted UI.
- **Plugin binaries**: Linux arm64 plugin binaries cannot run on macOS native. Scrypted reinstalls all plugins for macOS on first run from fresh volume.
- **Scrypted install command**: `npx -y scrypted@latest install-server` (run with Node 20 from Homebrew: `/opt/homebrew/opt/node@20/bin/npx`)

### Recovery Sources (same as before)

- **ONVIF camera IPs**: `/Users/sn/docker/go2rtc.yaml` on Mac Mini
- **Reolink camera IPs**: HA Reolink integration (192.168.5.182)
- **Wyze RTSP URLs**: `rtsp://192.168.5.87:8554/living_room_camera_main`, `rtsp://192.168.5.87:8554/front_door_camera_main`

---

## Session Log: 2026-03-27 — Garage Outside Camera: reolink-native → @scrypted/reolink + go2rtc

### Problem

The Garage Outside Camera (Reolink RLC-823A 16X, 192.168.5.84) was stuck in a continuous reboot
loop when managed by `@apocaliss92/scrypted-reolink-native`. Root cause: the RLC-823A 16X has
many channels (main, sub, ext, plus 16× optical zoom channel), causing the Baichuan session
count to exceed the camera firmware's limit. The camera interprets this as an attack and reboots.

### Solution

1. **Switched to `@scrypted/reolink`** — uses RTMP/RTSP for video and HTTP polling for AI events,
   no Baichuan sessions. Reboot loop stopped immediately.

2. **Added camera to go2rtc** as `garage_outside_camera_main` / `_sub`. go2rtc maintains a
   persistent RTSP connection so Scrypted reconnects in milliseconds after any ffmpeg crash
   (vs 15-20s "Connection refused" when connecting directly to the camera).

3. **Configured FFmpeg VideoToolbox transcoding** — camera outputs 2560x1440 H.264 High 5.1
   (`profile-level-id=640033`). HomeKit requires High 4.0 max. FFmpeg output args set to:
   `-vf scale=1920:1080 -c:v h264_videotoolbox -b:v 4000k -profile:v high -level:v 4.0 -realtime 1 -c:a copy`

4. **All configuration done programmatically** via `@scrypted/client` SDK (no UI clicks).

### Key Technical Details

- **FU-A fragmentation fix**: RTSP parser set to "FFmpeg (TCP)" — Scrypted's native parser fails
  to reassemble large H.264 High profile NAL units from this camera's 2.5K stream.
- **Rebroadcast port 0**: Auto-assign prevents EADDRINUSE on port 49498 after plugin restart.
- **Synthetic streams**: go2rtc RTSP URLs added as `prebuffer:synthenticStreams` (note typo in
  Scrypted's API key). This makes them available in the stream selector dropdowns.
- **syntheticInputIdKey**: Maps go2rtc streams to native stream codec metadata so Scrypted knows
  the codec without probing the go2rtc URL separately.
- **Motion detection unaffected**: `@scrypted/reolink` polls `http://192.168.5.84:80` for AI
  events independently of the RTSP video path — switching to go2rtc for video does not change
  how motion/person/vehicle detection works.

### Scrypted Device IDs After This Change

Example from the repaired install:
- Old (reolink-native): Garage Outside Camera = ID 64 (deleted due to reboot loop)
- New (@scrypted/reolink): Reolink Camera Plugin = ID 74, Garage Outside Camera = ID 75

---

## Programmatic Setup — Scrypted API Access

All 14 cameras can be added to a fresh Scrypted install programmatically using the setup script in this repo (`scrypted_setup.mjs`). Existing installs can be repaired with `scrypted_mixins.mjs` if the RTSP camera mixin chain or HomeKit pairing state drifts.

### How It Works

Scrypted exposes an HTTP API at `https://127.0.0.1:10443` and a WebSocket API used by its JavaScript SDK (`@scrypted/client`). The SDK is bundled by `npx scrypted` into `~/.npm/_npx/`.

### Step-by-Step (fresh Scrypted install)

**1. Create admin account** (first-time only — no account exists yet):
```bash
curl -sk -X POST https://localhost:10443/login \
  -H "Content-Type: application/json" \
  -d '{"username":"snassar","password":"<password>","change_password":"<password>"}'
# → returns {"token":"<short-api-token>", ...}
```

**2. Authenticate the Scrypted CLI** (write token so `npx scrypted install` works without TTY):
```bash
# On Mac Mini, write to ~/.scrypted/login.json:
echo '{"127.0.0.1:10443":{"username":"snassar","token":"<token-from-step-1>"}}' > ~/.scrypted/login.json
```

**3. Install all plugins** (can run in parallel):
```bash
PATH=/opt/homebrew/opt/node@20/bin:$PATH
npx scrypted install @scrypted/rtsp 127.0.0.1
npx scrypted install @apocaliss92/scrypted-reolink-native 127.0.0.1
npx scrypted install @scrypted/homekit 127.0.0.1
npx scrypted install @scrypted/coreml 127.0.0.1
npx scrypted install @scrypted/objectdetector 127.0.0.1
npx scrypted install @scrypted/webrtc 127.0.0.1
npx scrypted install @scrypted/prebuffer-mixin 127.0.0.1
npx scrypted install @scrypted/snapshot 127.0.0.1
```

**4. Add all 14 cameras** using the setup script:
```bash
# From local machine:
scp scrypted_setup.mjs sn@192.168.5.87:/tmp/
ssh sn@192.168.5.87 'PATH=/opt/homebrew/opt/node@20/bin:$PATH node /tmp/scrypted_setup.mjs'
```

The script uses `@scrypted/client` (bundled by npx scrypted) to connect via WebSocket and call `createDevice()` on the RTSP and Reolink Native plugin devices.

**Client SDK path** (may change when `npx scrypted` updates — find with `find ~/.npm/_npx -name "index.js" -path "*/client/src/*"`):
```
~/.npm/_npx/<hash>/node_modules/@scrypted/client/dist/packages/client/src/index.js
```

### After Running the Script

The following is **now handled programmatically**:
1. ✅ All 14 cameras added with correct names
2. ✅ RTSP cameras: Rebroadcast + WebRTC + Snapshot + HomeKit + CoreML mixins
3. ✅ Reolink cameras: Rebroadcast + WebRTC + Snapshot + HomeKit + native AI motion
4. ✅ CoreML enabled by: (a) enable `developerMode` on Video Analysis Plugin, (b) apply Video Analysis Plugin as a mixin to CoreML Object Detection, (c) apply CoreML Object Detection as a mixin to each RTSP camera
5. ✅ Standalone HomeKit accessory mode enabled on each camera via `homekit:standalone=true`

Still required:
- **Home app pairing**: open `https://192.168.5.87:10443`, go to each camera → Extensions → HomeKit, copy the pairing PIN, add accessory in Home

### Repair Workflow for Existing Installs

If RTSP cameras were already paired in Home before the correct mixin chain was present, Home may continue to show them without HKSV until the accessory is reset and re-paired.

Use `scrypted_mixins.mjs` to repair an existing install:

```bash
scp scrypted_mixins.mjs sn@192.168.5.87:/tmp/
ssh sn@192.168.5.87 'PATH=/opt/homebrew/opt/node@20/bin:$PATH node /tmp/scrypted_mixins.mjs'
```

This script:
- Enables Video Analysis Plugin developer mode
- Applies Video Analysis Plugin to CoreML Object Detection
- Re-applies the correct RTSP camera mixins
- Resets the HomeKit accessory state for RTSP cameras so they can be re-added in Home

---

## Session Log: 2026-03-25 — go2rtc Camera Fixes

### Changes Made

#### 1. Kitchen Camera 2 IP corrected
- Old: `192.168.5.53` (wrong — camera was offline at that IP)
- New: `192.168.5.64`
- Fixed in `/Users/sn/docker/go2rtc.yaml`

#### 2. go2rtc LaunchDaemon PATH fix
go2rtc runs as root with no Homebrew in PATH. Added `EnvironmentVariables` to `/Library/LaunchDaemons/com.go2rtc.plist` so `/opt/homebrew/bin/ffmpeg` is accessible. Required for `ffmpeg:rtsp://` sources.

#### 3. Master Bathroom Cameras 1 & 2 — ffmpeg source
**Problem:** GF-PH200 firmware bug — `profile-level-id=000001` in RTSP SDP fmtp (invalid). go2rtc and Scrypted receive wrong codec metadata. Actual bitstream is correct (Baseline Level 5.0 = `420032`) but SDP says `000001`.

**Fix:** Switched from `onvif://` to `ffmpeg:rtsp://...554/11#video=copy#audio=copy`. ffmpeg reads the actual SPS from the bitstream and regenerates the SDP with correct `profile-level-id=420032`. Scrypted now sees valid codec metadata.

**Result:** go2rtc shows `profile: Baseline, level: 50` for both cameras.

#### 4. Hallway Cameras 1 & 2 — ffmpeg source
**Problem:** `onvif://` source was timing out intermittently (`connection timed out` in go2rtc logs). Cameras go into idle/sleep state when no clients connected.

**Fix:** Same as bathroom — `ffmpeg:rtsp://...554/11#video=copy#audio=copy`. Direct RTSP bypasses ONVIF handshake, more reliable on reconnect.

#### 5. Front Door Camera (Wyze Pan v3) — RTSP direct
**Problem:** `wyze://` P2P was failing with `discovery timeout` and `av login failed: context deadline exceeded`. Wyze P2P depends on cloud infrastructure which was intermittently unavailable.

**Fix:** Enabled RTSP on camera via Wyze app (Settings → Advanced Settings → RTSP). Switched go2rtc source to `ffmpeg:rtsp://ra8844:Egypti%40n1975@192.168.5.177:554/stream0#video=copy#audio=copy`.

**Why ffmpeg source:** Camera SDP sends audio as track 0 and video as track 1. go2rtc's native RTSP receiver only picks up audio in this case. ffmpeg handles reversed track order correctly.

**Result:** 1920x1080 H264 Main 20fps streaming via RTSP.

#### 6. Keepalive LaunchAgent
**Problem:** Hipcam cameras go into idle sleep when no RTSP clients connected. go2rtc uses lazy loading — only connects to cameras when Scrypted requests a stream. On wakeup, camera takes a few seconds to respond, causing initial timeout.

**Fix:** Created `~/go2rtc-keepalive.sh` — runs one persistent `ffmpeg` process per camera that reads from go2rtc's RTSP rebroadcast indefinitely (reconnects after 5s if dropped). Installed as user LaunchAgent (`~/Library/LaunchAgents/com.go2rtc.keepalive.plist`).

**Cameras covered:** All 8 Hipcam + Living Room Wyze + Front Door Wyze (10 total).

### Cameras Left on ONVIF (working fine, no changes needed)
- Kitchen Camera 1 & 2
- Master Bedroom Camera 1
- Office Camera

### Pending
- **August Doorbell** (192.168.5.91) — RTSP port 554 timing out, needs investigation
