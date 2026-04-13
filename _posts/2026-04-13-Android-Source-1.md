---
layout: post
title: "Android Source Code Walkthrough - Introduction"
date: 2026-04-13 00:00:01 +0530
categories: [AOSP]
tags: [Android, AOSP, Vendor]
description: "A brief overview of Android Source Tree"
author: danascape
toc: true
---

```java
➜  android-16.2 ls
android
Android.bp -> build/soong/root.bp
art
bionic
bootable
bootstrap.bash -> build/soong/bootstrap.bash
build
cts
dalvik
developers
development
device
external
frameworks
hardware
kernel
libcore
libnativehelper
lk_inc.mk
out
packages
pdk
platform_testing
prebuilts
sdk
system
test
toolchain
tools
trusty
vendor
```

# Understanding the Android Source Tree
If you're opening the Android source tree for the first time, it can feel… overwhelming. There are dozens of top-level directories, many of which sound vaguely familiar but don’t immediately tell you what they actually do.

The good news is that you do not need to understand everything at once.

Think of the Android source as a layered system, where each directory plays a role in building the OS—from low-level hardware interaction all the way up to apps and UI.

Let’s walk through the important ones.

## Core System Foundations
These directories form the backbone of Android.

### **system/**

This is where core Android platform components live—things like system services, native daemons, and utilities.

If Android were a building, `system/` would be the plumbing and wiring.

### **frameworks/**

This is one of the most important directories.

It contains:
- Java framework (what app developers interact with)
- System services (ActivityManager, WindowManager, etc.)
- Binder IPC interfaces

If you're debugging behavior like activity lifecycle or system services, you're going to live here.

We will talk about this more in-detail in another part.

### **bionic/**

Android’s custom C library (instead of glibc).

Why it exists:
- Smaller footprint
- Optimized for mobile
- Tight integration with Android runtime

### **libcore/**

Core Java libraries used by Android.

Think of it as Android’s version of the standard Java library—but customized.

## Runtime & Execution
### **art/**

Android Runtime (ART).

This is where:
- Java/Kotlin code gets compiled
- Bytecode is executed
- Garbage collection happens

If you’re interested in performance, startup time, or memory, ART is key.

### **dalvik/**

Legacy runtime (pre-ART).

Mostly kept for historical reasons and some tooling compatibility.

## Apps & System Packages
### **packages/**

Contains built-in apps and system UI components.

Examples:
- Settings
- SystemUI
- Launcher (sometimes)

If you want to modify UI elements like status bar or quick settings, start here.

### **sdk/**

Tools and APIs exposed to developers.

Includes:
- SDK tools
- Emulator-related components
- API stubs

## Hardware & Device Layer
### **hardware/**

Hardware abstraction layer (HAL) implementations.

This is where Android talks to:
- Camera
- Audio
- Sensors

### **device/**

Device-specific configurations.

Each device has its own folder with:
- Board configs
- Build flags
- Hardware mappings

### **vendor/**

Closed-source or proprietary components.

Usually provided by OEMs:
- Drivers
- Firmware blobs
- Vendor-specific HALs

If something works but you can’t find the source—it's probably here.

### **kernel/**

The Linux kernel repositories used by Android devices.

Contains:
- Prebuilt kernels
- Common Kernel configurations
- Kernel and Module Sources

Important note: This is often maintained separately from AOSP.

## Build System & Tooling
### **build/**

Android’s build system (Soong + Make).

Controls:
- How modules are compiled
- Dependency resolution
- Build targets

### **prebuilts/**

Precompiled binaries used during build.

Examples:
- Compilers
- Toolchains
- Some libraries

### **toolchain/**

Compilers and related tools.

Closely tied with prebuilts/.

### **development/**

Various development tools and scripts.

Used internally for:
- Testing
- Debugging
- Profiling

## Testing & Validation
### **cts/**

Compatibility Test Suite.

Used to ensure:
- Devices meet Android standards
- Apps behave consistently across devices

### **platform_testing/**

Additional testing infrastructure beyond CTS.

### **test/**

General testing utilities and frameworks.

## Security & Misc
### **trusty/**

Trusted execution environment (TEE).

Used for secure operations like:
- Key storage
- Secure boot interactions

### **external/**

Third-party open-source libraries used by Android.

Examples:
- SQLite
- Web-related libraries
- Media codecs

### **bootable/**

Code related to boot process:
- Recovery
- Bootloader components

## More Useful Ones
### **out/**

Build output directory.

This is where your compiled system images go.

### **pdk/**

Platform Development Kit.

Used by OEMs before public releases.


# How to Think About This Tree

Instead of memorizing everything, use a mental model:

- **Top → Apps & UI → packages/, frameworks/**
- **Middle → System logic → system/, art/, libcore/**
- **Bottom → Hardware → hardware/, device/, vendor/, kernel/**
- **Side → Build & tools → build/, prebuilts/, toolchain/**

Once you map a bug or feature to a layer, finding the right directory becomes much easier.

<hr style="margin-top: 40px; margin-bottom: 20px;">

<pre style="
font-family: monospace;
background: #0d1117;
color: #c9d1d9;
padding: 16px;
border-radius: 8px;
overflow-x: auto;
line-height: 1.6;
">

Built, broken, and dumped by Saalim

Find me on:
GitHub   → <a href="https://github.com/danascape" style="color:#58a6ff;">danascape</a>
LinkedIn → <a href="https://www.linkedin.com/in/saalim-quadri/" style="color:#58a6ff;">saalim-quadri</a>
YouTube  → <a href="https://youtube.com/@danascape" style="color:#58a6ff;">@danascape</a>
Twitter (X)  → <a href="https://x.com/danascape" style="color:#58a6ff;">@danascape</a>

Got thoughts, feedback, or just want to drop a hi?
→ <a href="mailto:saalim.priv@gmail.com" style="color:#58a6ff;">saalim.priv@gmail.com</a>

</pre>

<hr style="margin-top: 20px;">