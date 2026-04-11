# Home Camera Strategy

## Overview

Cameras are split across three systems:
- **Scrypted** — HomeKit Secure Video (HKSV), HomeKit streaming, hardware transcoding
- **Frigate** — AI object detection on Mac Mini M1 (Docker, CoreML ZMQ detector), publishes motion to MQTT. Handles all cameras including Reolink.
- **Home Assistant (HA)** — automations, entity sensors, dashboard. Reolink integration connects **directly to cameras** for PTZ, two-way audio, siren/spotlight control — NOT used for motion (Frigate handles that).

**go2rtc is the single source of truth for all camera streams.** It runs natively on the Mac Mini M1 (`192.168.1.85`) as the only system that connects directly to cameras. All other systems (Frigate, Scrypted, HA) pull from go2rtc's RTSP rebroadcast — no system except go2rtc contacts cameras directly for video.

- **Wyze cameras**: go2rtc connects via `wyze://` DTLS P2P (one P2P session per camera, separate sessions for HD/SD subtypes)
- **Hipcam cameras**: go2rtc connects via direct RTSP (`/11` main, `/12` sub)
- **Reolink cameras**: go2rtc connects via direct RTSP (`h264Preview_01_main`, `h264Preview_01_sub`)
- **Eufy camera**: go2rtc connects via direct RTSP

**go2rtc keepalive** (`~/go2rtc-keepalive.sh`) holds all main and sub streams warm permanently so Frigate and Scrypted never see cold stream errors.

**Frigate** uses split streams from go2rtc per camera:
- **sub stream → `roles: [detect]`** — lower resolution, less CPU to decode, same detection accuracy. Connected continuously on all cameras.
- **main stream → `roles: [record]`** — full resolution footage saved to disk.
- **Outdoor cameras** (front_door, garage_outside_doorbell, garage_outside_camera, courtyard_doorbell, backyard_doorbell): continuous recording, fps 5. Main stream connected continuously.
- **Indoor cameras** (all others): event-only recording, fps 2. Main stream only opened by Frigate when a detection event triggers recording — dropped again after the post-record buffer expires. Sub stream stays connected continuously for detection.
- **Eufy garage camera**: no real sub stream — main used for both detect and record (event-only, fps 2).
- CoreML ZMQ detector runs on Apple Silicon. Motion events published to MQTT.

**Scrypted** pulls main streams from go2rtc RTSP rebroadcast for HomeKit Secure Video. Motion comes from Frigate → MQTT → `frigate_bridge.mjs` → dummy switch → Custom Motion Sensor mixin.

**Home Assistant** uses the native Reolink integration which connects **directly to Reolink cameras** (not via go2rtc) for PTZ, two-way audio, siren, and spotlight control. This is the only exception to the go2rtc-as-hub rule — HA does not use Reolink for motion (Frigate MQTT handles that).

**wyze-bridge is not used.** go2rtc handles Wyze P2P natively via `wyze://` DTLS.

**@apocaliss92/scrypted-reolink-native** connects directly to Reolink doorbells for HKSV, doorbell press events, and two-way audio.

**@scrypted/reolink** connects the Garage Outside Camera directly. See the Garage Outside Camera section below for why this camera cannot use reolink-native.

---

## Architecture

### Stream Flow

go2rtc is the **single hub** — the only system that opens connections to physical cameras. All consumers (Frigate, Scrypted, HA) pull from go2rtc RTSP rebroadcast.

```
Camera Hardware
      │
      ├─── Reolink doorbells (3) ──► go2rtc (RTSP h264Preview_01_main + sub → rebroadcast)
      │     Courtyard .141               │   keepalive holds main+sub warm
      │     Backyard .74                 ├─► Frigate — sub→detect (fps:5), main→record (continuous)
      │     Garage Outside .163          │         CoreML ZMQ → MQTT motion events
      │                                  ├─► Scrypted — reolink-native plugin (direct Baichuan, not go2rtc)
      │                                  │         instant doorbell press, two-way audio, HKSV
      │                                  └─► HA — native Reolink integration (direct to camera)
      │                                         PTZ, two-way audio, siren, spotlight (NOT motion)
      │
      ├─── Garage Outside Camera ──► go2rtc (RTSP h264Preview_01_main + sub → rebroadcast)
      │     RLC-823A 16X .84             ├─► Frigate — sub→detect (fps:5), main→record (continuous)
      │                                  ├─► Scrypted — @scrypted/reolink (direct to camera)
      │                                  │         VideoToolbox transcode → HKSV
      │                                  └─► HA — native Reolink integration (direct to camera)
      │                                         PTZ, siren, spotlight (NOT motion)
      │
      ├─── Hipcam cameras (8) ──────► go2rtc (RTSP /11 main + /12 sub → rebroadcast)
      │     Kitchen, Hallway,            │   keepalive holds main+sub warm
      │     Bathrooms, Bedroom,          ├─► Frigate — sub→detect (fps:2), main→record (event-only)
      │     Office                       │         CoreML ZMQ → MQTT → frigate_bridge → dummy switch
      │                                  └─► Scrypted — @scrypted/rtsp → go2rtc main
      │                                         dummy switch → Custom Motion Sensor → HKSV
      │
      ├─── Wyze cameras (2) ────────► go2rtc (wyze:// DTLS P2P → rebroadcast)
      │     Living Room .62              │   keepalive holds main+sub warm
      │     Front Door .177              ├─► Frigate — sub→detect, main→record
      │                                  │   Front Door: continuous fps:5 | Living Room: event-only fps:2
      │                                  └─► Scrypted — @scrypted/rtsp → go2rtc main
      │
      ├─── Eufy garage camera ──────► go2rtc (RTSP live0 → rebroadcast)
      │     .162                         │   keepalive holds main+sub warm
      │                                  └─► Frigate — sub→detect (fps:2), main→record (event-only)
      │
      └─── Front doorbell (August) ─► go2rtc (RTSP source)
                [ON HOLD — device unreachable 2026-03-27]
```

### go2rtc Connection Rule

```
Physical camera  ←── ONLY go2rtc connects here
go2rtc rebroadcast  ←── Frigate, Scrypted, HA dashboard pull from here
```

Exceptions (connect directly to camera, not via go2rtc for video):
- **Scrypted reolink-native** — Baichuan protocol (Reolink doorbells only)
- **Scrypted @scrypted/reolink** — Garage Outside Camera RTSP + HTTP polling
- **HA native Reolink integration** — PTZ/audio/siren control only

---

## Camera Inventory

### Reolink Doorbells (3 total) — @apocaliss92/scrypted-reolink-native

| Camera | Location | IP | Scrypted ID |
|--------|----------|----|-------------|
| Courtyard Doorbell | Front courtyard | 192.168.5.141 | 259 |
| Backyard Doorbell | Backyard | 192.168.5.74 | 265 |
| Garage Outside Doorbell | Garage exterior | needs new IP — wired to GS108T port 3, factory reset required to get VLAN 10 DHCP lease | 290 |

**Credentials:** username `admin` (see local credentials store)

**go2rtc:** RTSP rebroadcast via `h264Preview_01_main` / `h264Preview_01_sub`
- Stream names: `courtyard_doorbell_main/sub`, `backyard_doorbell_main/sub`, `garage_outside_doorbell_main/sub`

**Frigate:** split streams from go2rtc — sub→detect, main→record
- Outdoor Reolink doorbells: continuous recording, fps 5
- Detection: person/car/cat/dog via CoreML ZMQ
- Motion events published to MQTT → HA Frigate integration

**HA:** Native Reolink integration — connects **directly to cameras** for PTZ control, two-way audio, siren, spotlight
- Does NOT use go2rtc for video — direct camera connection only for control
- Motion detection from Reolink native is **redundant** — use Frigate motion entities instead

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

### Garage Outside Camera — @scrypted/reolink direct to camera

| Camera | Location | Model | IP | Scrypted ID |
|--------|----------|-------|----|-------------|
| Garage Outside Camera | Garage exterior | Reolink RLC-823A 16X | 192.168.5.84 | 75 |

**Credentials:** username `admin` (see local credentials store)

**go2rtc:** RTSP rebroadcast via `h264Preview_01_main` / `h264Preview_01_sub`
- Stream names: `garage_outside_camera_main/sub`

**Frigate:** split streams from go2rtc — sub→detect (fps:5), main→record (continuous)
- go2rtc holds both main and sub warm via keepalive

**HA:** Native Reolink integration — connects **directly to camera** for PTZ control, siren, spotlight
- Does NOT use go2rtc for video — direct camera connection only for control
- Motion detection from Reolink native is **redundant** — use Frigate motion entities instead

**Scrypted:** `@scrypted/reolink` plugin — connects directly to the camera RTSP profiles
- Streams: `RTSP h264Preview_01_main` / `RTSP h264Preview_01_sub`
- Motion/AI detection via HTTP polling to camera port 80 (independent of RTSP video path)
- FFmpeg VideoToolbox transcoding: 2560x1440 H.264 High 5.1 → 1920x1080 H.264 High 4.0 for HomeKit
- **Snapshot URL:** direct Reolink HTTP snapshot API on the camera
- Standalone HomeKit accessory

**Why @scrypted/reolink instead of reolink-native:**

The RLC-823A 16X has a large number of channels (main, sub, ext, plus 16× optical zoom channel).
`@apocaliss92/scrypted-reolink-native` uses the Baichuan binary protocol, which opens multiple
concurrent sessions per camera (video, audio, motion, PTZ, AI events). The session count on this
camera exceeds the firmware's limit, causing it to enter a continuous reboot loop.

`@scrypted/reolink` uses RTMP/RTSP for video and HTTP polling for AI events, keeping the session
count within limits. Motion detection (person/vehicle/animal) continues to work via HTTP polling
to port 80 — this is independent of the RTSP video stream path.

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

| Camera | Location | IP |
|--------|----------|----|
| Master Bathroom Camera 1 | Master bathroom | 192.168.5.174 |
| Master Bathroom Camera 2 | Master bathroom | 192.168.5.142 |
| Master Bedroom Camera 1 | Master bedroom | 192.168.5.236 |
| Hallway Camera 1 | Hallway | 192.168.5.245 |
| Hallway Camera 2 | Hallway | 192.168.5.248 |
| Kitchen Camera 1 | Kitchen | 192.168.5.18 |
| Kitchen Camera 2 | Kitchen | 192.168.5.64 |
| Office Camera | Office | 192.168.5.55 |

**Credentials:** username `admin` (see local credentials store)

**RTSP streams:**
- Main: `/11` (e.g. `rtsp://admin:<password>@192.168.5.174:554/11`)
- Sub: `/12` (e.g. `rtsp://admin:<password>@192.168.5.174:554/12`)

**Current path:**
- go2rtc: all 8 cameras stream through go2rtc RTSP rebroadcast (main `/11`, sub `/12`)
- Scrypted: `@scrypted/rtsp` plugin → `rtsp://192.168.1.85:8554/<name>_main` and `<name>_sub`
  - Mixin chain: Rebroadcast, WebRTC, Snapshot, Custom Motion Sensor, HomeKit
  - Motion: Frigate → MQTT → `frigate_bridge.mjs` → dummy switch → Custom Motion Sensor
  - NO CoreML in Scrypted — Frigate provides all object detection
- Frigate: sub→detect (`rtsp://192.168.1.85:8554/<name>_sub`, fps:2, event-only recording), main→record (`rtsp://192.168.1.85:8554/<name>_main`); CoreML ZMQ detector
- Home Assistant: via go2rtc RTSP (or direct RTSP — unchanged)

Scrypted IDs: Master Bathroom Camera 1=238, Master Bathroom Camera 2=237, Master Bedroom Camera 1=231, Hallway Camera 1=240, Hallway Camera 2=239, Kitchen Camera 1=242, Kitchen Camera 2=243, Office Camera=182.

Dummy switch IDs (Scrypted): Office=251, Master Bedroom 1=248, Hallway 1=249, Hallway 2=250, Kitchen 1=255, Kitchen 2=256, Master Bathroom 1=253, Master Bathroom 2=254.

**Model strings:**
- `C6F0SoZ0N0PmL2` — Master Bathroom Camera 1, Master Bathroom Camera 2
- `C6F0SgZ0N0P6L0` — Hallway Camera 1, Hallway Camera 2, Kitchen Camera 1, Kitchen Camera 2, Master Bedroom Camera 1, Office Camera

**Home Assistant direct RTSP examples:**
```yaml
master_bathroom_camera_1_main:
  input: rtsp://admin:<password>@192.168.5.174:554/11

kitchen_camera_1_main:
  input: rtsp://admin:<password>@192.168.5.18:554/11
```

**Scrypted:** `@scrypted/rtsp` plugin — sourced from go2rtc rebroadcast
- Main stream: `rtsp://192.168.1.85:8554/<name>_main`
- Sub stream: `rtsp://192.168.1.85:8554/<name>_sub`
- Motion: Frigate → MQTT → frigate_bridge → dummy switch → Custom Motion Sensor mixin
- Standalone HomeKit accessory mode

**Snapshot source:** go2rtc JPEG API — `http://192.168.1.85:1984/api/frame.jpeg?src=<name>_sub`
- Sub stream is always warm (Frigate pulls it for detection continuously), giving instant snapshots without waking the main stream
- Applied by `scrypted_snapshots.mjs`

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

> IPs are set via DHCP reservations in the router.

**go2rtc:** Both cameras connect via `wyze://` DTLS P2P.
- Living Room Camera: `wyze://192.168.5.62?dtls=true&model=HL_CAM3P` — stream name `living_room_camera_main`
- Front Door Camera: `wyze://192.168.5.177?dtls=true&model=HL_PAN3` — stream name `front_door_camera_main`

> **Front Door Camera RTSP note:** Wyze RTSP firmware was tested (`/stream0`, `/stream1`) but the Pan v3 RTSP connection drops every 30-90s (i/o timeout). wyze:// P2P is stable; RTSP is disabled in the Wyze app.

**Camera P2P details (used in go2rtc wyze:// URLs):**
| Camera | MAC | P2P UID | ENR | Model |
|--------|-----|---------|-----|-------|
| Living Room Camera | D03F2798D5B3 | Z6A8GPTL2HBJM1X1111A | gvnv3V/ieXQ3b/Tb | HL_CAM3P |
| Front Door Camera | D03F27BCCA2D | 6LZN32SM98X9ULWF111A | LXpAWo3xT+s4ettg | HL_PAN3 |

---

### Eufy Garage Camera (1 total)

| Camera | Location | IP |
|--------|----------|----|
| Eufy Garage Camera 1 | Garage interior | 192.168.5.162 (SB380 homebase wired to GS108T port 2, VLAN 10) |

**go2rtc config:**
```yaml
eufy_garage_camera_1_main:
  - rtsp://Sharif_Nassar275:Egyptian_0221975@192.168.5.162/live0
  - ffmpeg:eufy_garage_camera_1_main#hardware#video=copy#audio=opus
eufy_garage_camera_1_sub:
  - ffmpeg:eufy_garage_camera_1_main#hardware#video=h264#width=640#height=360
```

---

### Front Doorbell (August / 3rd party)

| Camera | Location | IP |
|--------|----------|----|
| Front Doorbell | Front door | 192.168.5.91 |

> This IP is expected to stay fixed via DHCP reservation for the current go2rtc candidate mappings to remain valid.

**go2rtc config:**
```yaml
# Internet-backed candidates
front_doorbell_candidate_internet_1: rtsp://192.168.5.91:554/live/stream
front_doorbell_candidate_internet_2: rtsp://192.168.5.91:554/live/stream0
front_doorbell_candidate_internet_3: rtsp://192.168.5.91:554/live/stream1

# Local guesses from prior testing
front_doorbell_candidate_local_1: rtsp://192.168.5.91:554/stream
front_doorbell_candidate_local_2: rtsp://192.168.5.91:554/stream0
front_doorbell_candidate_local_3: rtsp://192.168.5.91:554/stream1
```

> Note: These August/3rd-party doorbell RTSP paths are all unverified candidates. Internet references support the `/live/stream*` family, with `/live/stream` the strongest candidate. The `/stream*` family is from prior local guessing only and has not been confirmed online.
> Prior local documentation assumed AAC audio for this doorbell, but the RTSP audio codec is still unverified.

**Latest live verification (2026-03-27):**
- Probed all 6 candidates from the Mac Mini (`192.168.1.85`)
- `rtsp://192.168.5.91:554/live/stream` timed out once
- subsequent probes failed because `192.168.5.91` became unreachable (`Host is down`, ARP incomplete)
- current blocker is device/network reachability, not a confirmed RTSP path mismatch

**Intended path (once reachable):** go2rtc → Scrypted RTSP plugin via `rtsp://192.168.1.85:8554/front_doorbell_main`

**Status: ON HOLD** — device unreachable since 2026-03-27; needs investigation before adding to Scrypted/HomeKit

---

## Network / VLAN

### Camera Network (VLAN 10 — Courtyardson)

All cameras are on the **192.168.5.x** subnet, isolated from the primary network (192.168.1.x) via VLAN 10.

| Network | VLAN ID | Subnet | SSID |
|---------|---------|--------|------|
| Primary | untagged | 192.168.1.x | Courtyard_Main |
| Guest | 1733 | 192.168.3.x | Courtyard_Guest |
| Camera | 10 | 192.168.5.x | Courtyardson |

**Router:** Synology RX6600AX — Network 3 "Courtyardson" = VID:10, subnet 192.168.5.1/24, DHCP enabled. All LAN ports configured as trunk ports (auto-trunking enabled) carrying VLAN 1 untagged, VLAN 1733 tagged, VLAN 10 tagged.

**WiFi:** Cameras on WiFi connect to the "Courtyardson" SSID (2.4GHz, 5GHz-1, 5GHz-2) and land on 192.168.5.x automatically.

### GS108T Managed Switch (Wired Camera Isolation)

Netgear GS108T connects wired cameras to the VLAN 10 network.

```
RX6600AX (gateway)
      │
   MoCA adapter ──── MoCA ──── MoCA adapter
                                     │
                              Netgear GS108T
                              ┌─────────────────────────────────────────────────────┐
                              │ Port 1  MoCA → RX6600AX           TRUNK             │
                              │         VLAN 1 untagged, VLAN 10+1733 tagged        │
                              │ Port 2  Eufy SB380 (192.168.5.162) IoT untagged     │
                              │ Port 3  Garage Outside Doorbell    IoT untagged     │
                              │ Port 4  Garage Outside Camera      IoT untagged     │
                              │ Port 5  (available)                                 │
                              │ Port 6  Courtyard Doorbell (future) IoT untagged    │
                              │ Port 7  RX6600AX "Garage" WiFi PT  TRUNK            │
                              │         VLAN 1 untagged, VLAN 10+1733 tagged        │
                              │ Port 8  RX6600AX "Kitchen" WiFi PT TRUNK            │
                              │         VLAN 1 untagged, VLAN 10+1733 tagged        │
                              └─────────────────────────────────────────────────────┘
```

**GS108T VLAN configuration (as configured 2026-04-11):**

| VLAN | Name    | g1 | g2 | g3 | g4 | g5 | g6 | g7 | g8 |
|------|---------|----|----|----|----|----|----|----|----|
| 1    | Primary | U  | —  | —  | —  | —  | —  | U  | U  |
| 10   | IoT     | T  | U  | U  | U  | U  | U  | T  | T  |
| 1733 | Guest   | T  | —  | —  | —  | —  | —  | T  | T  |
| **PVID** |     | **1** | **10** | **10** | **10** | **10** | **10** | **1** | **1** |

**GS108T web UI setup steps:**

1. **Create VLANs** — `Switching → VLAN → Basic → VLAN Configuration`
   - Add VLAN 10, Name: `IoT`, Type: Static
   - Add VLAN 1733, Name: `Guest`, Type: Static
   - (VLAN 1 Default already exists — do not modify)

2. **Set VLAN membership** — `Switching → VLAN → Advanced → VLAN Membership`
   - Select VLAN 10: set g1=T, g2=U, g3=U, g4=U, g5=U, g6=U, g7=T, g8=T; all others blank
   - Select VLAN 1: set g1=U, g7=U, g8=U; all others blank
   - Select VLAN 1733: set g1=T, g7=T, g8=T; all others blank

3. **Set PVIDs** — `Switching → VLAN → Advanced → Port PVID Configuration`
   - Set g2, g3, g4, g5, g6 → PVID 10
   - Set g1, g7, g8 → PVID 1
   - Leave Ingress Filtering = Disabled, Port Priority = 0

4. **Set DNS** — `System → Management → DNS`
   - Primary DNS: `192.168.1.1`
   - Secondary DNS: `8.8.8.8`

5. **Set NTP** — `System → Management → Time`
   - Clock Source: NTP
   - NTP Server 1: `pool.ntp.org`
   - NTP Server 2: `0.pool.ntp.org`
   - NTP Server 3: `1.pool.ntp.org`

**RX6600AX WiFi points (Ports 7, 8):** Receive trunk with VLAN 1 untagged and VLAN 10 + 1733 tagged. Broadcast all three SSIDs (Primary, IoT, Guest). Devices connecting to IoT SSID get 192.168.5.x addresses; devices on Primary get 192.168.1.x.

**Kitchen cameras note:** Kitchen Camera 1 (.18) and Kitchen Camera 2 (.64) connect via WiFi to the IoT SSID broadcast by the RX6600AX "Kitchen" WiFi point on port 8 — cameras get 192.168.5.x addresses via DHCP.

---

## Infrastructure

**DHCP reservation requirement:** The current Scrypted and go2rtc setup assumes every camera keeps a stable reserved IP from DHCP. The scripts and configs in this repo are not designed to rediscover cameras automatically after IP or subnet changes.

### go2rtc

- **Host:** Mac Mini M1 (`192.168.1.85`)
- **Config:** `/Users/sn/docker/go2rtc.yaml`
- **Running as:** user `sn` (LaunchAgent `~/Library/LaunchAgents/com.go2rtc.plist`)
- **Ports:** 1984 (Web UI/API), 8554 (RTSP), 8555 (WebRTC TCP/UDP)
- **Web UI:** `http://192.168.1.85:1984`
- **Logs:** `~/go2rtc.log`
- **Restart:** `curl -X POST http://localhost:1984/api/restart`
- **Full restart:** `launchctl kickstart -k gui/$(id -u)/com.go2rtc`
- **ffmpeg PATH:** `/opt/homebrew/bin` set via `EnvironmentVariables` in plist — required for `ffmpeg:` sources
- **Keepalive:** `~/Library/LaunchAgents/com.go2rtc-keepalive.plist` runs `~/go2rtc-keepalive.sh` — keeps all streams warm (Wyze P2P, Hipcam RTSP, Eufy, Reolink)

**Installing/reinstalling go2rtc LaunchAgent** (required once after fresh install):
```bash
# Copy plist to user LaunchAgents (log path must be user-writable, not /var/log/)
cp ./com.go2rtc.plist ~/Library/LaunchAgents/com.go2rtc.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.go2rtc.plist
launchctl enable gui/$(id -u)/com.go2rtc
launchctl kickstart gui/$(id -u)/com.go2rtc
```

**Installing the keepalive LaunchAgent** (required once after fresh install):
```bash
cp ./com.go2rtc-keepalive.plist ~/Library/LaunchAgents/com.go2rtc-keepalive.plist
cp ./go2rtc-keepalive.sh ~/go2rtc-keepalive.sh && chmod +x ~/go2rtc-keepalive.sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.go2rtc-keepalive.plist
launchctl enable gui/$(id -u)/com.go2rtc-keepalive
launchctl kickstart gui/$(id -u)/com.go2rtc-keepalive
```

**Installing the frigate-bridge LaunchAgent:**
```bash
cp ./com.frigate-bridge.plist ~/Library/LaunchAgents/com.frigate-bridge.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.frigate-bridge.plist
launchctl enable gui/$(id -u)/com.frigate-bridge
launchctl kickstart gui/$(id -u)/com.frigate-bridge
# Verify: launchctl list | grep frigate-bridge
```

### Scrypted

- **Host:** Mac Mini M1 (`192.168.1.85`)
- **Running as:** user `sn` (LaunchAgent `~/Library/LaunchAgents/com.scrypted.plist`)
- **Node.js:** `/opt/homebrew/opt/node@20/bin/node` (v20 LTS)
- **Install dir:** `~/.scrypted/`
- **Volume:** `~/.scrypted/volume/`
- **Web UI:** `https://192.168.1.85:10443`
- **Logs:** `~/.scrypted/scrypted-daemon.log`
- **Restart:** `launchctl kickstart -k gui/$(id -u)/com.scrypted`
- **Plugins installed:**
  - `@scrypted/rtsp` — all Hipcam cameras (8) via go2rtc RTSP rebroadcast
  - `@scrypted/reolink` — Garage Outside Camera (direct camera RTSP + HTTP polling; reolink-native causes Baichuan session overflow on this model)
  - `@apocaliss92/scrypted-reolink-native` — Reolink doorbells (direct to camera, Baichuan push for instant doorbell events)
  - `@scrypted/homekit` — HomeKit bridge
  - `@scrypted/webrtc` — WebRTC support
  - `@scrypted/prebuffer-mixin` (Rebroadcast) — prebuffering for HKSV
  - `@scrypted/snapshot` — snapshot support
  - `@scrypted/dummy-switch` — Custom Motion Sensor for Hipcam cameras (x8)
  - **frigate_bridge.mjs** (LaunchAgent `com.frigate-bridge`) — bridges Frigate MQTT motion events to Scrypted dummy switches

> **Not in Scrypted:** August doorbell — ON HOLD (device unreachable since 2026-03-27)

### wyze-bridge

**Not used.** go2rtc handles Wyze P2P natively via `wyze://` DTLS.

### Home Assistant

- **Host:** `192.168.1.185`
- **Camera integrations:**
  - Reolink (native) — 5 cameras/doorbells
  - go2rtc streams — generic cameras and Wyze via RTSP
- **Wyze integration:** entities unavailable — needs cleanup

---

## M1 → M4 Mac Mini Migration Checklist

Migrating camera server from Mac Mini M1 (192.168.1.85) to Mac Mini M4 (24GB).
The M4 takes the same static IP. The M1 becomes the daily driver.

**Strategy: Time Machine restore** — same Apple Silicon architecture, full restore including all apps, LaunchAgents, Docker, Scrypted, go2rtc, and settings. No manual reinstall needed.

### Pre-migration (on M1)
- [ ] Push all config changes to GitHub (`git push`)
- [ ] Back up M1 to Time Machine (external drive or NAS share)
- [ ] Confirm backup completed successfully
- [ ] Note M4 MAC address (System Settings → General → About → scroll to bottom) — needed for DHCP reservation swap

### M4 setup via Time Machine restore
- [ ] Power on M4, begin macOS setup
- [ ] When prompted "Transfer Information to This Mac" — select **From a Time Machine backup**
- [ ] Select the M1 backup, restore everything (user account, apps, settings)
- [ ] Complete setup — M4 will have identical environment to M1

### Post-restore steps (on M4)
- [ ] Enable SSH: `System Settings → General → Sharing → Remote Login`
- [ ] Open Docker Desktop — accept any license prompts, let it start
- [ ] Verify all LaunchAgents loaded:
  ```bash
  launchctl list | grep -E "go2rtc|scrypted|frigate"
  ```
- [ ] If any are missing, load manually:
  ```bash
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.go2rtc.plist
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.scrypted.plist
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.frigate.detector.plist
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.frigate-bridge.plist
  ```
- [ ] Start Frigate: `cd ~/docker && docker compose up -d`
- [ ] Verify go2rtc: `curl http://localhost:1984/api/streams`
- [ ] Verify Scrypted: open `https://localhost:10443`

### Network cutover
- [ ] In router DHCP reservations: reassign 192.168.1.85 to M4 MAC address
- [ ] Assign M1 a new DHCP reservation for its new role as daily driver
- [ ] Reboot M4 — picks up 192.168.1.85
- [ ] Reboot M1 — picks up new IP

### Post-migration verification
- [ ] go2rtc streams all active: `http://192.168.1.85:1984`
- [ ] Frigate cameras all green: `http://192.168.1.85:8971`
- [ ] Scrypted accessible: `https://192.168.1.85:10443`
- [ ] CoreML detector active: `tail ~/Library/Logs/FrigateDetector.stderr.log`
- [ ] HomeKit cameras all show live view in Home app
- [ ] HKSV recording working for all cameras
- [ ] `docker stats` — Frigate CPU should be well under 400% on M4

### HomeKit re-pairing (if needed)
Time Machine restores Scrypted's HomeKit pairing keys, so cameras may just work. If any cameras show as unresponsive in Home app:
- [ ] In Home app: remove the camera accessory
- [ ] In Scrypted: unpair and re-pair the camera to HomeKit
- [ ] Re-enable HKSV in Home app for that camera

---

## Setup Scripts

All scripts are run on the Mac Mini via SSH:
```bash
scp <script>.mjs sn@192.168.1.85:/tmp/
ssh sn@192.168.1.85 'PATH=/opt/homebrew/opt/node@20/bin:$PATH node /tmp/<script>.mjs'
```

| Script | Purpose |
|--------|---------|
| `scrypted_setup.mjs` | Fresh install — creates Reolink cameras (Garage Outside + 3 doorbells) with mixins. |
| `scrypted_snapshots.mjs` | Applies snapshot URLs: go2rtc JPEG API for all Hipcam cameras (`/api/frame.jpeg?src=<stream>_main`), direct HTTP API for Reolink cameras. |
| `hipcam_setup_camera.sh` | Applies optimised stream settings (CBR, bitrate, fps, GOP) to a single Hipcam camera via CGI API. Usage: `HIPCAM_PASSWORD=<pass> bash hipcam_setup_camera.sh <ip>` |
| `scrypted_migrate_localhost.mjs` | Repair script — re-applies full mixin chain + stream settings to all ONVIF Hipcam devices if mixins are lost. |
| `scrypted_migrate_onvif_to_rtsp.mjs` | Historical — one-time ONVIF→RTSP migration (2026-04-01). No longer needed. |
| `scrypted_replace_onvif_with_rtsp.mjs` | Migrate 6 ONVIF Hipcam cameras → RTSP (go2rtc). Sets mixin chain with dummy switch (no CoreML). Run after go2rtc streams are live. |

---

## Motion Detection Strategy

| Camera Type | Motion Source | HomeKit / HKSV | M1 GPU |
|-------------|--------------|----------------|--------|
| Reolink doorbells | Camera onboard AI via Baichuan push (person/vehicle/pet/visitor, instant) | ✅ reolink-native → HKSV | ✅ VideoToolbox — HKSV encode |
| Garage Outside Camera | Camera onboard AI via HTTP polling port 80 (person/vehicle/animal) | ✅ @scrypted/reolink → HKSV | ✅ VideoToolbox — transcode + HKSV encode |
| Hipcam Knockoff (8) | Frigate (CoreML ZMQ) → MQTT → frigate_bridge → dummy switch → Custom Motion Sensor | ✅ RTSP (go2rtc) + dummy switch → HKSV | ✅ VideoToolbox (HKSV encode) |
| Wyze (2) | Frigate → MQTT (not in Scrypted/HomeKit) | — | — |
| Eufy Garage Camera | Frigate → MQTT (not in Scrypted/HomeKit) | — | — |

---

## Key Design Decisions

1. **Reolink doorbells: direct connection (no go2rtc)** — HA native Reolink integration and Scrypted reolink-native plugin both connect directly to the doorbells. Reolink cameras output AAC audio natively — no audio transcoding needed. Baichuan protocol gives instant doorbell press events and two-way audio. Doorbell models have a simple 2-channel layout that stays within Baichuan session limits.

1a. **Garage Outside Camera (RLC-823A 16X): go2rtc + @scrypted/reolink** — This specific camera model cannot use reolink-native because its many channels (main/sub/ext/16× zoom) push the Baichuan session count over the firmware limit, causing a reboot loop. Uses `@scrypted/reolink` (HTTP + RTSP) instead. go2rtc is required because the camera's H.264 High 5.1 output must be transcoded to High 4.0 for HomeKit and the direct RTSP reconnect delay after ffmpeg crashes exceeds HomeKit's session timeout. See the Garage Outside Camera section for full details.

2. **Hipcam Knockoff: go2rtc RTSP → Scrypted RTSP + Frigate** — All 8 Hipcam cameras route through go2rtc RTSP rebroadcast. Scrypted `@scrypted/rtsp` pulls main+sub streams from go2rtc. Frigate (Mac Mini Docker, CoreML ZMQ) also pulls from go2rtc for object detection and publishes motion to MQTT. `frigate_bridge.mjs` bridges MQTT → Scrypted dummy switches → Custom Motion Sensor → HKSV. This eliminates direct camera connections from both Scrypted and Frigate, and removes all ONVIF complexity.

3. **Frigate CoreML for all motion detection** — Frigate runs in Docker on the Mac Mini with the CoreML ZMQ detector (`tcp://host.docker.internal:5555`) using a YOLO model. All object detection (person/vehicle/animal) happens in Frigate. Scrypted has no CoreML/objectdetector plugins — it only receives motion via dummy switches from `frigate_bridge.mjs`.

5. **Wyze + Eufy: go2rtc only, not in Scrypted/HomeKit** — Wyze cameras stream via go2rtc wyze:// P2P. Eufy streams via go2rtc RTSP. Neither is in Scrypted or HomeKit. August doorbell remains on hold (device unreachable).

6. **Cameras NOT in HA HomeKit bridge** — Scrypted provides better HKSV support, hardware transcoding (Apple Silicon), and prebuffering. HA HomeKit bridge is used for non-camera entities only (locks, lights, sensors, thermostats).

7. **Standalone HomeKit accessories** — Each Scrypted camera is configured with `homekit:standalone=true` and paired individually in Home app (not through HA bridge).

---

## Session Log: 2026-04-03 — HKSV Enabled for All Cameras

### What Changed

1. **All 8 Hipcam cameras migrated from RTSP → ONVIF** via `scrypted_rtsp_to_onvif.mjs`
   - All cameras now on `@scrypted/onvif` with ONVIF-T native motion events
   - HKSV confirmed working for all 8 in Home app
   - Master Bathroom Camera 1, 2 and Hallway Camera 2 (previously ONVIF-unresponsive) now working

2. **Wyze cameras (Living Room, Front Door) added to HomeKit with HKSV**
   - `@apocaliss92/scrypted-wyze-native` plugin; dummy switch + Custom Motion Sensor mixin for HKSV
   - MotionSensor=true confirmed; HKSV shield visible in Home app

3. **Eufy Garage Camera added to HomeKit with HKSV**
   - `@scrypted/rtsp` plugin (id=219, "Garage Camera 1"); RTSP via go2rtc
   - Dummy switch + Custom Motion Sensor mixin for HKSV
   - HKSV shield visible in Home app

4. **Motion detection settings on Hipcam cameras**
   - Smart Humanoid Recognition: On
   - Alarm Trigger: Separate trigger (not linkage — fires on motion OR humanoid independently)

### Key Lesson

HKSV requires `MotionSensor` in the camera's interface list. For ONVIF cameras this comes from ONVIF-T events. For RTSP cameras with no native motion events (Wyze, Eufy), a dummy switch mixin via `@scrypted/dummy-switch` Custom Motion Sensor adds `MotionSensor` to the camera's interfaces.

---

## Session Log: 2026-04-01 — Architecture Overhaul (ONVIF + Synology)

### What Changed

Mac Mini was freezing due to Scrypted load: CoreML running inference on 11 cameras simultaneously + 22 stale RTSP connections from a prebuffer restart loop on Master Bathroom Camera 2 (snapshot URL failure → FFmpeg fallback loop).

### Resolution

1. **Hipcam cameras (8): switched from go2rtc RTSP → Scrypted ONVIF direct**
   - Removed all 8 Hipcam camera devices from Scrypted (RTSP plugin)
   - Created new devices via `@scrypted/onvif` plugin (port 8080)
   - ONVIF-T events provide reliable motion detection at zero extra CPU cost
   - CoreML kept as object classifier on top of ONVIF events
   - 5 cameras created successfully; 3 need physical inspection (ONVIF unresponsive):
     - Master Bathroom Camera 1 (192.168.5.174)
     - Master Bathroom Camera 2 (192.168.5.142)
     - Hallway Camera 2 (192.168.5.248)

2. **Wyze + Eufy: added to Scrypted + HomeKit** (superseded by 2026-04-03 session)
   - Initially removed from Scrypted and moved to Synology only
   - Subsequently re-added: Wyze via wyze-native, Eufy via RTSP plugin
   - All now have HKSV via dummy switch + Custom Motion Sensor mixin

3. **go2rtc: removed all 16 Hipcam streams**
   - Streams for all 8 Hipcam cameras (main + sub) removed from go2rtc.yaml
   - go2rtc now serves only: Wyze (2), Eufy (1), August (1), Roborock vacuums
   - Keepalive updated: only Wyze + Eufy streams

4. **Hipcam stream settings** — All cameras (7/8 reachable) updated via CGI API:
   - CBR mode (`brmode=0`, was VBR)
   - Main: 2048kbps, 15fps, GOP 30
   - Sub: 512kbps, 10fps, GOP 20

### Key Lesson

ONVIF `createDevice` requires `httpPort: 8080` for these cameras. Calling without explicit port defaults to 80 and either refuses connection or returns wrong SOAP response. Also: `device.remove()` is not exposed on Scrypted device proxies — camera deletion must be done manually via Scrypted UI.

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
- **Reolink camera IPs**: HA Reolink integration API (`192.168.1.185`)
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
| Garage Outside Doorbell (Reolink) | 290 | @apocaliss92/scrypted-reolink-native |
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
Wyze Camera → go2rtc (wyze:// P2P) → RTSP rtsp://192.168.1.85:8554/<cam>_main
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
- **Reolink camera IPs**: HA Reolink integration (192.168.1.185)
- **Wyze RTSP URLs**: `rtsp://192.168.1.85:8554/living_room_camera_main`, `rtsp://192.168.1.85:8554/front_door_camera_main`

---

## Session Log: 2026-03-27 — Garage Outside Camera: reolink-native → @scrypted/reolink

### Problem

The Garage Outside Camera (Reolink RLC-823A 16X, 192.168.5.84) was stuck in a continuous reboot
loop when managed by `@apocaliss92/scrypted-reolink-native`. Root cause: the RLC-823A 16X has
many channels (main, sub, ext, plus 16× optical zoom channel), causing the Baichuan session
count to exceed the camera firmware's limit. The camera interprets this as an attack and reboots.

### Solution

1. **Switched to `@scrypted/reolink`** — uses RTMP/RTSP for video and HTTP polling for AI events,
   no Baichuan sessions. Reboot loop stopped immediately.

2. **Configured FFmpeg VideoToolbox transcoding** — camera outputs 2560x1440 H.264 High 5.1
   (`profile-level-id=640033`). HomeKit requires High 4.0 max. FFmpeg output args set to:
   `-vf scale=1920:1080 -c:v h264_videotoolbox -b:v 4000k -profile:v high -level:v 4.0 -realtime 1 -c:a copy`

3. **All configuration done programmatically** via `@scrypted/client` SDK (no UI clicks).

### Key Technical Details

- **FU-A fragmentation fix**: RTSP parser set to "FFmpeg (TCP)" — Scrypted's native parser fails
  to reassemble large H.264 High profile NAL units from this camera's 2.5K stream.
- **Rebroadcast port 0**: Auto-assign prevents EADDRINUSE on port 49498 after plugin restart.
- **Motion detection unaffected**: `@scrypted/reolink` polls `http://192.168.5.84:80` for AI
  events independently of the RTSP video path — switching away from reolink-native does not change
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
scp scrypted_setup.mjs sn@192.168.1.85:/tmp/
ssh sn@192.168.1.85 'PATH=/opt/homebrew/opt/node@20/bin:$PATH node /tmp/scrypted_setup.mjs'
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
- **Home app pairing**: open `https://192.168.1.85:10443`, go to each camera → Extensions → HomeKit, copy the pairing PIN, add accessory in Home

### Repair Workflow for Existing Installs

If RTSP cameras were already paired in Home before the correct mixin chain was present, Home may continue to show them without HKSV until the accessory is reset and re-paired.

Use `scrypted_mixins.mjs` to repair an existing install:

```bash
scp scrypted_mixins.mjs sn@192.168.1.85:/tmp/
ssh sn@192.168.1.85 'PATH=/opt/homebrew/opt/node@20/bin:$PATH node /tmp/scrypted_mixins.mjs'
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

#### 5. Wyze Cameras — stay on `wyze://` P2P
**Decision:** Keep both Wyze cameras (`Living Room Camera`, `Front Door Camera`) on `wyze://` in go2rtc. Do not switch the front-door camera to direct RTSP unless that is explicitly re-enabled later.

**Current issue:** The live failures were initially `wyze: connect failed: discovery timeout`. The root cause for the primary-network-only setup was SRM network isolation on `Courtyardson`, which blocked `192.168.1.85` from reaching `192.168.5.x`.

**Operational note:** Historical RTSP-direct experiments existed for the front-door Wyze, but RTSP is not the preferred path for the current architecture.

**2026-03-29 validation after disabling `Courtyardson` isolation:**
- `Living Room Camera` (`192.168.5.62`) recovered fully on Ethernet-only Mac Mini access.
  - Ping from `192.168.1.85`: `2/2`
  - `go2rtc` JPEG frame: valid `2560x1440`
  - local RTSP rebroadcast: working
- `Front Door Camera` (`192.168.5.177`) became reachable, but remains unstable.
  - Ping from `192.168.1.85`: `3/4`, with extreme latency spikes (`~610 ms` to `~2598 ms`)
  - `go2rtc` JPEG frame probe timed out after `25s`
  - remaining issue is camera/link quality on that device, not the overall go2rtc/Scrypted architecture

#### 6. Keepalive LaunchDaemon
**Problem:** Wyze cameras use the `wyze://` P2P source path and go2rtc uses lazy loading. After a reboot or a long idle period, the first downstream request can hit a warm-up timeout.

**Fix:** Created `~/go2rtc-keepalive.sh` — runs one persistent `ffmpeg` process per Wyze camera against `rtsp://127.0.0.1:8554/<stream>`, waits for the local go2rtc API on boot, removes the legacy lock file left by the old script, and is installed as system LaunchDaemon (`/Library/LaunchDaemons/com.go2rtc.keepalive.plist`) so it survives Mac Mini reboots without requiring a macOS login.

**Cameras covered:** Living Room Wyze + Front Door Wyze (2 total). The Hipcam cameras no longer use go2rtc in the Scrypted path and should not be kept alive here.

#### 7. Legacy Camera Subnet Alias
**Problem:** The Mac Mini moved to `192.168.1.85`, but some direct camera sources in go2rtc still live on `192.168.5.x` and were not migrated at the same time.

**Attempted fix:** Created `~/ensure-camera-subnet-alias.sh` and temporarily installed `/Library/LaunchDaemons/com.camera-subnet-alias.plist` to keep `192.168.5.85/24` aliased on `en0` after boot.

**Outcome:** Rolled back. The alias interfered with normal Mac connectivity, including VNC access to the Mac Mini. The correct fix was disabling SRM network isolation on `Courtyardson`, not keeping a secondary alias on `en0`.

### Cameras Left on ONVIF (working fine, no changes needed)
- Kitchen Camera 1 & 2
- Master Bedroom Camera 1
- Office Camera

### Pending
- **August Doorbell** (192.168.5.91) — RTSP port 554 timing out, needs investigation
