---
layout: post
title: "Cross-Compiling Android Linux Kernel"
date: 2024-07-24 00:00:00 +0530
categories: [Linux Kernel]
tags: [Linux, Kernel, Linux Kernel]
author: danascape
toc: true
---

When you use your Android device, you're interacting with a complex system that relies heavily on the Linux kernel at its core. But what exactly is the Android Linux kernel, and how does it work?

![](/assets/images/posts/Cross-Compiling-Android-Linux-Kernel/cc_lk_intro.png)

## What is Linux Kernel?
The Linux kernel is the core component of the Linux operating system, responsible for managing hardware resources (such as the CPU, memory, and devices), providing essential services to software applications, and ensuring secure and efficient operation of the entire system.

## What is the Android Linux Kernel?
The Android Linux kernel is a version of the Linux kernel, based on Long Term Stable (LTS). At Google, LTS kernels are combined with Android-specific patches to form what are known as Android Common Kernels (ACKs).

For the tutorial, I’m using Ubuntu 22.04 running inside a 8 Core, 16GB RAM machine. However, the steps should be the same independent of whether you’re using a virtual machine, running a different version of Linux, etc.

## Prerequisites
Certain requirements are to be met before compiling the Linux Kernel.
* Ability to understand basic editing/writing of files and text, familiarity with the linux command line interface and some basic git knowledge.

## Establishing a Build Environment
To build the Kernel, a Linux build machine is recommended, with some minimal specifications as long as it can configure make.

To setup the Linux build environment , you can directly run this command on your linux machine with elevated permissions:
```shell
curl https://raw.githubusercontent.com/akhilnarang/scripts/master/setup/android_build_env.sh | sudo sh
```

### 1. Set up the cross-compiling toolchain

In order to compile source code into machine code that is not native to the build machine, a cross-compiler has to be used.
```shell
$ git clone --depth=1 -b 11.x https://gitlab.com/stormbreaker-project/google-clang clang-11
$ git clone --depth=1 https://github.com/stormbreaker-project/aarch64-linux-android-4.9 gcc64
$ git clone --depth=1 https://github.com/stormbreaker-project/arm-linux-androideabi-4.9 gcc32
$ export PATH=$PATH:$PWD/clang-11/bin:$PWD/gcc64/bin:$PWD/gcc32/bin
```

### 2. Download the Source Code
We are going to pickup a source that is already being worked on, you can take sources from ODM pages of various android devices that are launched.

* Google: https://android.googlesource.com/kernel/msm/+refs
* Xiaomi: https://github.com/MiCode/Xiaomi_Kernel_OpenSource
* OnePlus: https://github.com/oneplusoss
* Nothing: https://github.com/nothingoss
* Realme: https://github.com/realme-kernel-opensource
* Samsung: https://opensource.samsung.com/main

So after hovering around, download your favorite source code in a directory

```shell
$ git clone https://github.com/stormbreaker-project/linux-oneplus-billie
```

We generally do not require the commit history, so to speed up the process, use the `--depth` argument to only clone the most recent version of all the files:
```shell
$ git clone --depth=1 https://github.com/stormbreaker-project/linux-oneplus-billie
```
This can take a few minutes.

### 3. Configure the Build
Next, we need to configure the kernel build. The easiest option is to just build with the default configuration
```shell
cd linux-oneplus-billie
make O=out ARCH=arm64 vendor/billie-perf_defconfig
```
Alternatively, we can also copy the configuration from an existing build.
```shell
$ adb pull /proc/config.gz
$ gunzip -c config.gz > out/.config
```
This will use adb to establish a connection with the device and copy the configuration from the default location at `/proc/config.gz`. This is a virtual location provided by a kernel module.

### 4. Build the Kernel
Now that everything is configured, we can start the build process. Run the following command to build the kernel image. Modify the `-j` parameter to approximately correspond with the number of CPU cores your host machine has. Higher values will lead to fast build times.
```shell
make -j14 O=out ARCH=arm64 CROSS_COMPILE=aarch64-linux-android- CROSS_COMPILE_ARM32=arm-linux-androideabi- CC=clang CLANG_TRIPLE=aarch64-linux-gnu- 
```

The build machine will now take a while to compile the kernel. This might vary as per machine configuration, it took me about 10-15 minutes until the build was finished.

### 5. Booting the Kernel
All that's left now is to flash the kernel Image. There are various methods to install a kernel image on android devices.

* AnyKernel3: https://github.com/osm0sis/AnyKernel3
* Android mkboot: https://android.googlesource.com/platform/system/tools/mkbootimg/
* Live Boot
Here we will use LiveBoot, since the other methods requires many more device-side features, so let's keep that aside.
To Live Boot the Kernel image, reboot your device to bootloader.
```shell
fastboot boot out/arch/arm64/boot/Image.gz
```
The device will reboot automatically, and run the freshly installed kernel.

### Note:
* Flash methods vary for each device and manufacturer, so I used a generic method in the process which **MIGHT NOT** work for some devices.
* For AnyKernel3 to work, one needs to make device specific recovery changes, like defining boot partition path and device spec name, for it to work.
* Not all Flash methods are mentioned here. Refer to your ODM guides on how to install the kernel image.

Let me know your new experiences at [my email][email].

[email]: mail:danascape@gmail.com