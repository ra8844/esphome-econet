# Local patches to upstream-owned files

`update-from-upstream.sh upstream-vX.Y.Z` copies upstream's content over
`econet_base.yaml`, `econet_tankless_water_heater.yaml`, `econet_water_heater_base.yaml` and
`components/econet`. This deployment keeps a few local differences in those files. Re-apply
them after every upstream update, before deploying.

## econet_base.yaml: API encryption key and OTA password

HAOS's `/config/esphome/econet_base.yaml` has three lines upstream does not:

```yaml
api:
  encryption:
    key: !secret econet__encryption_key
ota:
  platform: esphome
  password: !secret econet__ota_password
```

Re-apply with (idempotent, fails without changing anything if an anchor moved):

```bash
./update-from-upstream.sh upstream-vX.Y.Z
local-patches/apply-local-patches.sh        # then: git diff econet_base.yaml
```

The values are in HAOS `/config/esphome/secrets.yaml` (`econet__encryption_key`,
`econet__ota_password`). Only the `!secret` references are kept in git.

Checked 2026-11-15: applying the script to an upstream v3.7.0 `econet_base.yaml` reproduces the
HAOS file byte for byte, and on v3.8.3 it adds exactly these three lines.

## tlwh-rtgh-sn.yaml: repo copy vs the live file

`tlwh-rtgh-sn.yaml` is ours; the update script never touches it. The repo copy mirrors the HAOS
file as of 2026-11-15 with one deliberate difference:

- Line 66, the `ota:` password. On HAOS it is an **inline literal** (7 characters) that does not
  equal any value in HAOS `secrets.yaml`. The repo copy uses `!secret ota_password` instead so no
  credential is committed. If you deploy this file back to HAOS, decide first which secret that line
  should use, or the device's OTA password changes.
