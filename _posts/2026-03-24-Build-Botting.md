---
layout: post
title: "What is Custom ROM Build Botting?"
date: 2026-03-24 00:00:01 +0530
categories: [AOSP]
tags: [Android, AOSP, Frameworks, Vendor]
description: "First thing I did in Android Device Communities"
author: danascape
toc: true
---

## What is Build Botting?
Custom ROM build botting, in my opinion, is one of the most important things when getting started with AOSP. It helps you understand:

- Android source code structure
- Building a device from source
- Flashing builds
- Basic debugging and bring-up workflows

More importantly, it gets you comfortable with the build → boot → debug cycle, which is essential for any AOSP developer.

## My Experience
When I started with AOSP, I compiled hundreds of different custom ROMs. Even though many were forked from the same AOSP base, each had unique characteristics:

- UI/UX focused → Resurrection Remix
- Security-focused → GrapheneOS
- Popular ROM bases → PixelExperience, LineageOS
- CAF/CLO based → Paranoid Android
- Pure AOSP → Vanilla builds from Google

This exposure helped me reach a point where:

No matter what source I’m given, I can build it, debug basic issues, and fix boot failures.

## Building LineageOS (Pixel 8 (shiba)/Nothing 3a/pro (asteroids) Example)

This guide assumes you already have a working build environment set up (Ref: [https://github.com/akhilnarang/scripts/blob/master/setup/android_build_env.sh][akhil-scripts]).


### **Initialize the Repository**

Supported branches for Pixel 8 include:
- lineage-21.0
- lineage-22.1
- lineage-22.2
- lineage-23.0
- lineage-23.2

Supported branches for Nothing 3a/Pro include:
- lineage-23.0
- lineage-23.2

```shell
repo init -u https://github.com/LineageOS/android.git -b lineage-23.2 --git-lfs --no-clone-bundle
```

### **Sync Source Code**
```shell
repo sync
```

### **Setup Build Environment**
```shell
source build/envsetup.sh
```

### **Prepare Device Tree**
1. ```breakfast shiba``` or ```breakfast asteroids```
2. Sometime a device may not be officially supported in ROMs, so we pull-in device-trees manually from developer repositories or organisations.
    ```
    git clone -b lineage-23.2 https://github.com/danascape/android_device_nothing_asteroids device/nothing/asteroids
    git clone -b lineage-23.2 https://github.com/danascape/proprietary_vendor_nothing_asteroids vendor/nothing/asteroids
    git clone -b lineage-23.2 https://github.com/danascape/platform_hardware_nothing hardware/nothing
    git clone -b lineage-23.0 https://github.com/AKoskovich/android_kernel_nothing_sm7635 kernel/nothing/sm7635
    git clone -b lineage-23.0 https://github.com/AKoskovich/android_kernel_nothing_sm7635-devicetrees kernel/nothing/sm7635-devicetrees
    git clone -b lineage-23.0 https://github.com/AKoskovich/android_kernel_nothing_sm7635-modules kernel/nothing/sm7635-modules
    ```
    Note that here we cloned the vendor blobs manually

If vendor errors occur, extract proprietary blobs first/or clone vendor trees for the device from ([https://github.com/themuppets][the-muppets]), these are org-specific vendor repositories where the vendor blobs are updated as per device.
```shell
git clone -b lineage-23.2 https://github.com/TheMuppets/proprietary_vendor_google_shiba vendor/google/shiba
```
You can skip the next Step if doing the above and directly proceed to build.

### **Extract Proprietary Blobs**

Connect your Pixel 8 (ADB + root enabled):

```shell
cd device/google/shiba
./extract-files.py
```
(or .sh if applicable)

Blobs will populate:

`~/vendor/google`

### **Build the ROM**
```shell
croot
brunch shiba
```

```shell
croos
brunch asteroids
```

### **Output Files**

After a successful build:
```
cd $OUT
```
Important files:
- vendor_boot.img → Recovery image
- lineage-23.2-xxxx-UNOFFICIAL-shiba.zip → Flashable ROM

Important files:
- vendor_boot.img → Recovery image
- lineage-23.2-xxxx-UNOFFICIAL-asteroids.zip → Flashable ROM

## Final Thoughts

You’ve now:
- Built Android from source
- Understood device bring-up basics
- Experienced the real AOSP workflow


Importantly:
You now have the confidence to take on any Android source and make it work.

## Why Build Botting Matters

Build botting isn’t just about compiling ROMs repeatedly—it’s about:
- Pattern recognition in build failures
- Faster debugging instincts
- Understanding Android’s architecture deeply

It’s one of the fastest ways to level up as an AOSP engineer.

That’s where the real fun begins.

## Closing Note
This is pretty much the same method used to build almost every custom ROM out there.
Some ROMs may throw SELinux (sepolicy) errors, some may fail to boot entirely, but that’s where the real learning begins.

`Debugging is the fun part.`

Build commands and workflows may vary slightly between ROMs, but once you understand the fundamentals, adapting becomes easy.

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

[akhil-scripts]: https://github.com/akhilnarang/scripts/blob/master/setup/android_build_env.sh
[the-muppets]: https://github.com/themuppets