---
layout: post
title: "Mainlining OnePlus Nord N10 5G - Part 2: The Touchscreen"
date: 2026-07-22 00:00:01 +0530
categories: [Mainline]
tags: [Linux, Mainline, Qualcomm, Touchscreen]
description: "How to actually write a touchscreen driver from nothing, the APIs, the method, and everything that broke"
author: danascape
toc: true
---

## Recap

In Part 1 I got **billie** (the OnePlus Nord N10 5G, `SM6350`) booting a mainline kernel to a framebuffer console with SSH over USB. At the end of that post there was a long list of things that did not work. Right at the top of it: **touchscreen**.

A phone you cannot touch is just an expensive paperweight, so that is where I went next.

I wrote this as the post I wish I had when I started. It is long on purpose. It is both a from-scratch guide to **how a touchscreen driver actually works**, and an honest log of everything I got wrong. If you have never written a driver, start at the top and do not skip. If future-me has forgotten the Linux kernel entirely and is staring at another dead touchscreen, this should be enough to get going again from zero. billie's **Himax HX83112F** is just the specimen on the table.

## Who this is for, and what you need first

You need to be comfortable *reading* C. Not writing clever C, just following pointers, structs, and bit operations without panicking. Everything below is C.

A handful of concepts, in plain terms, because the rest of the post leans on them:

- **Kernel vs userspace.** A driver is code that runs *inside* the kernel, with direct access to hardware. Apps run in userspace and are not allowed near hardware; they ask the kernel.
- **Device and driver.** Hardware is a "device". Code that runs it is a "driver". They are matched at boot.
- **Device tree.** On phones and embedded boards, there is no BIOS enumerating hardware. Instead a text file, the **device tree**, describes what exists and where (this chip is on SPI bus 0, its reset line is GPIO 21, its interrupt is GPIO 22). The kernel reads it at boot.
- **compatible + probe.** A driver advertises one or more `compatible` strings. When a device tree node has a matching `compatible`, the kernel calls the driver's `probe()` function. `probe()` is where a driver's life begins.
- **Bus.** The CPU reaches a peripheral over a bus. Touch chips sit on **I2C** or **SPI**, both simple serial buses: you shift bytes out, you shift bytes in.
- **Interrupt (IRQ).** Rather than the CPU constantly asking "any data yet?", the chip tugs a dedicated wire when it has something. The kernel responds by calling your handler.
- **Input subsystem.** The kernel's standard pipe for input devices. You do not talk to Android or X11; you push events into the input core and they flow upward on their own.

If those words are fog right now, here is where the fog lifts, and these hold up over the years:

- **Linux Device Drivers, 3rd edition** (free online). It targets an ancient 2.6 kernel so the *exact* APIs are wrong, but the *ideas*, modules, probe, interrupts, concurrency, are timeless. Read it for concepts, not copy-paste.
- **Bootlin** training slides (free) and, more importantly, their **Elixir** source browser at `elixir.bootlin.com`. This is the single most useful tool you will use.
- The kernel's own **`Documentation/`** tree, especially `Documentation/input/` and `Documentation/driver-api/`.
- **kernelnewbies.org** for the gentler on-ramps.

You do not need to finish any of these. You need to recognize the words. Then come back.

## How to find your way around the kernel

There are no man pages for most kernel functions. The source *is* the documentation, so the real skill is navigating it fast.

- **Read the definition for the contract.** When you meet an unknown function, jump to where it is defined. The comment above it (if any) plus the body is the spec. There is nothing else.
- **Find examples by finding callers.** This is the trick I lean on most. `git grep input_mt_init_slots drivers/input/touchscreen` lists every driver that uses it. Open the closest one and copy the idiom. You are almost never the first person to call a given function.
- **Elixir** does the same across the whole tree, in a browser, with clickable symbols and a version dropdown so you can check "does this API even exist in 4.19?".
- **`git blame` / `git log`.** When a line makes no sense, blame it and read the commit message that introduced it. This is how you learn *why* a magic value is what it is.
- **`Documentation/`.** For touch specifically, `Documentation/input/multi-touch-protocol.rst` is mandatory reading and I will lean on it below.

Internalize one habit: when you do not know how to do X, `git grep` for a driver that already does X, and read it.

## The mental model: what a touchscreen driver even is

Strip away the chip-specific noise and a touchscreen driver is two things stitched together:

1. A **bus client** that knows how to talk to the controller (here, over SPI).
2. An **input device** that hands finger coordinates to the kernel.

The whole job is one loop:

```
chip pulls IRQ low  ->  you read a coordinate frame over the bus
                    ->  you translate it into input events
                    ->  input core + userspace turn it into taps/swipes
```

On Android that last step is `InputReader` in `system_server`. You never talk to it; you feed the kernel input core and it flows up on its own.

Everything else in the driver, firmware, reset, power, suspend, is plumbing to keep that loop alive. Hold on to this picture. When touch "does not work" it is always one link in this chain that is broken, and knowing the chain tells you exactly where to look.

## Your two reference drivers

The most important move in this whole project was not writing code. It was finding **prior art**. For a touchscreen you almost always have two references, and they do different jobs.

**1. The mainline cousin.** The closest existing upstream driver. For me that was `drivers/input/touchscreen/himax_hx83112b.c` by Job Noorman, a sibling Himax chip already in mainline. This gives you the correct *shape*: how a modern touch driver is laid out, which input APIs to call, how errors are handled idiomatically. I copied structure from here, the probe flow, the SPI helpers, the event struct, and adapted it.

**2. The downstream vendor driver.** The OnePlus/Himax code in `drivers/oneplus/input/touchscreen_himax/`. Thousands of lines, unshippable, but it is the *ground truth* for everything chip-specific: register addresses, the init sequence, the firmware format, every magic number. You never ship a line of it, but you mine facts from it constantly.

The method in one sentence: **cousin for form, vendor for facts.** Whenever I needed a magic value, I searched the vendor driver for the operation and copied the number; whenever I needed to know *how a driver should be shaped*, I looked at the cousin.

Concrete examples of "where each line came from":

- `spi->mode = SPI_MODE_3` — from the vendor's probe, which sets the SPI mode explicitly.
- The IC-ID register `0x900000d0` and the expected `0x83112f` — from the vendor's `himax_ic_package_check()`.
- The reset pulse (high, low, high) — from the gpio toggles in that same function.
- The firmware SRAM layout and CRC — from the vendor's `hx_parse_bin_cfg_data()` and `himax_mcu_firmware_update_0f()`.
- The 56-byte coordinate frame layout — from the vendor's `himax_get_touch_points()`.

None of it was invention. It was translation.

## If there is no driver at all

Sometimes you are not so lucky, no cousin, no vendor source, just a chip. The escalation ladder:

- **Identify the chip.** Board markings, the downstream device tree (`compatible`, a `chip-name` property), a schematic if you can find one, or probing the bus. On billie the downstream DTS literally names it: `chip-name = "hx83112f"`.
- **Hunt the datasheet.** For phone touch chips it is almost always under NDA and you will not get it. So the vendor Android driver, wherever it lives (a LineageOS device tree, a random GitHub dump), *becomes* your datasheet. That is exactly how I got every Himax register; I never saw an official datasheet.
- **If you truly have nothing**, put a logic analyzer on the SPI or I2C lines while the stock ROM runs. You will see the exact byte sequences the working driver sends: the init, then the repeated coordinate reads. You reproduce them.
- **Deduce the report format empirically.** Dump the raw bytes the chip sends on each interrupt, touch known points on the screen, and watch which bytes move. That is reverse engineering in its purest form, and, spoiler, I ended up doing a miniature version of it *even with* a reference driver, when the interrupt storm hit. Dumping the raw 56-byte frame (further down) is that same technique.

The point: a driver is just a faithful reproduction of a conversation the hardware already knows how to have. Your job is to learn the conversation, from source, from a bus trace, or from raw bytes.

## The method: build one link at a time

Do not write the whole driver and then switch it on. Build the chain link by link and *prove each link before adding the next*. My git history for this driver is literally this ladder, one commit per rung:

1. **probe binds, SPI works, IC-ID reads back `0x83112f`** → the bus, mode, and framing are correct.
2. **firmware loads from the filesystem** → the path and timing are correct.
3. **firmware downloads into SRAM and the CRC passes** → the chip is programmed.
4. **the IRQ fires and a frame decodes into input events** → touch works.

At every rung, `dev_info()` / `dev_dbg()` is your microscope: print what you read, eyeball it against what you expected. The payoff is huge, when something breaks, you already know which rung you are on, because every rung below it printed success. Almost every "finding" in this post is a rung that lied about succeeding.

With the theory out of the way, here is the driver, in the order I built it.

## The skeleton: an SPI client

A driver for an SPI peripheral is a `spi_driver`. You give it a probe function, a table of `compatible` strings so the device tree can match it, and a one-liner macro to register it.

```c
static const struct of_device_id himax_of_match[] = {
    { .compatible = "himax,hx83112f" },
    { }
};
MODULE_DEVICE_TABLE(of, himax_of_match);

static struct spi_driver himax_spi_driver = {
    .probe = himax_probe,
    .remove = himax_remove,
    .driver = {
        .name = "himax-hx83112f",
        .of_match_table = himax_of_match,
    },
};
module_spi_driver(himax_spi_driver);
```

I did not write this from memory. I opened the cousin driver, saw this exact pattern, and changed the names. When the device tree has a node under an SPI controller whose `compatible` matches, the kernel calls your `probe()` with a `struct spi_device *`. That is your entry point:

```c
static int himax_probe(struct spi_device *spi)
{
    struct device *dev = &spi->dev;
    struct himax_ts_data *ts;
    int ret;

    spi->mode = SPI_MODE_3;      /* clock polarity/phase the chip wants */
    spi->bits_per_word = 8;
    ret = spi_setup(spi);        /* push that config to the controller  */
    if (ret)
        return dev_err_probe(dev, ret, "SPI setup failed\n");

    ts = devm_kzalloc(dev, sizeof(*ts), GFP_KERNEL);
    if (!ts)
        return -ENOMEM;

    ts->spi = spi;
    ts->dev = dev;
    spi_set_drvdata(spi, ts);
    /* ... input device, gpio, irq, firmware ... */
}
```

Three idioms worth knowing, because they are everywhere in modern drivers:

- **devm.** `devm_kzalloc()` and its cousins are "device-managed": whatever you allocate is freed automatically when the device goes away. You stop writing manual cleanup. Use them for nearly everything.
- **`dev_err_probe()`** logs the error and returns it in one line, and stays silent for `-EPROBE_DEFER`. It turns probe error paths into one-liners.
- **`spi_set_drvdata()`** stashes your state pointer on the device so other callbacks (IRQ, remove, suspend) can fetch it back.

## The input device (the half everyone underestimates)

This half is generic across *every* touchscreen. Learn it once and you can report input from anything.

You allocate an input device, declare **what kinds of events it can emit**, register it, and from then on just report events into it.

```c
ts->input = devm_input_allocate_device(dev);
ts->input->name = "Himax HX83112F Touchscreen";
ts->input->id.bustype = BUS_SPI;
```

### Multitouch, protocol B

There are two multitouch protocols, and `Documentation/input/multi-touch-protocol.rst` explains both. The short version: **protocol A** re-streams every contact each frame and the kernel guesses which is which; **protocol B** gives each finger a **slot** and a **tracking ID**, so you tell the core "slot 2 is the same finger as last frame" and only report what changed. You want B. It is what real touchscreens use, and the core handles most of the bookkeeping.

You switch it on with `input_mt_init_slots()`:

```c
input_set_abs_params(ts->input, ABS_MT_POSITION_X, 0, max_x, 0, 0);
input_set_abs_params(ts->input, ABS_MT_POSITION_Y, 0, max_y, 0, 0);
input_set_abs_params(ts->input, ABS_MT_TOUCH_MAJOR, 0, 255, 0, 0);

input_mt_init_slots(ts->input, HIMAX_MAX_POINTS,
                    INPUT_MT_DIRECT | INPUT_MT_DROP_UNUSED);

input_register_device(ts->input);
```

`input_set_abs_params(dev, axis, min, max, fuzz, flat)` declares an absolute axis and its range. `INPUT_MT_DIRECT` means "this is a touchscreen, coordinates map straight onto a display" (as opposed to a laptop trackpad). `INPUT_MT_DROP_UNUSED` lets the core auto-release slots you stop reporting. I found the exact flags to pass by grepping other touchscreen drivers for `input_mt_init_slots`, three lines of reading, no guessing.

### Reporting a frame

Once you have decoded a frame, report each live contact into its slot, then sync:

```c
input_mt_slot(ts->input, i);
input_mt_report_slot_state(ts->input, MT_TOOL_FINGER, true);
touchscreen_report_pos(ts->input, &ts->props, x, y, true);
input_report_abs(ts->input, ABS_MT_TOUCH_MAJOR, w);
/* ... repeat per finger ... */

input_mt_sync_frame(ts->input);
input_sync(ts->input);
```

- `input_mt_report_slot_state(dev, MT_TOOL_FINGER, true)` marks the slot active and makes the core hand out a tracking ID. `false` lifts the finger.
- `input_mt_sync_frame()` is the magic broom: it releases any slot you did not touch this frame and synthesizes `BTN_TOUCH` plus single-touch emulation for you.
- `input_sync()` commits the frame. Nothing reaches userspace until you call it. Forgetting this is a classic "my events vanish" bug.

### touchscreen_parse_properties() and the 1x1 trap

`touchscreen_parse_properties(input, multitouch, &props)` reads standard device tree properties, `touchscreen-size-x/y`, `touchscreen-inverted-x/y`, `touchscreen-swapped-x-y`, into a `struct touchscreen_properties`. Then `touchscreen_report_pos()` applies inversion and axis-swap for you. This is why orientation fixes become a one-line DT change instead of code. Learn these two helpers.

**Finding #1.** My first working build reported touches, and nothing happened on screen. `logcat`:

```
InputReader: Device reconfigured: ... size 1x1, ... mode DISABLED
```

Android saw a `1x1` touchscreen and refused to bind it to the display. Cause: I had enabled the `ABS_MT_POSITION_X/Y` events but left their **range at 0**, and there was no `touchscreen-size-x/y` in the vendor node for `touchscreen_parse_properties()` to fill in. Fix: seed the range from what the node *does* carry, OnePlus's `touchpanel,panel-coords`, before parsing standard properties:

```c
if (!device_property_read_u32_array(dev, "touchpanel,panel-coords", coords, 2)) {
    max_x = coords[0];
    max_y = coords[1];
}
```

Range became `1080x2400`, Android switched to `mode DIRECT, display id 0`. Lesson: an input device with no axis range is not "empty", it is actively broken, and userspace disables it without a word.

## Talking to the chip: every controller is a snowflake

The input side is standard. The bus side never is. Every controller has its own register protocol, and your sources of truth are the datasheet (if you have one) and the vendor driver (if you do not).

For the Himax, every register access is wrapped in a two-byte SPI header, `0xF2` to write, `0xF3` to read. I got those two bytes from the vendor's `himax_bus_read()` / `himax_bus_write()`:

```c
#define HIMAX_SPI_WRITE   0xf2
#define HIMAX_SPI_READ    0xf3
```

Reads are a two-transfer sequence, send the command, then clock in the reply, both inside one `spi_sync_transfer()` so chip-select stays low across the pair:

```c
struct spi_transfer xfers[2] = { };
xfers[0].tx_buf = ts->tx_buf;   /* [0xf3][reg][0x00]        */
xfers[0].len = 3;
xfers[1].rx_buf = ts->rx_buf;   /* reply lands here          */
xfers[1].len = len;
spi_sync_transfer(ts->spi, xfers, ARRAY_SIZE(xfers));
```

On top of that framing the chip exposes an AHB register bus: write a 32-bit address, then read or write through fixed sub-addresses. The first genuinely useful thing to do with all of it is ask the chip its identity:

```c
#define HIMAX_REG_ICID       0x900000d0
#define HIMAX_ICID_HX83112F  0x83112f
```

Read `0x900000d0`, drop the low byte, expect `0x83112f`. The moment that matched, I knew the bus, the mode, and the framing were all correct, rung 1 of the ladder, proven. Everything after is "the chip is listening, now convince it to work".

> SPI transfer buffers should be their own kmalloc'd region, not stack variables, because the controller may DMA them. I keep one `tx_buf`/`rx_buf` pair in my state struct, behind a mutex.
{: .prompt-tip }

## The no-flash problem, and loading firmware

Most touch controllers keep firmware in on-chip flash. Flash once, forget.

The HX83112F has **no flash**. Its firmware is a blob in the rootfs that must be **downloaded into the chip's SRAM after every reset** before it does anything at all. No firmware, no interrupts, no touch. This single fact drives most of the hard parts below.

Loading a blob is `request_firmware()`:

```c
const struct firmware *fw;
ret = request_firmware(&fw, "Himax_firmware.bin", dev);
/* fw->data, fw->size ... */
release_firmware(fw);
```

It should be boring. It was not.

**Finding #2.** My first version called it in `probe()`. The device hung on the boot logo for a minute, then:

```
himax-hx83112f spi0.0: failed to load firmware "Himax_firmware.bin"
himax-hx83112f: probe of spi0.0 failed with error -110
```

`-110` is `-ETIMEDOUT`. A timing problem: at probe time, early in boot, `/vendor` is not mounted, so the file is on no path the kernel searches. The request falls through to the usermode-helper and blocks for a 60-second timeout. That block *is* the boot hang.

Two things fell out of understanding it, and I figured them out by reading how the vendor driver loads firmware (it defers to a much later userspace trigger) and by reading `request_firmware`'s own source:

- On Android the firmware is served by **ueventd through the usermode-helper fallback**, which searches `/vendor/firmware` and friends. The kernel's direct-load path does not cover those, so `request_firmware_direct()` (which skips the fallback) will *never* find the file. You must use plain `request_firmware()`.
- Nothing should load firmware in probe. Defer it.

So I moved the load into a **retrying delayed work**: probe schedules it and returns immediately, boot is never blocked, and it retries until ueventd can serve the file.

```c
static void himax_fw_work(struct work_struct *work)
{
    ...
    ret = request_firmware(&fw, fw_name, ts->dev);
    if (ret) {
        if (ts->fw_retries-- > 0) {
            schedule_delayed_work(&ts->fw_work,
                                  msecs_to_jiffies(HIMAX_FW_RETRY_MS));
            return;
        }
        dev_err(ts->dev, "giving up on firmware: %d\n", ret);
        return;
    }
    /* copy it, then bring the controller up */
}
```

**Finding #3, a dead end worth knowing.** Before I understood the ueventd angle, I tried dodging the filesystem entirely with `CONFIG_EXTRA_FIRMWARE`, which bakes a blob straight into the kernel image (built-in firmware is checked before any filesystem, so the timing problem vanishes). I dropped it: it bloats `vmlinux`, needs a kernel rebuild to change firmware, and is the wrong model for upstream where the blob belongs in `/lib/firmware`. But it is a legitimate escape hatch if a firmware-timing wall is blocking your bring-up and you just want to move on.

## Getting the firmware into the chip: zero-flash download

Having the blob in RAM is not enough; it has to land in the chip's SRAM in the exact shape it expects. I learned that shape entirely from the vendor's `hx_parse_bin_cfg_data()`. The image is a 1K header, a 64K firmware body, then a partition table describing config blocks:

- The 64K body goes to SRAM at `0x20000000`.
- The partition table is parsed, its config partitions merged into one contiguous SRAM window, and that is written too.
- Both are checked with the chip's **hardware CRC engine**, which I cross-check against a CRC-32C computed in software.
- Flash-reload is disabled so the chip runs from SRAM, and the front-end is "sensed on".

Nothing clever, but unforgiving: one wrong address and the CRC quietly fails while everything still says "done". If you port a chip like this, get the memory map byte-exact and *verify the CRC* before trusting anything downstream of it. This was rung 3, and the CRC passing is what proved it.

## Reset and power: GPIOs the modern way

Touch controllers have a reset line. The modern API is **gpiod** (GPIO descriptors), which pulls the pin *and its polarity* from the device tree so your code never hardcodes a number:

```c
ts->reset_gpio = devm_gpiod_get(dev, "reset", GPIOD_OUT_LOW);
...
gpiod_set_value_cansleep(ts->reset_gpio, 1);  /* assert reset  */
gpiod_set_value_cansleep(ts->reset_gpio, 0);  /* release reset */
```

The key idea: gpiod values are **logical**. If the device tree marks the line `GPIO_ACTIVE_LOW`, then `gpiod_set_value(1)` drives the pin physically *low*. Your code says "assert reset"; the DT owns the electrical detail.

**Finding #4.** First boot with the driver died here:

```
himax-hx83112f spi0.0: failed to get reset gpio ... error -2
```

`-2` is `-ENOENT`. `devm_gpiod_get(dev, "reset", ...)` looks for a DT property named `reset-gpios`. The vendor node did not have one, it used OnePlus's own `touchpanel,reset-gpio`, which gpiod does not understand. (I found that out by grepping the gpiod core for how it builds the property name.) So I added the standard property:

```dts
reset-gpios = <&tlmm 21 GPIO_ACTIVE_LOW>;
```

`GPIO_ACTIVE_LOW` is not cosmetic: this chip is held in reset by driving the line *low*, so with the flag set, my logical "assert" (value 1) does the right physical thing and the pulse comes out high -> low -> high, matching the vendor's reset sequence. Wrong polarity and you either never reset the chip or hold it in reset forever.

## The interrupt: a threaded IRQ, and a storm

The chip signals "I have data" by pulling its interrupt line. You handle it with a **threaded IRQ**, because reading the data means SPI transfers that can sleep, and you cannot sleep in a hard-IRQ context:

```c
devm_request_threaded_irq(dev, spi->irq, NULL, himax_irq,
                          IRQF_ONESHOT, "himax-hx83112f", ts);
```

- `spi->irq` is filled in from the `interrupts` property on the DT node, you do not request a GPIO IRQ by hand.
- The 4th argument is your **threaded** handler, run in a kernel thread where sleeping is fine. The hard handler (3rd arg) is `NULL`.
- `IRQF_ONESHOT` keeps the line masked until your thread finishes, exactly what you want for a level-triggered line you are about to drain over a slow bus.

Inside, you read the coordinate FIFO, checksum it, decode each contact, report the frame:

```c
static irqreturn_t himax_irq(int irq, void *dev_id)
{
    struct himax_ts_data *ts = dev_id;
    struct himax_event event;

    if (himax_read_event(ts, &event))
        return IRQ_NONE;
    if (!himax_verify_checksum(ts, &event))
        return IRQ_HANDLED;

    /* decode points into MT slots, then: */
    input_mt_sync_frame(ts->input);
    input_sync(ts->input);
    return IRQ_HANDLED;
}
```

The frame is a fixed byte layout the firmware produces. Describe it with a packed struct and let the compiler do the offset math, no manual `buf[i*4+2]` arithmetic:

```c
struct himax_event {
    struct { __be16 x, y; } points[HIMAX_MAX_POINTS];
    u8 majors[HIMAX_MAX_POINTS];
    u8 pad0[2];
    u8 num_points;
    u8 pad1[2];
    u8 checksum_fix;
} __packed;
static_assert(sizeof(struct himax_event) == 56);
```

I got that layout by reading how the vendor's `himax_get_touch_points()` indexes its buffer, then confirmed it empirically (below).

**Finding #5, the good one.** Firmware loaded, CRC clean, `touchscreen ready` in the log, and touch did not work. `getevent` showed nothing. So I checked the interrupt count:

```
$ grep himax /proc/interrupts
316:  201984  ...  msmgpio  22 Level  himax-hx83112f
316:  206731  ...  msmgpio  22 Level  himax-hx83112f
316:  210399  ...  msmgpio  22 Level  himax-hx83112f
```

Climbing by thousands per second, nobody touching the screen. An **interrupt storm**.

The line is level-triggered and active-low. The chip pulls it low when a frame is ready and releases it once you *read the frame out of the FIFO*. My handler was reading, but in the wrong bus mode, so it got garbage, failed the checksum, and returned without actually draining the FIFO. Line stays low, handler fires again, forever, and every frame is junk so `getevent` stays silent. Two symptoms, one cause.

To *see* what the chip was sending, I added a temporary dump of the raw 56 bytes on each interrupt, and this is the reverse-engineering-from-scratch technique showing up even with a reference in hand: touch a known spot, watch which bytes carry the coordinate. The bytes confirmed my struct layout was right; the problem was the read mode. The fix was one call the vendor makes before every coordinate read and I had skipped, putting the AHB into continuous burst mode first:

```c
/* Without this the FIFO read returns garbage, the checksum fails every
 * time, and the level-low line never clears -> interrupt storm. */
himax_burst_enable(ts, false);
```

One line. The storm stopped and `getevent` lit up with `ABS_MT_POSITION_X/Y`, tracking IDs, and clean `BTN_TOUCH`, ten fingers, independent slots. If you ever see a rising interrupt count with no input events, this is the shape of the bug: you are being interrupted but not acknowledging it, and for most chips "acknowledge" means "read the data".

## Suspend, resume, and the in-cell tax

Touch worked. Then I locked the screen, unlocked it, and touch was dead again.

This is the **in-cell** tax. The HX83112F shares its power rail with the display panel. When the screen blanks, the panel powers down, and the controller loses that volatile SRAM firmware. On wake it comes back powered but empty.

My first instinct was the driver's PM hooks, `.suspend`/`.resume`. They never fired. **Finding #6:** on this platform, screen-off is *not* a system suspend. The SoC stays awake; only the display blanks, and that arrives as a `drm_panel` notifier event, not a PM transition. So the fix is to listen to the panel directly:

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

You register for this with `drm_panel_notifier_register()`, after finding the panel from the `panel` phandle on your node with `of_drm_find_panel()` (return `-EPROBE_DEFER` until the panel driver appears). Disabling the IRQ *before* power-down matters too: an unpowered input can float and drop you right back into a storm. If your device is in-cell, budget for this from the start, it fires every single time the screen turns off.

## The kernel-version tax: writing for 4.19

I built this on the mainline `himax_hx83112b` cousin, but billie's downstream kernel is **4.19**, and the cousin uses APIs that do not exist that far back. This is normal backporting friction, and worth naming because you will hit it. I only caught each one by trying to compile and reading the error, then grepping my tree's headers to confirm the helper was missing and find the older equivalent:

| Modern API | What I used on 4.19 |
| --- | --- |
| `guard(mutex)` / `scoped_guard()` (cleanup.h) | plain `mutex_lock()` / `mutex_unlock()` |
| `devm_mutex_init()` | `mutex_init()` |
| `DEFINE_SIMPLE_DEV_PM_OPS` / `pm_sleep_ptr()` | `SIMPLE_DEV_PM_OPS` + `__maybe_unused` |

The lesson is dull but real: the kernel's helper APIs drift constantly, and a driver written against 6.x will not build on 4.19. When you copy from a newer driver, check every helper against *your* tree (Elixir with the version dropdown, or just grep your headers) before trusting it.

## The display was married to the touch driver

One downstream-only knot caught me completely off guard, and it is a good warning about vendor trees.

When I disabled the vendor touch driver to build mine, the **display** stopped linking:

```
ld.lld: error: undefined symbol: TP_Panel
>>> referenced by dsi_panel.c
```

The display driver publishes the active panel pointer into a global called `TP_Panel`, and the *storage* for that global lived inside the vendor touch driver. Remove the touch driver, remove the symbol, break the display. On this device, touch and display are quietly welded together. I found the culprit by grepping the whole tree for `TP_Panel` and reading who defined versus referenced it.

I moved the definition into a part of the vendor stack that is always built, so the display links whether my driver is present or not. On mainline this coupling does not exist, so it evaporates on the way up. But it is a reminder: in a vendor tree, "unrelated" subsystems often are not.

## Wiring it into the build

Three files make the driver real:

- **Kconfig**, with one important twist. Both my driver and the vendor one bind the same `himax,hxcommon` node, so they must be mutually exclusive:

  ```
  config TOUCHSCREEN_HIMAX_HX83112F
      tristate "Himax HX83112F no-flash touchscreen (minimal)"
      depends on SPI_MASTER
      depends on DRM
      depends on !TOUCHPANEL_HIMAX_HX83112F_NOFLASH
  ```

- **Makefile**: `obj-$(CONFIG_TOUCHSCREEN_HIMAX_HX83112F) += himax_hx83112f.o`
- **Device tree**: the `reset-gpios` property from Finding #4, on the existing touch node.

Then the defconfig switch: vendor driver off, mine on.

## Does it work?

Two commands tell you everything. `getevent` shows the raw stream, one finger down and up:

```
EV_ABS  ABS_MT_TRACKING_ID  0000005c
EV_ABS  ABS_MT_POSITION_X   00000227
EV_ABS  ABS_MT_POSITION_Y   000006e1
EV_KEY  BTN_TOUCH           DOWN
EV_SYN  SYN_REPORT          00000000
EV_ABS  ABS_MT_TRACKING_ID  ffffffff
EV_KEY  BTN_TOUCH           UP
```

Five fingers give five `ABS_MT_SLOT` blocks with distinct tracking IDs. And `/proc/interrupts` now sits still when idle and only ticks up when you actually touch, the exact opposite of the storm.

```
himax-hx83112f spi0.0: touchscreen ready (fw 131072 bytes)
```

## Taking it to mainline

The whole thing is a single self-contained SPI driver, which was the point. The downstream-only pieces are deliberately isolated so the port up is mostly subtraction:

- the `himax,hxcommon` compatible becomes a proper `himax,hx83112f`
- the `touchpanel,panel-coords` fallback becomes standard `touchscreen-size-x/y`
- the ueventd firmware timing goes away; the blob just lives in `/lib/firmware`
- the `TP_Panel` move and the Kconfig swap are downstream-only and do not travel

## What Doesn't Work Yet

Same list as Part 1, minus one line:

- ~~No touchscreen~~
- No DRM display driver (still on simple-framebuffer)
- No audio
- No modem
- No Wi-Fi
- No cameras
- No battery reporting

Part 3 will keep chipping away at it.

`A driver is a faithful reproduction of a conversation the hardware already knows how to have. Learn the conversation, prove it one line at a time.`

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
