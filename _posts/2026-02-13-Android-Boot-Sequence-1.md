---
layout: post
title: "Android Boot: Qualcomm Boot Sequence - 1"
date: 2026-02-13 00:00:01 +0530
categories: [AOSP]
tags: [Android, AOSP, Frameworks, Vendor]
description: "What happens when you press power-on"
author: danascape
toc: true
---

## What happens when you press Power?
- When you press the power button on a modern Qualcomm-based Android device, a precisely choreographed chain of hardware-enforced trust begins executing (long-before Linux or Android every exist in memory)


## Power-on: Starting (BootROM + QFPROM)
### QFuses and QFPROM
Qualcomm devices rely on **hardware fuses** to permanently configure security state and cryptographic root keys.
These fuses are:
- Stored in a region of the SoC called **QFPROM**
- Programmed via **Qfuses**
- One-time programmable (OTP :))

They determine things like:
- Where secure boot is enabled
- which root certificate hash is trusted
- Debug enablement
- JTAG access
- Anti-rollback counters

On production devices, the **Secure Boot fuse is blown**, meaning cryptographic verification is permanently enforced.
If it is not blown (dev devices), signature enforcement can be bypassed allowing to boot anything!

### BootROM (Primary Boot ROM)
Inside the SoC is a **ROM-based bootloader** which is an immutable silicon logic AKA:
- BootROM
- Often heard as **PBL ROM**

This cannot be modified.

It is responsible for:
- Reading security configuration from **QFPROM**
- Establish hardware root-of-trust
- Load the next-stage bootloader from storage
- Verify its signature (if secure boot is enabled)

If Secure Boot is enabled, BootROM verifies the signature of the next stage using the fused root key hash.

**If verification fails, device halts (or EDL).**

## PBL: Primary Bootloader
The **Primary Bootloader (PBL)** is loaded from boot media:
- UFS or eMMC

BootROM authenticates it using Qualcomm's hardware crypto engine before execution.

Once PBL starts it:
- Brings up minimal clocks
- Initialises limited memory
- Sets up auth framework
- Verifies the next bootloader stage

It does not bring up full DRAM or complex subsytems, just enough to continue this secure chain.

## XBL: Secondary Bootloader
Older QCOM platforms used SBL (Secondary bootloader)
Modern SoCs (From SDM845+) use:
- XBL (eXtensible Bootloader)

XBL is modular and split into components like **XBL Loader, XBL Core, XBL Config, AOP firmware, TZ firmware, Hyp firmware, Devcfg**

It is very important for:
- **Hardware Bring-up**
    - Full DDR initialization
    - CPU clusters
    - Power domains
    - Memory Controller
    - Peripheral subsystems
- **Firmware Loading**
    - XBL authenticates and loads:
        - TrustZone firmware
        - RPM/AOP firmware
        - Hypervisor firmware as well! (on supported devices)
- **Secure World Initialization**
    - Qualcomm ARM chipsets implement ARM TrustZone
    - TrustZone creates two execution environments:
        - **Secure World** (EL3/Secure EL1)
        - **Normal World** (Android/Linux)
- During XBL Stage:
    - Secure Monitor is initialized
    - TrustZone OS (QSEE/QTEE) is loaded
    - Crypto services become available
    - Secure key storage is activated

This all happens **before Linux ever exists**

At this point, the secure execution environment is live and enforced in hardware.

## Aboot/ABL (Android Bootloader)
Historically, **aboot (Little Kernel-based)**

Modern devices use **ABL (Android Bootloader)** often based on **EDK2 (UEFI-style implementation)**.

It is responsible for:
- Boot mode selection (normal, recovery, fastboot)
- Device state evaluation (locked/unlocked)
- AVB verification
- Loading Linux

### Android Verified Boot (AVB 2.0)
Modern Android uses AVB 2.0, not dm-verify alone.

ABL:
- Verifies `vbmeta`
- Validates hash tree metadata
- Checks rollback state
- Validates:
    - boot
    - vendor_boot
    - dtbo
    - super (logical partitions)
    - etc.
- Reports verification state to kernel via boot parameters

Verification states:
- **GREEN (locked + verified)**
- **YELLOW (custom key)**
- **ORANGE (unlocked)**
- **RED (verification failure)**

If the device is unlocked:
- Signature verification may be skipped
- ORANGE state is reported

**This is where OEM unlock policy is enforced**

## Loading the Linux Kernel
After successful AVB verification:

ABL loads into memory:
- Linux Kernel
- ramdisk (from `boot` or `vendor_boot`)
- Device Tree Blob (DTB)
- Device Tree Overlays (DTBO)

Modern devices no longer have "system-as-root" extraction anymore. Instead:
- Kernel mounts logical partitions via `init`
- Dynamic Partitions are handles by `init` + `fs_mgr`
- First-stage init runs from ramdisk

Control is then transferred to the Linux Kernel entry point.

## Kernel to init to Android
The Linux Kernel:
- Sets up MMU
- Initialises scheduler
- Mounts early filesystems
- Executes first-stage `init`

`init`:
- Parses fstab
- Mounts logical partitions
- Sets up SELinux
- Starts ueventd
- Transitions to second-stage init
- Launches Zygote
- Starts system_service

Anddd....

**Android userspace is alive**

## Some Notes
- PBL is not always stored in BootROM, which contains immutable loaded logic; PBL is loaded from storage and verified
- SBL is legacy; XBL is modern
- dm-verify now in AVB 2.0, is not a separate verification step
- system-as-root is evolved; now we have dynamic partiitons + first-stage init
- ABL is usually UEFI-based; not LK