---
layout: post
title: "Mainlining OnePlus Nord N10 5G - Part 2: The Touchscreen"
date: 2026-07-22 00:00:01 +0530
categories: [Mainline]
tags: [Linux, Mainline, Qualcomm, Touchscreen]
description: "A phone you cannot touch is just an expensive paperweight"
author: danascape
toc: true
---

## Recap

In Part 1 I got **billie** (the OnePlus Nord N10 5G, `SM6350`) booting a mainline kernel to a framebuffer console with SSH over USB. At the end of that post there was a long list of things that did not work. Right at the top of it: **touchscreen**.

A phone you cannot touch is just an expensive paperweight, so that is where I went next.

## The plan (and where I actually worked)

The panel on billie is a **Himax HX83112F**. It talks over **SPI**, and it is a "no-flash" part, which matters a lot and I will get to it.

Here is the thing about touch controllers on Android phones: the vendor already wrote a driver. You just cannot use it. The OnePlus "touchpanel" framework is thousands of lines spread across a common core, a per-IC driver, a util layer, a notifier module, proc files, self-test code, gesture handling, and a device tree that iterates itself in ways I still do not fully understand. None of that is going anywhere near an upstream kernel.

So the goal was a **minimal, self-contained driver**: a plain `spi_driver`, an `input` device, one threaded IRQ. Nothing else.

One decision that saved me a lot of time: I did the actual bring-up on the **downstream 4.19 kernel** first, not on mainline. That sounds backwards for a mainlining series, but the downstream tree already has a working display, the firmware sitting in the right place, and a reference driver I could diff my behaviour against when something went wrong. Get it working where you can iterate, then carry the clean driver upstream. The driver is written in mainline style either way, so the port is mostly deleting downstream-only glue.

## What "no-flash" means

Most touch controllers keep their firmware in an on-chip flash. You flash it once and forget about it.

The HX83112F has no flash. Its firmware lives in the rootfs as a plain blob, and it has to be **downloaded into the controller's SRAM after every reset** before the chip does anything at all. No firmware in SRAM means no touch, no interrupts, nothing. This one fact drives almost every hard part of the driver.

## Talking to the chip

Before firmware there is the bus. Every register access is wrapped in a two-byte Himax SPI header, `0xF2` for a write and `0xF3` for a read:

```c
#define HIMAX_SPI_WRITE   0xf2
#define HIMAX_SPI_READ    0xf3
```

On top of that framing sits an AHB register model: you write a 32-bit address, then read or write data through fixed sub-addresses. With that in place, the first useful thing you can do is ask the chip who it is:

```c
#define HIMAX_REG_ICID       0x900000d0
#define HIMAX_ICID_HX83112F  0x83112f
```

Read `0x900000d0`, shift off the low byte, and you should get `0x83112f`. The first time that check passed I knew SPI was wired correctly, which on a bring-up is a small celebration on its own.

## Loading the firmware (the part that fought back)

`request_firmware()` should be boring. It was not.

My first version loaded the blob in `probe()`. The device hung on the boot logo for a minute, then:

```
himax-hx83112f spi0.0: error ... failed to load firmware "Himax_firmware.bin"
himax-hx83112f: probe of spi0.0 failed with error -110
```

`-110` is `-ETIMEDOUT`. The problem is timing. At probe time, early in boot, `/vendor` is not mounted yet, so the file does not exist on any path the kernel searches. The request then falls through to the usermode-helper and sits there for the full 60 second timeout before giving up. That 60 second block *is* the boot-logo hang.

Two things came out of digging into how the vendor driver gets away with this:

1. It never loads firmware in probe. It waits for userspace to poke a procfs node, which only happens well after `/vendor` is up.
2. On Android the firmware is served by **ueventd through the usermode-helper fallback**, which searches `/vendor/firmware` and friends. The kernel's own direct-load path does not look there. So `request_firmware_direct()` (which skips the fallback) will *never* find the file, no matter how long you wait. You need plain `request_firmware()`.

So I moved the load into a retrying delayed work. Probe returns immediately, boot is never blocked, and the work keeps trying until ueventd can serve the file:

```c
ret = request_firmware(&fw, fw_name, ts->dev);
if (ret) {
    if (ts->fw_retries-- > 0) {
        schedule_delayed_work(&ts->fw_work,
                              msecs_to_jiffies(HIMAX_FW_RETRY_MS));
        return;
    }
    dev_err(ts->dev, "giving up loading firmware \"%s\": %d\n", fw_name, ret);
    return;
}
```

## The zero-flash download

Once the blob is in hand, it has to go into SRAM. The image is laid out as a 1K header, a 64K firmware body, and then a partition table describing config blocks:

- The 64K body is written to SRAM at `0x20000000`.
- The partition table is parsed, the config partitions are merged into one contiguous SRAM window, and that is written too.
- Both are verified with the controller's hardware CRC engine, cross-checked against a CRC-32C I compute in software.
- Then flash-reload is disabled so the chip runs from SRAM, and the analog front-end is sensed on.

None of this is glamorous, but if a single address is wrong the CRC fails silently and you spend an evening wondering why a "working" download does nothing.

## The interrupt storm

Firmware loaded. CRC clean. `touchscreen ready` in the log. And touch did not work.

`getevent` showed nothing. So I looked at the interrupt count:

```
$ grep himax /proc/interrupts
316:  201984  ...  msmgpio  22 Level  himax-hx83112f
316:  206731  ...  msmgpio  22 Level  himax-hx83112f
316:  210399  ...  msmgpio  22 Level  himax-hx83112f
```

That is climbing by thousands per second, and I was not touching the screen. An **interrupt storm**.

The line is level-triggered and active-low. The chip pulls it low when it has a coordinate frame for you, and it releases it once you *read the frame out of the FIFO*. My handler was reading the FIFO, but in the wrong bus mode, so it got back garbage, failed the checksum, and returned without actually draining anything. The chip kept the line asserted, the handler fired again, forever.

The fix was one call the vendor makes before every coordinate read and I had skipped: put the AHB into continuous burst mode first.

```c
/* Without this the 0x30 read returns garbage, the checksum fails on
 * every interrupt, and the level-low line never clears. */
ret = himax_burst_enable(ts, false);
if (ret)
    return ret;
```

One line. The storm stopped, the checksum passed, and `getevent` lit up with `ABS_MT_POSITION_X/Y` and clean `BTN_TOUCH` transitions. Ten-finger multitouch, type-B slots, the whole thing.

## Turn the screen off, touch dies

Victory lasted until I locked the screen and unlocked it. Touch was dead again.

This is the in-cell tax. The HX83112F shares its power rail with the display panel. When the screen blanks, the panel powers down, and the controller loses that volatile SRAM firmware I worked so hard to load. On wake it comes back powered but empty.

The catch is that screen-off is **not** a system suspend. It is a `drm_panel` blank event. My `dev_pm` suspend/resume hooks never ran, so nothing reloaded the firmware. The answer is to listen to the panel directly:

```c
if (event == DRM_PANEL_EARLY_EVENT_BLANK && blank == DRM_PANEL_BLANK_POWERDOWN) {
    /* screen off: quiet the IRQ before the chip loses power */
    disable_irq(ts->spi->irq);
} else if (event == DRM_PANEL_EVENT_BLANK && blank == DRM_PANEL_BLANK_UNBLANK) {
    /* screen on: SRAM is empty again, reload firmware and resume */
    himax_download_firmware(ts);
    enable_irq(ts->spi->irq);
}
```

Disabling the IRQ *before* power-down matters too, otherwise the unpowered line floats and you are back to a storm.

## The surprise: the display would not link without me

There is one downstream-only knot worth mentioning, because it caught me completely off guard.

When I disabled the vendor touch driver to build mine, the **display** driver stopped linking:

```
ld.lld: error: undefined symbol: TP_Panel
>>> referenced by dsi_panel.c
```

It turns out the display driver publishes the active panel pointer into a global called `TP_Panel`, and the *storage* for that global lived inside the vendor touch driver. Delete the touch driver, delete the symbol, break the display. Touch and display on this device are quietly married to each other.

I moved the definition into a part of the vendor stack that is always built, so the display keeps linking whether my driver is present or not. On mainline this coupling does not exist at all, so it just evaporates on the way up.

## Result

After all of that:

- Firmware downloads into SRAM on boot, no boot hang
- Ten-finger multitouch reporting through a standard `input` device
- Survives screen off and on, every time
- No vendor framework anywhere in the driver

```
himax-hx83112f spi0.0: touchscreen ready (fw 131072 bytes)
```

The whole thing is a single self-contained SPI driver. The downstream-only bits (the vendor-node compatible, the panel-coords fallback, the ueventd firmware timing, the `TP_Panel` move) are all clearly marked, so lifting it onto mainline is mostly subtraction.

## What Doesn't Work Yet

Same list as before, minus one line:

- ~~No touchscreen~~
- No DRM display driver (still on simple-framebuffer)
- No audio
- No modem
- No Wi-Fi
- No cameras
- No battery reporting

Part 3 will keep chipping away at it.

`Firmware in SRAM is only as permanent as the power rail under it.`

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
