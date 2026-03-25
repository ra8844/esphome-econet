# Home Camera Strategy

## Overview

Cameras are split across two systems:
- **Home Assistant (HA)** — motion/event recording, automations, entity sensors, native Reolink integration
- **Scrypted** — HomeKit Secure Video (HKSV), HomeKit streaming, hardware transcoding, CoreML motion (Wyze + ONVIF)

**go2rtc** runs natively on the Mac Mini M1 (`192.168.5.87`) as a stream rebroadcaster and protocol bridge. It handles Wyze P2P (`wyze://`), ONVIF, and RTSP sources and rebroadcasts them as RTSP for HA and Scrypted.

**Scrypted** runs natively on the Mac Mini M1 as a LaunchAgent. It handles HomeKit Secure Video and uses CoreML (M1 Neural Engine) for Wyze motion detection on go2rtc RTSP streams.

**wyze-bridge is not used.** go2rtc handles Wyze P2P natively via `wyze://` and rebroadcasts as RTSP to both HA and Scrypted.

**@apocaliss92/scrypted-reolink-native** connects directly to Reolink cameras (not via go2rtc) for HKSV and HomeKit streaming.

---

## Architecture

```
Camera Hardware
      │
      ├─── Reolink cameras/doorbells ──────────────┬─► HA (native Reolink integration, direct)
      │                                             │         camera URL + motion/person/vehicle/PTZ
      │                                             │
      │                                             └─► Scrypted (Reolink Native Plugin, direct)
      │                                                       │
      │                                                       └─► HomeKit (HKSV + doorbell + 2-way audio)
      │
      ├─── Hipcam Knockoff cameras (port 8080) ──────► go2rtc (single producer — ONVIF → RTSP + Opus)
      │                                                       │
      │                                                       ├─► HA (WebRTC/RTSP for dashboard)
      │                                                       │
      │                                                       └─► Scrypted (RTSP Plugin)
      │                                                                 │
      │                                                                 ├─► CoreML (M1 Neural Engine)
      │                                                                 │         motion detection
      │                                                                 │
      │                                                                 └─► HomeKit (HKSV + motion)
      │
      ├─── Wyze cameras ───────────────────────────► go2rtc (wyze:// P2P → RTSP rebroadcast)
      │                                                       │
      │                                                       ├─► HA (RTSP stream for dashboard)
      │                                                       │
      │                                                       └─► Scrypted (RTSP Plugin)
      │                                                                 │
      │                                                                 ├─► CoreML (M1 Neural Engine)
      │                                                                 │         motion detection
      │                                                                 │
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

### Reolink Cameras (4 total)

| Camera | Location | Type | IP | Scrypted ID |
|--------|----------|------|----|-------------|
| Courtyard Doorbell | Front courtyard | Reolink Doorbell | 192.168.5.141 | 182 |
| Garage Outside Doorbell | Garage exterior | Reolink Doorbell | 192.168.5.163 | 179 |
| Backyard Doorbell | Backyard | Reolink Doorbell | 192.168.5.74 | 180 |
| Garage Outside Camera | Garage | Reolink PTZ | 192.168.5.84 | 178 |

**Credentials:** username `admin`, password `Egyptian1975`

**HA:** Native Reolink integration — connects directly to camera via camera URL + HTTP API
- Provides: camera entity (live stream), motion, person/vehicle/pet/visitor detection, PTZ control, siren, floodlight

**Scrypted:** `@apocaliss92/scrypted-reolink-native` plugin — connects **directly to camera** (not via go2rtc)
- Provides: HKSV recording, doorbell press notifications, two-way audio in Home app
- Each camera/doorbell is a standalone HomeKit accessory

**HomeKit pairing PINs (standalone accessories):**

| Camera | PIN |
|--------|-----|
| Garage Outside Camera | TBD (fresh install 2026-03-25) |
| Garage Outside Doorbell | TBD |
| Backyard Doorbell | TBD |
| Courtyard Doorbell | TBD |

---

### Hipcam Knockoff Cameras (8 total)

Brand: GF-PH200 / Hipcam (cheap ONVIF knockoff cameras)

| Camera | Location | IP | ONVIF Port | Scrypted ID |
|--------|----------|----|------------|-------------|
| Master Bathroom Camera 1 | Master bathroom | 192.168.5.174 | 8080 | 166 |
| Master Bathroom Camera 2 | Master bathroom | 192.168.5.142 | 8080 | 167 |
| Hallway Camera 1 | Hallway | 192.168.5.245 | 8080 | 171 |
| Hallway Camera 2 | Hallway | 192.168.5.248 | 8080 | 172 |
| Kitchen Camera 1 | Kitchen | 192.168.5.18 | 8080 | 169 |
| Kitchen Camera 2 | Kitchen | 192.168.5.53 | 8080 | 170 |
| Master Bedroom Camera 1 | Master bedroom | 192.168.5.236 | 8080 | 173 |
| Office Camera | Office | 192.168.5.55 | 8080 | 168 |

**Credentials:** username `admin`, password `egypt1`

**RTSP streams:**
- Main: `/11` (e.g. `rtsp://admin:egypt1@192.168.5.174:554/11`)
- Sub: `/12` (e.g. `rtsp://admin:egypt1@192.168.5.174:554/12`)

**go2rtc config (each camera):**
```yaml
master_bathroom_camera_1_main:
  - onvif://admin:egypt1@192.168.5.174:8080
  - ffmpeg:master_bathroom_camera_1_main#audio=opus
master_bathroom_camera_1_sub: rtsp://admin:egypt1@192.168.5.174:554/12
```
> Note: `ffmpeg:#audio=opus` transcodes from PCMA/G.711 A-law (garbled in HomeKit) to Opus.

**Scrypted:** `@scrypted/rtsp` plugin — connects to go2rtc RTSP rebroadcast (single producer)
- RTSP URLs: `rtsp://192.168.5.87:8554/<camera>_main` (Opus audio from go2rtc transcode)
- Motion: CoreML object detection (M1 Neural Engine) via `@scrypted/coreml` + `@scrypted/objectdetector` mixins
- go2rtc is single ONVIF connection to camera — protects cheap cameras from multiple connections
- Scrypted device IDs: TBD (fresh install 2026-03-25)
- All have Rebroadcast + Snapshot + HomeKit mixins
- All set to standalone HomeKit accessory mode

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
living_room_camera_main:
  - wyze://192.168.5.62?dtls=true&enr=gvnv3V%2FieXQ3b%2FTb&mac=D03F2798D5B3&model=HL_CAM3P&uid=Z6A8GPTL2HBJM1X1111A&quality=hd
  - ffmpeg:living_room_camera_main#audio=opus
living_room_camera_sub: wyze://...&quality=sd

front_door_camera_main:
  - wyze://192.168.5.177?dtls=true&enr=LXpAWo3xT%2Bs4ettg&mac=D03F27BCCA2D&model=HL_PAN3&uid=6LZN32SM98X9ULWF111A&quality=hd
  - ffmpeg:front_door_camera_main#audio=opus

ptz:
  front_door_camera_main:
    - wyze://192.168.5.177?dtls=true&enr=LXpAWo3xT%2Bs4ettg&mac=D03F27BCCA2D&model=HL_PAN3&uid=6LZN32SM98X9ULWF111A
```

**Scrypted:** `@scrypted/rtsp` plugin — connects to go2rtc RTSP rebroadcast
- RTSP URLs: `rtsp://192.168.5.87:8554/living_room_camera_main`, `rtsp://192.168.5.87:8554/front_door_camera_main`
- Scrypted IDs: TBD (fresh install 2026-03-25)
- Motion events: CoreML object detection (M1 Neural Engine) via `@scrypted/coreml` + `@scrypted/objectdetector` mixins
- HKSV triggered by CoreML motion — no MQTT, no wyze-bridge required

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
eufy_garage_camera_1_main: rtsp://Sharif_Nassar275:Egyptian_0221975@192.168.5.179/live0
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
- **Running as:** root (LaunchDaemon `/Library/LaunchDaemons/`)
- **Ports:** 1984 (Web UI/API), 8554 (RTSP), 8555 (WebRTC TCP/UDP)
- **Web UI:** `http://192.168.5.87:1984`
- **Restart:** `sudo kill $(pgrep -f go2rtc)` on Mac Mini (launchd restarts it automatically)

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
  - `@scrypted/rtsp` — ONVIF cameras (via go2rtc RTSP) + Wyze cameras (via go2rtc RTSP)
  - `@apocaliss92/scrypted-reolink-native` — Reolink cameras/doorbells (direct to camera, not via go2rtc)
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
| Reolink | HA native Reolink integration (person/vehicle/pet/visitor) | ✅ Scrypted reolink-native → HKSV | ✅ VideoToolbox — HKSV encode |
| Hipcam Knockoff | CoreML via go2rtc RTSP (M1 Neural Engine — dedicated, no CPU competition) | ✅ Scrypted RTSP + CoreML → HKSV | ✅ Neural Engine (motion) + VideoToolbox (HKSV encode) — parallel hardware |
| Wyze | CoreML via go2rtc RTSP (M1 Neural Engine — dedicated, no CPU competition) | ✅ Scrypted CoreML → HKSV | ✅ Neural Engine (motion) + VideoToolbox (HKSV encode) — parallel hardware |
| Eufy | TBD | TBD | TBD |

---

## Key Design Decisions

1. **Reolink: both HA and Scrypted connect directly (no go2rtc)** — HA native Reolink integration and Scrypted reolink-native plugin both connect directly to cameras. Reolink cameras output AAC audio natively — no audio transcoding needed, so go2rtc is not required. M1 VideoToolbox used by Scrypted for HKSV encoding same as all cameras.

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

5. **All HomeKit PINs regenerated** (new PINs — old PINs from previous Scrypted instance are invalid). Updated in this file.

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
