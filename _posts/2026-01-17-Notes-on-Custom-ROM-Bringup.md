---
layout: post
title: "Notes on Custom ROM Bringup"
date: 2026-01-17 00:00:00 +0530
categories: [AOSP]
tags: [Android, AOSP, Frameworks, Vendor]
description: "My personal notes dump on custom ROM bringup by forking AOSP"
author: danascape
toc: true
---

## What this is?
A practical dump of things I keep re-learning while bringing up AOSP-based fork. Not a tutorial, more like **notes / a checklist I wish I had kept** while bringing up custom ROMs over the years.

Ain't gonna write "What is a custom ROM?"

## Picking the right AOSP tag
For a custom ROM bring-up, the first thing I look out for is the **Android tag / revision** I need to pick.

Tags can be found here:  
[https://source.android.com/docs/setup/reference/build-numbers][build-numbers]

AOSP manifest repo is here:  
[https://android.googlesource.com/platform/manifest][platform-manifest]

The manifest branch is linked with the build number. Usually I pick the revision for a specific Android version which has the **maximum number of Pixels supported** (since that branch tends to get the most attention and patches).

Source push has been a bit weird now though, since a lot is going on from Google's side, if you are here then you know the news :D.

This approach was pretty reliable till Android 15. For Android 16, I just picked the latest available revision.

## Syncing the source
After that, the next step is syncing the source and getting one of my devices ready to build with it.

In most use cases, **the AOSP source is already fine**. The work is mostly about adapting and aligning:
- device tree
- platform-side trees (HALs, kernel prebuilts)
- and whatever is needed for the build to compile and boot

If the build compiles but doesn’t boot, it’s usually a device/platform side issue. AOSP is built to support a wide range of devices, it’s not meant to perfectly support *your* device out of the box.

I’ll talk about platform/device-specific problems in a separate post, because this post is focused more on **custom ROM bring-up**.

## Building and flashing
Once the source is synced and my platform trees are in place, the next step is building and flashing the ROM.

This can be an `otapackage` or an `updatepackage` depending on what you're targeting.

One recommendation I’d personally give: **don’t pick a legacy device for your first builds**.

Things like:
- pre-BPF devices
- pre-dynamic partitions devices

…might need extra patchsets in the build system just to boot properly. That stuff becomes a topic on its own, and the goal here is to boot **pure AOSP** first.

Back in the day, I used to maintain pure AOSP trees + patchsets to make them boot on devices. But now, with a full-time job, maintaining all that is honestly a pain, so I don’t want to go deep into that here.

## First boot: “This is AOSP… and it’s empty”
Once the OS boots, it’s pure AOSP with **nothing extra added at all**.

And yeah it looks exactly like that.

At this point you start realizing how much OEMs actually do on top of AOSP to reach what we see in things like:
- OneUI
- ColorOS
- Pixel builds

So from here, the real “custom ROM work” happens.


## Deciding what UI/UX you want
The next part is deciding what kind of UI/UX and feature-set you want in your ROM.

For example:
- QuickSettings customisation
- Launcher changes
- Settings changes
- extra apps
- SystemUI tweaks
- and a lot more

AOSP is very generic, so to make the ROM usable for daily driving you basically need to decide what ecosystem you want to continue with.

## Apps: GMS, microG, or your own set
For the application part, I usually see these options:

- Integrate Pixel GMS package (GApps)
- Use microG
- Or pick your own set of apps from ROM projects

Some good options people commonly borrow from ROM ecosystems:
- LineageOS apps, like Aperture, Glimpse, Jelly, Gramophone, etc
- ParanoidAndroid
- HelluvaOS

This usually solves the “base system apps” problem, because these are apps that most people use daily anyway.

## Customising UI (the fun and painful part)
After the basics, I usually focus on UI customisation first.

There are many ROMs out there, but I’ll mention the “sane” ones, the ones that actually have original feature-sets or something that makes them unique.

### Rebranding the ROM
A lot of ROM identity comes from rebranding. Examples:
- LineageOS
- Paranoid Android
- LMODroid

Rebranding can happen in multiple places:
- the flashable zip / build branding
- package names and overlays
- versioning shown in Settings → About

A simple example of how ROM versioning gets shown in Settings:  
[https://github.com/PVOT-OSS/Settings/commit/fa2e594c818447509d7f71d3304083056961b982][Settings-patch]

Usually this involves defining custom version properties and reading them in Settings to display ROM name/version properly.

Some ROMs also handle this differently (like LMODroid), by using a separate Settings extension package and overlays.

Rebranding helps users see what OS they’re actually running.

## Deciding the feature-set
Then comes the main part: listing the features you want.

There are loads and loads of features that have been built on top of AOSP for more than a decade, since CyanogenMod days. Over time, features have evolved, been rewritten, and carried forward through multiple Android versions.

But honestly, what you pick depends on what kind of ROM you want:
- heavy UX modification
- privacy-focused build
- colorful/custom UI builds
- or a stable minimal OS with clean UX

Personally, I like modifications — but not too heavy.

The reason is simple: every extra feature you add becomes something you have to **carry forward to the next Android upstream**, and that eventually becomes painful.

So my aim is always a generic minimal OS, with only a limited set of features that are actually used by users.

Most features are exposed through Settings, but some ROMs also add a separate settings extension category to control:
- SystemUI
- QS
- status bar tweaks
- and other components

## Releasing the ROM (and letting the community break it)
After the core ROM feels usable, the next phase is releasing it and scaling it across devices.

Device maintainers in the community are usually keen to try building newer Android versions, and they will report ROM-specific issues pretty quickly.

Some devices (Samsung, MediaTek) usually need extra patchsets in the build system to become stable.

## Kernel build: AOSP vs Lineage approach
There’s also the kernel build side of things.

LineageOS has its own kernel build system that’s widely used across devices, making it easier to build kernel binaries from source.

Pure AOSP usually provides prebuilt solutions, and they also have `kernel_build` with Bazel to build kernel sources.

ParanoidAndroid also distributes it but the kernel is built separately, I do not want to delve in it, since it is CLO (pre: CAF) based fork.

## Long-term maintenance: patches, users, and rebases
Once the ROM gets stable, the real maintenance phase starts:
- fixing bugs
- answering users
- handling device-specific reports
- keeping everything stable across time

And then there are security patches.

Whenever a new monthly security patch is out:
- we merge patches by tracking CVEs across repos
- bump the security string
- handle changes that come with the monthly patch

Some months are simple. Some months come with bigger changes (QPR1 / QPR2 / QPR3), which gets more fun.

And then the final boss: a new Android upstream release.

That’s when the real race begins:
- rebasing patches
- booting quickly
- fixing breakage before everyone else does
- and repeating the whole cycle again

---

## Commands I use a lot

Not listing every command in existence, just the ones I keep using again and again during bring-up / debugging.

### Repo / source stuff
```bash
repo init -u https://android.googlesource.com/platform/manifest -b <branch>
repo sync -c -j$(nproc) --force-sync --no-tags --no-clone-bundle
repo status
repo forall -c "git status -sb"
```

### Build setup
```bash
source build/envsetup.sh
lunch
```

### Builds I mostly do
```bash
m otapackage
m updatepackage
m -j$(nproc)
```

### Flashing
```bash
adb reboot bootloader
fastboot devices
fastboot reboot
adb reboot recovery
adb reboot
```

### Logs
```bash
adb logcat -b all
adb logcat -b kernel
adb logcat
adb shell dmesg
adb shell getprop
adb shell getprop | grep -i boot
adb shell getprop | grep -i init
adb shell getprop | grep -i selinux
adb shell getevent
adb shell getevent -lp
adb shell id
adb shell ps -A
adb shell top
adb shell lsof
```

### SElinux
```bash
adb shell service list
adb shell dumpsys
adb shell dumpsys activity
adb shell dumpsys package
adb shell pm list packages
```

## Closing notes
This is basically how I approach custom ROM bring-up these days.

There’s no fixed recipe honestly every feature surprises you in a different way. But having a mental checklist like this saves a lot of time, especially when you’re coming back to the same mess after weeks/months.

If you’re doing custom ROM bring-up too, you probably know the feeling, sometimes the fix is one line, sometimes it’s 3 days of pain :)

Bring-up is pain, but it’s also kinda addictive.

I’ll keep updating this post whenever I hit something new (or whenever I forget the same thing again).

## Contact
You can hit me an email, if you have questions or anything else at [saalim.priv@gmail.com][email]


[build-numbers]: https://source.android.com/docs/setup/reference/build-numbers
[platform-manifest]: https://android.googlesource.com/platform/manifest
[Settings-patch]: https://github.com/PVOT-OSS/Settings/commit/fa2e594c818447509d7f71d3304083056961b982
[email]: mailto:saalim.priv@gmail.com