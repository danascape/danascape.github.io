---
layout: post
title: "Features and Future Scope in AOSP - Part 2"
date: 2025-07-22 00:00:00 +0530
categories: [AOSP]
tags: [AOSP, Android]
author: danascape
toc: true
---

***Something that started as a hobby of mine, to something that I do professionally in my daily life.***

## Core Features
* Modular Architecture
    * Dynamic partitions for seamless A/B updates (and easy rollback) across devices.
    * Many System Components packaged as APEX modules.
    * Mainline Modules allow Google to update system components via Play Store.
    * GKI (Generic Kernel Image) standardizes kernel builds across various devices.

* Flexibility
    * Modify or change SystemUI, Quick Settings, lockscreen, and much more.
    * Runtime Resource Overlay framework for live theming and UI-tweaks all without rebuilding or reflashing.
    * Add or remove default apps, permissions, or behavior.
    * Extend frameworks/base to add your own services or APIs.

* Device Portability
    * Supports bring-up on custom boards, embedded devices and even x86_64!.
    * Includes HAL support via HIDL and AIDL.
    * Tools like lunch, fastboot, and adb make flashing and testing straightforward.
    *  Bazel compatible manifests, adb with QUIC based wireless debugging and fastboot with seamless encryption and rollback‑protection flags makes testing straightforward.

* Debugging and Diagnostics
    * Built-in support for logcat, dmesg, perfetto, and tracing tools.
    * Debugging native crashes, init, and system_server flows is built into the platform.
    * Support for selinux, audit logs, and boot logs for system hardening.

## Future Scope
Once you're fluent with AOSP internals, here's what you can build, experiment with, or scale into:

* Custom OS Development
    * Build custom AOSP forked operating systems (LineageOS, GrapheneOS).
    * Tailor Android to fit specific products like educational tablets, kiosks, or PoS systems.

* Android on Non-Phone Devices
    * Bring AOSP to Raspberry Pi, x86, or other SOMs.
    * Work on Android TV, Wear OS, and Android Automotive OS.
    * Use AOSP in robotics, industrial systems, and infotainment units.
    * Spatial & XR Platforms.

* Research and Innovation
    * Explore Android security internals, SELinux policies, sandboxing (zygote).
    * Modify the runtime (ART), resource management and more.
    * Run performance benchmarks, memory leak detection, or boot time analysis.

* Productization
    * Use AOSP as a base to build proprietary products with or without Google Mobile Services (GMS).
    * Integrate it with hardware sensors, microcontrollers, and custom kernel drivers.
    * Provide a flexible set of applications by choice.

## Careers
AOSP experience opens doors in deep system-level engineering. Roles include:

* **AOSP Engineer**
    * Work on full AOSP Stack, from frameworks to applications, and core libraries, maintaining source, updating patches, etc.

* **Android Framework Developer**
    * Modify and extend platform behavior, build custom APIs, tweak system services.

* **Android BSP / Board Bring-up Engineer**
    * Port Android to new hardware, write or integrate HALs, handle kernel-space issues.

* **Embedded Android Developer**
    * Use Android as a base for headless, industrial, or minimal systems.

* **Android Security Engineer**
    * Work on system hardening, SELinux, verified boot, encryption, and OTA update security.

* **Kernel & Driver Developer**
    * Customize the Linux kernel for Android, optimize power, write drivers (e.g., I2C, SPI, camera).

* **OS Maintainer or Custom ROM Contributor**
    * Maintain forks of Android, add features, upstream patches, or support open devices.



If you do not understand anything, that is alright, we will cover everything in this series.
Stay tuned for Part 3.


I am also planning to start with a Youtube channel:
* **Stay tuned: [Youtube][youtube]**

Have questions or want to collaborate? Reach out to me on my [email][email]

[previous-post]: https://squadri.me/posts/7/
[youtube]: https://www.youtube.com/@danascape
[email]: mailto:saalim.priv@gmail.com