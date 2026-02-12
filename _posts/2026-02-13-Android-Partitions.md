---
layout: post
title: "Android Partioning"
date: 2026-02-13 00:00:00 +0530
categories: [AOSP]
tags: [Android, AOSP, Frameworks, Vendor]
description: "Some notes regarding filesystem in Android devices"
author: danascape
toc: true
---

Modern Android devices use dynamic partitions, A/B slots, and GKI separation, so partition layouts are more modular and OTA-friendly than pre-Treble devices.

## Boot Chain Partiitons
- **boot Partiiton**
    - Built using `mkbootimg`
    - Contains:
        - Kernel (`Image`, `Image.gz`, etc)
        - **Vendor ramdisk fragments (Android 12+)
        - Bootconfig
    - Verified by AVB
    - Overwritten by OTA
    - **`With GKI (Android 12+), the kernel is generic and vendor modules move to vendor_dlkm`**

- **init_boot Partition (Android 13+)**
    - Contains the generic Ramdisk
    - Required for devices launching with Android 13+
    - Boot partition now contains vendor ramdisk fragments
    - Enables cleaner separation between generic and vendor init

- **vbmeta Partition**
    - Part of AVB 2.0
    - Contains hash/signature metadata for:
        - boot
        - system
        - vendor
        - product
        - etc.
    - Prevents tampering
    - There is also:
        - **`vbmeta_system`**
        - **`vbmeta_vendor`**

## Core System Partitions (Treble)
- **system Partition**
    - Android framework
    - System apps
    - `/system/bin`, `/system/lib*`
    - APEX packages (mounted at runtime)

- **vendor Partition**
    - SoC vendor binaries
    - HAL implementations
    - Vendor services
    - Required for treble compliance

- **product Partition**
    - Product-specific customizations
    - Product-specific apps and overlays
    - Was introduced to modularize system/vendor

- **system_ext Partition**
    - Extensions to system image
    - OEM additions that extend framework APIs
    - Helps avoid modifying `/system`

- **odm Partition**
    - ODM customizations to SoC BSP
    - Board-specific HALs
    - Device SKU variations

## Kernel Module Partitions (GKI)
- **vendor_dlkm**
    - Vendor kernel modules

- **odm_dlkm**
    - ODM-specific kernel modules

- **system_dlkm**
    - GKI system kernel modules (if used)

## Update/Encryption/Security Partitions
- **A/B Slot Partitions**:
    - On seamless update devices:
        - `boot_a`, `boot_b`
        - `system_a`, `system_b`
        - etc.
    - Inactive slot is updated, then switched

- **recovery Partition**
    - Stores recovery image (non-A/B devices, initial A/B devices)
    - On A/B devices:
        - Recovery ramdisk might be inside `boot` or `init_boot`
        - No standalone partition

- **cache Partition (Legacy)**
    - Used for OTA staging (non-A/B devices)
    - Obsolete now

- **misc Partition**
    - Stores:
        - Bootloader control block (BCB)
        - Recovery commands
        - Slot metadata (before)
    - Still present even on A/B devices

- **userdata Partition**
    - `/data`
    - User apps and data
    - File-based Encryption (FBE)
    - Adoptable storage metadata

- **metadata Partition**
    - Stores metadata encryption keys
    - Required for:
        - FBE
        - Metadata encryption
        - Virtual A/B snapshots
    - Critical for devices

- **persist Partition**
    - Calibration data:
        - WiFi
        - Bluetooth
        - Sensors
    - Factory provisioning data
    - Not wiped on factory reset

## Radio & Firmware Partitions
- **radio/modem**
    - Baseband firmware
    - for cellular devices

- **dsp/bluetooth/abl/xbl**
    - `xbl` - Qualcomm bootloader stage
    - `abl` - Android bootloader
    - `tz` - TrustZone firmware
    - There are SoC-specific and not standardized

## Trusted Execution Environment
- **tos/tz**
    - Stores trusted OS
    - Example: Trusty
    - Used for:
        - Keymaster
        - Gatekeeper
        - Secure Storage

## Dynamic Partitions
- **super**
    - A container partition holding logical partitions:
        - system
        - vendor
        - product
        - etc.
    - Managed by:
        - `lpmake`
        - `lpunpack`
    - Advantages:
        - Resization partitions
        - No fixed size wastage
        - Easier OTA resizing

## Snapshot Partitions (Virtual A/B)
- With Virtual A/B (Android 11+):
    - Snapshots stored in `userdata`
    - Uses:
        - dm-snapshot
        - COW (Copy-on-write)
    - Eliminates need for full duplicate partitions
    - Reduces storage overhead compared to classic A/B
