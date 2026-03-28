---
title: "Flashing Guide - Redmi Note 8 Pro (begonia)"
date: 2026-03-28
description: "Installation and update guide for custom ROMs on Redmi Note 8 Pro (begonia)"
tags: [flashing, android, custom-rom, begonia]
---

## Prerequisites

> **Warning:** Your warranty is void. If you brick your device, corrupt storage, or otherwise damage it — that is on you. Proceed at your own risk.

Before you begin:

- Your bootloader must be **unlocked**.
- A **custom recovery** (e.g. TWRP/PitchBlack or OrangeFox) must be installed.
- Make a **full data backup** — a clean flash will wipe everything.
- Ensure your device has at least **30% battery**.
- Only flash files meant for **Redmi Note 8 Pro (begonia/begoniain)**.
- First boot may take **5–10 minutes**. Do not interrupt or force reboot unless it exceeds 10 minutes.

---

## Unlocking the Bootloader

> Unlocking the bootloader wipes all data on the device.

1. Enable **Developer Options**: go to **Settings → About Phone** and tap **MIUI Version** 7 times.
2. In **Developer Options**, enable **OEM Unlocking** and **USB Debugging**.
3. Apply for bootloader unlock permission via the Mi Unlock app (may require a waiting period).
4. Download and run the **Mi Unlock Tool** on your PC.
5. Connect your device in fastboot mode (hold **Power + Volume Down**) and follow the tool's instructions.

---

## Installing a Custom Recovery

1. Boot into fastboot mode: hold **Power + Volume Down**.
2. Connect to your PC and verify the device is recognized:
   ```bash
   fastboot devices
   ```
3. Flash the recovery image:
   ```bash
   fastboot flash recovery recovery.img
   ```
4. Boot into recovery immediately (hold **Power + Volume Up**) to prevent MIUI from restoring the stock recovery.

---

## Clean Installation

1. Boot into your **custom recovery**.
2. Go to **Wipe → Advanced Wipe**.
3. Select **System**, **Vendor**, **Data**, **Dalvik**, **Cache** and confirm.
4. Flash the **ROM** zip.
5. If using a **vanilla/FOSS build**, flash **GApps** now. If using a **GMS build**, skip this step.
6. Reboot back into **Recovery**.
7. Select **Wipe → Format Data** and type `yes`.
8. Reboot to **System**.

---

## Update (Dirty Flash)

> Dirty flashing will **not** work for major Android version upgrades (e.g. Android 14 → Android 15).

### Method 1: OTA Update

1. Go to **Settings → System → System updates**.
2. Download the latest available build.
3. Tap **Reboot** once the download finishes.
4. The device reboots into recovery and installs the update automatically.
5. Reboot to **System**.

### Method 2: Recovery Flash

1. Reboot to **Recovery**.
2. Select **Install → Choose ROM → Swipe to flash**.
3. Reboot to **System**.

> **Note:** For vanilla builds, **GApps must be reflashed after every update**, including OTA and recovery-based dirty flashes.

---

## Device Info

| Field    | Details                |
|----------|------------------------|
| Codename | `begonia`              |
| SoC      | MediaTek Helio G90T    |
| Android  | 9 (launch)             |
| RAM      | 6 GB / 8 GB            |
| Storage  | 64 GB / 128 GB (UFS)   |
