# esphome-econet [![Made for ESPHome](https://img.shields.io/badge/Made_for-ESPHome-black?logo=esphome)](https://esphome.io) [![Nightly Build](https://github.com/esphome-econet/esphome-econet/actions/workflows/build-nightly.yml/badge.svg)](https://github.com/esphome-econet/esphome-econet/actions/workflows/build-nightly.yml) [![Discord](https://img.shields.io/discord/1148015790038188073?logo=discord&logoColor=%23FFFFFF&label=Discord&labelColor=%235865F2&color=%2399AAB5)](https://discord.gg/cRpxtjkQQ3)

This [ESPHome](https://esphome.io) package enables local control of a Rheem appliance, like a Rheem Heat Pump Water Heater (HPWH), and creates entities in Home Assistant to control and monitor these devices. This package provides more detailed and reliable sensors than Rheem's cloud-based [EcoNet integration](https://www.home-assistant.io/integrations/econet/) available in Home Assistant, and does so without any requirement for internet access by accessing the device via its RJ11 diagnostics port.

This package and the Rheem EcoNet integration can coexist if desired.

<!-- markdownlint-capture -->
<!-- markdownlint-disable -->
<p float="left">
    <img src="https://github.com/esphome-econet/econet-docs/blob/main/photos-and-screenshots/Controls_and_Sensors.png?raw=true" alt="Example Home Assistant device controls and sensors for an ESPHome-econet device." width=40%>
    <img src="https://github.com/esphome-econet/econet-docs/blob/main/photos-and-screenshots/Thermostat.png?raw=true" alt="Setting Water Heater thermostat mode through Home Assistant with ESPHome-econet." width=50%>
</p>
<p float="left">
    <img src="https://github.com/esphome-econet/econet-docs/blob/main/photos-and-screenshots/Diagnostics.png?raw=true" alt="Diagnostic sensors exposed to Home Assistant by ESPHome-econet." width=40%>
    <img src="https://github.com/esphome-econet/econet-docs/blob/main/photos-and-screenshots/Configuration.png?raw=true" alt="Configuration via Home Assistant with ESPHome-econet." width=40%>
</p>
<!-- markdownlint-restore -->

## Supported Rheem Hardware

Most modern Rheem Heat Pump Water Heaters, Tankless Water Heaters, Electric Tank Water Heaters, and HVAC Systems (with preliminary support for multi-zone systems) are supported.

## Required ESPHome Hardware

ESPHome-econet is a great first ESPHome project due to the easy hardware setup. All that's needed to run ESPHome-econet is an ESP32 or ESP8266 microcontroller and an RS485 Interface, plus a phone cord to hook it up to your Rheem appliance and a USB-C charger to power it. For simplicity, we recommend the m5Stack K045 Kit, which includes both the ESP32 & RS485 components in a simple package.

For full details on what hardware to buy and how to set it up, head over to the [Recommended Hardware Purchase and Setup page on our wiki](https://github.com/esphome-econet/esphome-econet/wiki/Recommended-Hardware-Purchase-and-Setup-Instructions).

<img src="https://github.com/esphome-econet/econet-docs/blob/main/photos-and-screenshots/Correctly-Wired-K045.jpeg?raw=true" alt="A correctly wired K045 unit." width=25%>

## Software Installation

To install the ESPHome-econet software, connect your ESP device to your computer via USB and [visit the Installation page on the ESPHome-econet website](https://esphome-econet.github.io/install/). Simply select your Rheem hardware type and the site will allow you to image the device, connect it to Wi-Fi, and add it to Home Assistant.

For alternative software installation methods and details on how to customize your configuration, check out [the detailed Software Configuration and Installation Guide on our wiki](https://github.com/esphome-econet/esphome-econet/wiki/Initial-ESPHome%E2%80%90econet-Software-Configuration-and-Installation).

## Installation Overview

For a video overview of how to setup the recommended hardware and deploy ESPHome-econet to it, please check out this video helpfully created by community member [Ylianst](https://github.com/Ylianst).

[![Water Heater - Home Assistant - ESP-Home EcoNET](https://img.youtube.com/vi/5u0_TsBOTEI/0.jpg)](https://www.youtube.com/shorts/K75njuvRIks)

## Contributing to ESPHome EcoNet

Contributions to the ESPHome-econet are welcome and encouraged! If you're looking to help out and need inspiration, please check out [the list of open issues](https://github.com/esphome-econet/esphome-econet/issues).

Contributors will want to install esphome and pre-commit, then install pre-commit hooks for your forked repo:

```bash
pip install -U esphome pre-commit  # Install required python packages
cd esphome-econet  # CD into the directory where you cloned your forked esphome-econet repo
pre-commit install  # Enable pre-commit hooks to run prior to any commit
```

### Testing Local Changes

The esphome CLI can be used to compile and install changes to YAML and/or code via the `esphome config|compile|run` commands. The provided `example-local.yaml` file provides a simple example of how to build with all local changes like this; just add a `secrets.yaml` file to the root of your checked-out repo and run `esphome compile example-local.yaml` to test compilation of your configuration and code changes. You can use the `esphome config example-local.yaml` command to see the results of any config updates, or the `esphome run example-local.yaml` command to deploy your changes to an ESPHome-capable device over Wi-Fi or USB.

## Need More Help?

If you have further questions or ideas for how to improve ESPHome-econet, please [come visit us on our Discord](https://discord.gg/cRpxtjkQQ3).

---

## Maintenance scripts (this fork)

> This repo shares **no git history** with upstream `esphome-econet/esphome-econet`
> — `git merge-base HEAD upstream/main` exits 1. Same first-commit messages, different
> SHAs, because it was created by uploading files rather than forking. `git merge` and
> GitHub's **Sync fork** therefore do not work. Updates are **content copies** from an
> upstream release tag.

### `update-from-upstream.sh` — pull community releases

```bash
./update-from-upstream.sh                    # dry run: releases + what differs
./update-from-upstream.sh upstream-v3.8.0    # apply that release (no commit, no deploy)
```

- Fetches upstream branches and tags, namespacing tags as **`upstream-*`**. This is
  required: the fork carries its own `v3.0.2` / `v3.1.0` / `v3.2.0` tags pointing at
  different commits, so a bare tag name is ambiguous.
- Only touches `components/econet/` and the three package YAMLs
  (`econet_tankless_water_heater.yaml`, `econet_base.yaml`, `econet_water_heater_base.yaml`).
  **`tlwh-rtgh-sn.yaml` is ours and is never overwritten.**
- Prints the deploy runbook: push to HAOS → **Validate** → **Install → Manual download**
  (compiles without flashing) → only then flash → check logs → commit.

**Known breaking change (v3.7.0):** `api: services:` became `api: actions:`, and the two
are mutually exclusive. A wrapper defining `services:` merged with an upstream base
defining `actions:` fails validation with *"two or more values in the same group of
exclusion 'actions'"*. Fix belongs in the wrapper — delete the `services:` block;
upstream's base supplies all six equivalents as actions.

### `rollback-upstream.sh` — restore the previous deployment

Runs **on the HAOS host**. Restores from the newest `/config/esphome/.pre-upstream-*/`
backup, whose path is recorded in `/config/esphome/.last-upstream-backup`.

```bash
ssh haos '/config/esphome/rollback-upstream.sh'          # newest backup
ssh haos '/config/esphome/rollback-upstream.sh /config/esphome/.pre-upstream-20260729_002649'
```

Restores files only — **nothing is flashed**. Re-flash from the ESPHome dashboard
afterwards to put the old firmware back. Deploy the canonical copy with:

```bash
cat rollback-upstream.sh | ssh haos \
  'sudo -n tee /config/esphome/rollback-upstream.sh >/dev/null && sudo -n chmod 755 /config/esphome/rollback-upstream.sh'
```

### `sync-mirrors.sh` — push to GitHub + local backup clones

```bash
./sync-mirrors.sh            # pushes main to origin, then every mirror
./sync-mirrors.sh <branch>
```

Mirrors are plain clones on other machines, pushed to directly over SSH:

| remote | host | path |
|---|---|---|
| `origin` | GitHub | `ra8844/esphome-econet` |
| `m4` | SN-MacMini2, 192.168.1.50 | `~/Repositories/esphome-econet` |
| `cams` | 3923-cams, 192.168.1.85 | `~/Repositories/esphome-econet` |

Each mirror was created once with:

```bash
git clone git@github.com:ra8844/esphome-econet.git ~/Repositories/esphome-econet
git -C ~/Repositories/esphome-econet config receive.denyCurrentBranch updateInstead
```

`updateInstead` lets a push update a non-bare checkout's working tree instead of being
rejected. The script prints each mirror's resulting HEAD so a silent failure is visible.

> **`upstream` is never pushed to.** It points at the community project
> (`esphome-econet/esphome-econet`), not your repo — a naive push-to-all-remotes loop
> would attempt to write to someone else's project. The script excludes `origin` and
> `upstream` by name, and upstream's push URL is set locally to `DISABLED-fetch-only`
> as a second guard.

### Deployment layout (what ESPHome actually reads)

The build does **not** read this repo. `tlwh-rtgh-sn.yaml` declares
`external_components: type: local` pointing at a path on the HAOS box:

```
/config/esphome/tlwh-rtgh-sn.yaml                              <- the wrapper (ours)
/config/esphome/econet_{tankless_water_heater,base,water_heater_base}.yaml
/config/esphome/external_components/esphome-econet/components/ <- components/econet
```

Editing this repo changes nothing until the files are copied across. There are also two
other git checkouts of this repo on the HAOS box with **divergent histories** (`/config`
itself, and the `external_components` checkout); they are deliberately not git-synced.
Full background: `sn-home-infra/LESSONS_LEARNED.md`, 2026-07-28.

### Model-specific notes — Rheem WH-TNK2 (`WH-TNK2-00-01-05`)

This unit does not implement `WTR_BTUS` or `FLOWRATE`; upstream polls them anyway,
producing `UNSUPPORTED` warnings every ~5 s and `nan` sensors. Suppressed in the wrapper:

```yaml
sensor:
  - id: !remove btus
  - id: !remove flow_rate
  - id: !remove instant_btus
  - id: !remove total_gas_usage
```

All four must go together — `instant_btus` is a template whose lambda references
`id(flow_rate)`, so removing `flow_rate` alone is a compile error, and `total_gas_usage`
is fed only by `btus`. These go **inside the wrapper's existing top-level `sensor:` key**;
a second `sensor:` block is a duplicate YAML key.
