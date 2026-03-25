# Home Camera Strategy

## Overview

Cameras are split across two systems:
- **Home Assistant (HA)** — motion/event recording, automations, entity sensors
- **Scrypted** — HomeKit Secure Video (HKSV), HomeKit streaming, hardware transcoding

**go2rtc** runs natively on the Mac Mini (`192.168.5.87`) as a stream rebroadcaster and protocol bridge between cameras and HA/Scrypted.

---

## Architecture

```
Camera Hardware
      │
      ├─── Reolink cameras/doorbells ──► HA Reolink Integration (native HTTP API)
      │                                        │
      │                                        └─► Scrypted (Reolink Native Plugin)
      │                                                  │
      │                                                  └─► HomeKit (HKSV + doorbell + 2-way audio)
      │
      ├─── Generic ONVIF cameras ──────► go2rtc (ONVIF source → RTSP rebroadcast)
      │           (port 8080)          │       │
      │                                │       └─► HA (RTSP stream for dashboard/recorder)
      │                                │
      │                                └─► Scrypted (ONVIF Plugin, direct to camera)
      │                                          │
      │                                          └─► HomeKit (HKSV + motion via ONVIF events)
      │
      ├─── Wyze cameras ───────────────► go2rtc (wyze:// native protocol → RTSP)
      │                                        │
      │                                        └─► Scrypted (RTSP Plugin via go2rtc)
      │                                                  │
      │                                                  └─► HomeKit (HKSV, no motion events)
      │
      └─── Eufy garage camera ─────────► go2rtc (RTSP source)
                                               │
                                               └─► Scrypted (RTSP Plugin)
                                                         │
                                                         └─► HomeKit (HKSV)
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

**HA Integration:** Native Reolink integration (Settings → Integrations → Reolink)
- Provides: motion, person, vehicle, pet, visitor detection entities
- Provides: PTZ control, siren, floodlight entities
- No go2rtc needed — HA pulls RTSP directly from cameras

**Scrypted:** `@apocaliss92/scrypted-reolink-native` plugin
- Provides: HKSV recording, doorbell press notifications, two-way audio in Home app
- Each doorbell is a standalone HomeKit accessory

**HomeKit pairing PINs (standalone accessories):**

| Camera | PIN |
|--------|-----|
| Garage Outside Camera | 916-43-845 |
| Garage Outside Doorbell | 438-56-023 |
| Backyard Doorbell | 446-65-337 |
| Courtyard Doorbell | 496-82-756 |

---

### Generic ONVIF Cameras (8 total)

Brand: GF-PH200 / Hipcam

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

**Scrypted:** `@scrypted/onvif` plugin — connects directly to camera at port 8080
- Provides native ONVIF motion events → HKSV trigger
- Scrypted device IDs: 166–173
- All have Rebroadcast + Snapshot + HomeKit mixins
- All set to standalone HomeKit accessory mode

**Known limitations:**
- Two-way audio is disabled by manufacturer (firmware-locked, paid upgrade)
- ONVIF implementation is partial (hikwsd/hikxsd namespace variant)
- `@scrypted/objectdetector` (Video Analysis Plugin) is NOT compatible — use ONVIF native motion events instead

**HomeKit pairing PINs (standalone accessories):**

| Camera | PIN |
|--------|-----|
| Master Bathroom Camera 1 | 076-54-566 |
| Master Bathroom Camera 2 | 580-22-883 |
| Hallway Camera 1 | 129-10-940 |
| Hallway Camera 2 | 421-75-664 |
| Kitchen Camera 1 | 011-22-419 |
| Kitchen Camera 2 | 507-01-574 |
| Master Bedroom Camera 1 | 818-40-773 |
| Office Camera | 388-12-043 |

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
- Scrypted IDs: 174 (Living Room), 175 (Front Door)
- Motion events: via MQTT (wyze-bridge publishes to `wyzebridge/<camera>/motion`)
- MQTT virtual devices: Living Room Motion (186), Front Door Motion (187)
- HKSV triggered by MQTT motion sensor

**HomeKit pairing PINs:**

| Camera | PIN |
|--------|-----|
| Living Room Camera | 778-23-725 |
| Front Door Camera | 224-80-183 |

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

- **Host:** Mac Mini (`192.168.5.87`)
- **Config:** `/Users/sn/docker/go2rtc.yaml`
- **Running as:** root (LaunchDaemon `/Library/LaunchDaemons/`)
- **Ports:** 1984 (Web UI/API), 8554 (RTSP), 8555 (WebRTC TCP/UDP)
- **Web UI:** `http://192.168.5.87:1984`
- **Restart:** `sudo kill $(pgrep -f go2rtc)` on Mac Mini (launchd restarts it automatically)

### Scrypted

- **Host:** Mac Mini (`192.168.5.87`)
- **Running as:** user (LaunchAgent)
- **Web UI:** `https://192.168.5.87:10443`
- **Plugins installed:**
  - `@scrypted/onvif` — generic ONVIF cameras
  - `@scrypted/rtsp` — Wyze via go2rtc
  - `@apocaliss92/scrypted-reolink-native` — Reolink doorbells + cameras
  - `@scrypted/homekit` — HomeKit bridge
  - `@scrypted/mqtt` — Wyze motion sensors (MQTT virtual devices)
  - `@scrypted/coreml` — Apple Silicon YOLOv9 object detection
  - `@scrypted/objectdetector` — Video Analysis Plugin
  - `@scrypted/webrtc` — WebRTC support
  - `@scrypted/prebuffer-mixin` (Rebroadcast) — prebuffering for HKSV
  - `@scrypted/snapshot` — snapshot support

**MQTT broker:** `192.168.5.182:1883`, username `snassar`

### Home Assistant

- **Host:** `192.168.5.182`
- **Camera integrations:**
  - Reolink (native) — 5 cameras/doorbells
  - go2rtc streams — generic cameras and Wyze via RTSP
- **Wyze integration:** entities unavailable — needs cleanup

---

## Motion Detection Strategy

| Camera Type | Motion Source | HKSV Trigger |
|-------------|--------------|--------------|
| Reolink | Reolink native plugin | ✅ Native events |
| Generic ONVIF | ONVIF native events (port 8080) | ✅ ONVIF motion |
| Wyze | MQTT via wyze-bridge (`wyzebridge/<cam>/motion`) | ✅ MQTT motion sensor |
| Eufy | TBD | TBD |

---

## Key Design Decisions

1. **Reolink not in go2rtc** — HA uses native Reolink HTTP API directly; go2rtc is unnecessary overhead for Reolink cameras.

2. **Generic cameras: dual connection** — go2rtc holds one ONVIF connection for HA; Scrypted holds a separate direct ONVIF connection for motion events + video. Slightly redundant but lightweight.

3. **ONVIF plugin over RTSP plugin in Scrypted** — Required for motion events. `@scrypted/objectdetector` (Video Analysis Plugin) is incompatible with RTSP-via-go2rtc cameras.

4. **Opus audio transcoding in go2rtc** — Generic cameras output PCMA/G.711 A-law audio which causes garbled playback in HomeKit. The `ffmpeg:#audio=opus` pipeline in go2rtc transcodes before Scrypted receives the stream.

5. **Cameras NOT in HA HomeKit bridge** — Scrypted provides better HKSV support, hardware transcoding (Apple Silicon), and prebuffering. HA HomeKit bridge is used for non-camera entities only (locks, lights, sensors, thermostats).

6. **Standalone HomeKit accessories** — Each Scrypted camera is configured with `homekit:standalone=true` and paired individually in Home app (not through HA bridge).
