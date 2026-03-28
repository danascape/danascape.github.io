---
title: "Flashing Guide - OnePlus Nord N10 5G (billie)"
date: 2026-03-28
description: "Installation and update guide for custom ROMs on OnePlus Nord N10 5G (billie)"
tags: [flashing, android, custom-rom, billie, oneplus]
---

## Prerequisites

> **Warning:** Your warranty is void. Unlocking the bootloader and flashing custom software is done entirely at your own risk.

Before you begin:

- Your bootloader must be **unlocked**.
- A **custom recovery** (e.g. TWRP) must be installed.
- Make a **full data backup** — a clean flash will wipe everything.
- Ensure your device has at least **30% battery**.
- Only flash files meant for **OnePlus Nord N10 5G (billie)**.
- First boot may take **5–10 minutes**. Do not interrupt or force reboot unless it exceeds 10 minutes.

---

## Unlocking the Bootloader

> Unlocking the bootloader wipes all data on the device.

1. Enable **Developer Options**: go to **Settings → About Phone** and tap **Build Number** 7 times.
2. In **Developer Options**, enable **OEM Unlocking** and **USB Debugging**.
3. Reboot to fastboot mode:
   ```bash
   adb reboot bootloader
   ```
   Or hold **Power + Volume Up** while the device is off.
4. Verify the device is detected:
   ```bash
   fastboot devices
   ```
5. Unlock the bootloader:
   ```bash
   fastboot oem unlock
   ```
6. Confirm the unlock on-device using the volume keys and power button.
7. The device wipes and reboots. Complete the initial setup, then re-enable **Developer Options** and **USB Debugging**.

---

## Installing a Custom Recovery

1. Boot into fastboot mode.
2. Flash the recovery image:
   ```bash
   fastboot flash recovery recovery.img
   ```
3. Boot into recovery immediately to prevent OxygenOS from restoring the stock recovery:
   ```bash
   fastboot boot recovery.img
   ```
   Or hold **Power + Volume Down** at boot.

---

## Clean Installation

1. Boot into your **recovery**.
2. Go to **Format Data → Confirm**.
3. Select **Apply Update → Sideload the ROM zip**:
   ```bash
   adb sideload lineageos-*.zip
   ```
4. Reboot back into **Recovery** if flashing GApps, then sideload the GApps package (optional).
5. Reboot to **System**.

---

## Update (Dirty Flash)

### Method 1: OTA Update

1. Go to **Settings → System → System updates**.
2. Download the latest available build.
3. Tap **Reboot** once the download finishes.
4. The device reboots into recovery and installs the update automatically.
5. Reboot to **System**.

### Method 2: Recovery Flash

1. Reboot to **Recovery**.
2. Select **Apply Update → Sideload the ROM zip**.
3. Reboot to **System**.

> **Note:** For vanilla builds, **GApps must be reflashed after every update**.

---

## Device Info

| Field    | Details                  |
|----------|--------------------------|
| Codename | `billie`                 |
| SoC      | Qualcomm Snapdragon 690  |
| Android  | 10 (launch)              |
| RAM      | 6 GB                     |
| Storage  | 128 GB (UFS 2.1)         |
