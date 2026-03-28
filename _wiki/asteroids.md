---
title: "Flashing Guide - Nothing Phone 3a (asteroids)"
date: 2026-03-28
description: "Installation and update guide for custom ROMs on Nothing Phone 3a (asteroids)"
tags: [flashing, android, custom-rom, asteroids, nothing]
---

## Prerequisites

> **Warning:** Your warranty is void. Unlocking the bootloader and flashing custom software is done entirely at your own risk.

Before you begin:

- Your bootloader must be **unlocked**.
- Make a **full data backup** — a clean flash will wipe everything.
- Ensure your device has at least **30% battery**.
- Only flash files meant for **Nothing Phone 3a/pro (asteroids)**.
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
   Or hold **Power + Volume Down** while the device is off.
4. Verify the device is detected:
   ```bash
   fastboot devices
   ```
5. Unlock the bootloader:
   ```bash
   fastboot flashing unlock
   ```
6. Confirm the unlock on-device using the volume keys and power button.
7. The device wipes and reboots. Complete the initial setup, then re-enable **Developer Options** and **USB Debugging**.

---

## Installing a Custom Recovery

1. Boot into fastboot mode.
2. Temporarily boot into the custom recovery image to verify it works:
   ```bash
   fastboot boot recovery.img
   ```
3. Once booted into recovery, flash it permanently from within recovery (Advanced → Flash Recovery), or flash directly:
   ```bash
   fastboot flash recovery recovery.img
   ```

---

## Clean Installation

1. Boot into your **recovery**.
2. Go to **Format Data → Confirm**.
3. Apply Update and Sideload the **ROM** zip.
4. Reboot back into **Recovery** (optional for Gapps).
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
2. Select **Apply Update → Sideload Zip file**.
3. Reboot to **System**.

> **Note:** For vanilla builds, **GApps must be reflashed after every update**.

---

## Device Info

| Field    | Details                       |
|----------|-------------------------------|
| Codename | `asteroids`                   |
| SoC      | Qualcomm Snapdragon 7s Gen 3  |
| Android  | 15 (launch)                   |
| RAM      | 8 GB / 12 GB                  |
| Storage  | 128 GB / 256 GB (UFS 2.2)     |
