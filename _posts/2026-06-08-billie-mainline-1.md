---
layout: post
title: "Mainlining OnePlus Nord N10 5G - Part 1"
date: 2026-06-08 00:00:01 +0530
categories: [Mainline]
tags: [Linux, Mainline, Qualcomm, postmarketOS]
description: "You do not need much to boot a mainline kernel"
author: danascape
toc: true
---

## What is Mainlining?

Mainlining means getting a device to run on the upstream Linux kernel "the Linus Torvalds tree", instead of the vendor-patched, years-old downstream kernel that shipped with the phone.

Why? A few reasons:

- Long-term security updates without depending on the OEM
- Access to modern kernel features and improvements
- The device becomes useful long after official support ends
- It is genuinely fun
- Genuinely helps in learning random things and breaking around the sources

## The Device

The **OnePlus Nord N10 5G** (codename: `billie`) is a mid-range device from 2020 powered by the **Snapdragon 690 5G (SM6350)**.

What makes this a good candidate for mainlining is that **SM6350 already has upstream SoC support** in the Linux kernel. The SoC-level device tree (`sm6350.dtsi`) and the associated drivers are already merged upstream (Credits to Luca and Konrad). That takes care of the hardest part, you do not need to write SoC bring-up from scratch, which made things significantly easier for me.

All that is needed is a device-specific DTS on top of it.

## Why postmarketOS?

I chose [postmarketOS](https://postmarketos.org) as the base for this work.

Their documentation is detailed, `pmbootstrap` makes flashing and iterating quick, and the `pmaports` structure gives a clean way to maintain the device port. The community is also very active in the mainline space, so there is a lot of prior art to reference.

## The First DTS

The goal for part 1 was simple: get the device to a **framebuffer console** and **SSH** over USB. Nothing more.

Here is the full DTS that got me there:

```dts
/dts-v1/;

#include "sm6350.dtsi"

/ {
    model = "Oneplus Nord N10 5G";
    compatible = "oneplus,billie", "qcom,sm6350";
    chassis-type = "handset";

    /* required for bootloader to select correct board */
    qcom,msm-id = <434 0x10000>, <459 0x10000>;
    qcom,board-id = <0x1000b 0>;

    chosen {
        #address-cells = <2>;
        #size-cells = <2>;
        ranges;

        stdout-path = "framebuffer0";

        framebuffer0: framebuffer@a0000000 {
            compatible = "simple-framebuffer";
            reg = <0x0 0xa0000000 0x0 (1080 * 2400 * 4)>;
            width = <1080>;
            height = <2400>;
            stride = <(1080 * 4)>;
            format = "a8r8g8b8";
        };
    };

    reserved-memory {
        bootloader-log@9fff7000 {
            reg = <0x0 0x9fff7000 0x0 0x8000>;
            no-map;
        };

        ramoops@cbe00000 {
            compatible = "ramoops";
            reg = <0x0 0xcbe00000 0x0 0x400000>;
            record-size = <0x40000>;
            console-size = <0x40000>;
            ftrace-size = <0x40000>;
            pmsg-size = <0x200000>;
            ecc-size = <0x0>;
        };

        param@cc200000 {
            reg = <0x0 0xcc200000 0x0 0x100000>;
            no-map;
        };

        mtp@cc300000 {
            reg = <0x0 0xcc300000 0x0 0xb00000>;
            no-map;
        };
    };
};

&dispcc {
    status = "disabled";
};

&sdhc_2 {
    status = "okay";

    cd-gpios = <&tlmm 94 GPIO_ACTIVE_HIGH>;
};

&tlmm {
    gpio-reserved-ranges = <13 4>, <56 2>;
};

&ufs_mem_hc {
    status = "okay";
};

&ufs_mem_phy {
    status = "okay";
};

&usb_1 {
    status = "okay";
};

&usb_1_dwc3 {
    maximum-speed = "super-speed";
    dr_mode = "otg";
};

&usb_1_hsphy {
    status = "okay";
};

&usb_1_qmpphy {
    status = "okay";
};
```

Let me walk through the important parts.

## DTS Walkthrough

### Board Identity

```dts
qcom,msm-id = <434 0x10000>, <459 0x10000>;
qcom,board-id = <0x1000b 0>;
```

These are Qualcomm-specific properties the stock bootloader uses to select the correct DTB at boot. Without them the bootloader will not pick up the right device tree and the device will not boot. These values comes from the downstream kernel's device tree.

Working on a custom bootloader is very tough and almost impossible without access to UART Pins, so we are going to stick to using stock BL for the rest of the series.

### Simple Framebuffer

```dts
framebuffer0: framebuffer@a0000000 {
    compatible = "simple-framebuffer";
    reg = <0x0 0xa0000000 0x0 (1080 * 2400 * 4)>;
    width = <1080>;
    height = <2400>;
    stride = <(1080 * 4)>;
    format = "a8r8g8b8";
};
```

The bootloader already initializes the display before handing off to the kernel. The `simple-framebuffer` driver takes over that pre-initialized framebuffer and exposes it to userspace. The address `0xa0000000` come from inspecting the downstream kernel (Look for a memory region called cont_splash_region in your downstream device tree).

`dispcc` is explicitly disabled because the display clock controller driver is not being used yet. Leaving it enabled alongside `simple-framebuffer` causes glitches like screen refreshing and not remaining stable, it will boot, but you do not need glitches on console screen (scary).

### Reserved Memory
The regions (`bootloader-log`, `param`, `mtp`) are carved out from the downstream memory map to prevent the kernel from clobbering memory the bootloader or firmware depends on.

### Storage

```dts
&ufs_mem_hc { status = "okay"; };
&ufs_mem_phy { status = "okay"; };
```

Enables UFS. Without this the root filesystem is inaccessible and the device will not boot into userspace, will remain on initramfs console which will give you telnet on debug.

```dts
&sdhc_2 {
    status = "okay";
    cd-gpios = <&tlmm 94 GPIO_ACTIVE_HIGH>;
};
```

Enables the SD card slot. GPIO 94 is the card-detect pin.

### USB

```dts
&usb_1_dwc3 {
    maximum-speed = "super-speed";
    dr_mode = "otg";
};
```

Enabling USB is what gives you SSH. With postmarketOS, USB networking is set up automatically unless disabled and you can SSH into the device over a USB cable.

## What Doesn't Work Yet

At this stage:

- Display works only through simple-framebuffer
- No DRM display driver
- No touchscreen
- No audio
- No modem
- No Wi-Fi
- No cameras
- No battery reporting

## Result

With this DTS, the device booted to postmarketOS userspace with:

- Framebuffer console showing boot messages on the display
- SSH access over USB

That is enough to explore, test drivers, and iterate.

Part 2 will cover bringing up more peripherals.

`The less you add, the easier it is to debug what broke.`

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
