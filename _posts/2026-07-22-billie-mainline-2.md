---
layout: post
title: "Mainlining OnePlus Nord N10 5G - Part 2: The Touchscreen"
date: 2026-07-22 00:00:01 +0530
categories: [Mainline]
tags: [Linux, Mainline, Qualcomm, Touchscreen]
description: "How to actually write a touchscreen driver, and everything that broke on the way"
author: danascape
toc: true
---

## Recap

In Part 1 I got **billie** (the OnePlus Nord N10 5G, `SM6350`) booting a mainline kernel to a framebuffer console with SSH over USB. At the end of that post there was a long list of things that did not work. Right at the top of it: **touchscreen**.

A phone you cannot touch is just an expensive paperweight, so that is where I went next.

This ended up being long, so I wrote it as the post I wish I had when I started: a from-scratch walk through **how a touchscreen driver actually works**, the kernel APIs involved, and every wall I hit. If you have never written one, you should be able to read this and write your own. billie's **Himax HX83112F** is just the specimen on the table.

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

On Android that last step is `InputReader` in `system_server`. You do not talk to it; you just feed the kernel input core and it flows up on its own.

Everything else in the driver, firmware, reset, power, suspend, is plumbing to keep that loop alive. Hold on to this picture, because when touch "does not work" it is always one link in this chain that is broken, and knowing the chain tells you where to look.

## The skeleton: an SPI client

A driver for an SPI peripheral is a `spi_driver`. You give it a probe function, a table of compatible strings so the device tree can match it, and a one-liner macro to register it.

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

When the device tree has a node under an SPI controller whose `compatible` matches, the kernel calls your `probe()` with a `struct spi_device *`. That is your entry point. Configure the bus, allocate your state, and set up the rest:

```c
static int himax_probe(struct spi_device *spi)
{
    struct device *dev = &spi->dev;
    struct himax_ts_data *ts;
    int ret;

    spi->mode = SPI_MODE_3;      /* the chip's clock polarity/phase   */
    spi->bits_per_word = 8;
    ret = spi_setup(spi);        /* push that config to the controller */
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

A few things worth knowing early:

- `devm_kzalloc()` and friends are the **devm** (device-managed) APIs. Memory and resources you allocate with them are freed automatically when the device goes away, so you stop writing error-path cleanup by hand. Use them for almost everything.
- `dev_err_probe()` logs the error and returns it in one call, and it stays quiet for `-EPROBE_DEFER`. It exists to make probe error paths one-liners.
- `SPI_MODE_3` is not a guess. It is clock polarity and phase the chip expects; get it wrong and every read is garbage. I got this from the vendor driver, which is the honest answer for where most of these magic values come from.

## The input device (the half everyone underestimates)

This is the part that is generic across every touchscreen, so learn it once.

You allocate an input device, declare **what kinds of events it can emit**, register it, and from then on you just report events into it.

```c
ts->input = devm_input_allocate_device(dev);
ts->input->name = "Himax HX83112F Touchscreen";
ts->input->id.bustype = BUS_SPI;
```

### Multitouch, protocol B

Modern touchscreens use **multitouch protocol B**. The idea: instead of re-sending every contact each frame, you give each finger a **slot** and a **tracking ID**. You tell the core "slot 2 is still the same finger as last frame", and it only emits what changed. This is what you want, and the input core does most of the bookkeeping.

You turn it on with `input_mt_init_slots()`:

```c
input_set_abs_params(ts->input, ABS_MT_POSITION_X, 0, max_x, 0, 0);
input_set_abs_params(ts->input, ABS_MT_POSITION_Y, 0, max_y, 0, 0);
input_set_abs_params(ts->input, ABS_MT_TOUCH_MAJOR, 0, 255, 0, 0);

input_mt_init_slots(ts->input, HIMAX_MAX_POINTS,
                    INPUT_MT_DIRECT | INPUT_MT_DROP_UNUSED);

input_register_device(ts->input);
```

`input_set_abs_params(dev, axis, min, max, fuzz, flat)` declares an absolute axis and its range. `INPUT_MT_DIRECT` says this is a touchscreen (coordinates map directly onto a display, unlike a trackpad), and `INPUT_MT_DROP_UNUSED` lets the core auto-release slots you stop reporting.

### Reporting a frame

When you have decoded a frame, you report each live contact into its slot and then sync:

```c
input_mt_slot(ts->input, i);
input_mt_report_slot_state(ts->input, MT_TOOL_FINGER, true);
touchscreen_report_pos(ts->input, &ts->props, x, y, true);
input_report_abs(ts->input, ABS_MT_TOUCH_MAJOR, w);
/* ... repeat for each finger ... */

input_mt_sync_frame(ts->input);
input_sync(ts->input);
```

- `input_mt_report_slot_state(dev, MT_TOOL_FINGER, true)` marks the slot active and makes the core hand out a tracking ID. Pass `false` and the finger is lifted.
- `input_mt_sync_frame()` is the magic broom: it releases any slot you did not touch this frame, and synthesizes `BTN_TOUCH` and single-touch emulation for you.
- `input_sync()` commits the frame. Nothing is visible to userspace until you call it.

### touchscreen_parse_properties() and the 1x1 trap

`touchscreen_parse_properties(input, multitouch, &props)` reads standard device tree properties, `touchscreen-size-x/y`, `touchscreen-inverted-x/y`, `touchscreen-swapped-x-y`, and stores them in a `struct touchscreen_properties`. Then `touchscreen_report_pos()` applies any inversion or axis swap for you, so orientation fixes become a DT property instead of a code change. Learn these two; they save you from hardcoding panel geometry.

**Finding #1.** My first working build reported touches, but nothing happened on screen. `logcat` had the answer:

```
InputReader: Device reconfigured: ... size 1x1, ... mode DISABLED
```

Android saw a `1x1` touchscreen and refused to associate it with the display. The cause: I had enabled the `ABS_MT_POSITION_X/Y` events but left their **range at 0**, and there was no `touchscreen-size-x/y` in the vendor node for `touchscreen_parse_properties()` to fill in. The fix was to set the range from whatever the node does have, the OnePlus `touchpanel,panel-coords`, before parsing standard properties:

```c
if (!device_property_read_u32_array(dev, "touchpanel,panel-coords", coords, 2)) {
    max_x = coords[0];
    max_y = coords[1];
}
```

`1080x2400`, and Android switched the device to `mode DIRECT, display id 0`. Lesson: an input device with no axis range is not "empty", it is actively broken, and userspace will quietly disable it.

## Talking to the chip: every controller is a snowflake

The input side is standard. The bus side is not. Every controller has its own register protocol, and your two sources of truth are the datasheet (if you are lucky enough to have one) and the vendor driver (if you are not).

For the Himax, every register access is wrapped in a two-byte SPI header, `0xF2` to write, `0xF3` to read:

```c
#define HIMAX_SPI_WRITE   0xf2
#define HIMAX_SPI_READ    0xf3
```

Reads are a classic two-transfer sequence, send the command bytes, then clock in the reply, all inside one `spi_sync_transfer()` so chip-select stays asserted across both:

```c
struct spi_transfer xfers[2] = { };
xfers[0].tx_buf = ts->tx_buf;   /* [0xf3][reg][0x00] */
xfers[0].len = 3;
xfers[1].rx_buf = ts->rx_buf;   /* the data comes back here */
xfers[1].len = len;
spi_sync_transfer(ts->spi, xfers, ARRAY_SIZE(xfers));
```

On top of that framing the chip exposes an AHB register bus: you write a 32-bit address, then read or write data through fixed sub-addresses. The first genuinely useful thing you can do with all this is ask the chip who it is:

```c
#define HIMAX_REG_ICID       0x900000d0
#define HIMAX_ICID_HX83112F  0x83112f
```

Read `0x900000d0`, shift off the low byte, expect `0x83112f`. The first time that matched, I knew the bus, the mode, and the framing were all correct. On a bring-up that is a real milestone, everything after this is "the chip is listening, now convince it to work".

> A tip on DMA: SPI transfer buffers should be their own kmalloc'd region, not stack variables, because the controller may DMA them. I keep one `tx_buf`/`rx_buf` pair in my state struct, guarded by a mutex.
{: .prompt-tip }

## The no-flash problem, and loading firmware

Most touch controllers keep firmware in on-chip flash. Flash once, forget.

The HX83112F has **no flash**. Its firmware is a blob in the rootfs that must be **downloaded into the chip's SRAM after every reset** before it does anything. No firmware, no interrupts, no touch. This one fact is behind most of the hard parts below.

Loading a blob is `request_firmware()`:

```c
const struct firmware *fw;
ret = request_firmware(&fw, "Himax_firmware.bin", dev);
/* fw->data, fw->size ... */
release_firmware(fw);
```

It should be boring. It was not.

**Finding #2.** My first version called `request_firmware()` in `probe()`. The device hung on the boot logo for a full minute, then:

```
himax-hx83112f spi0.0: failed to load firmware "Himax_firmware.bin"
himax-hx83112f: probe of spi0.0 failed with error -110
```

`-110` is `-ETIMEDOUT`, and it is a timing problem. At probe time, early in boot, `/vendor` is not mounted, so the file does not exist on any path the kernel searches. The request then falls through to the usermode-helper and blocks for the 60-second timeout. That block **is** the boot hang.

Two things came out of understanding this:

- On Android the firmware is served by **ueventd through the usermode-helper fallback**, which looks in `/vendor/firmware` and similar. The kernel's own direct-load search path does not cover those. So `request_firmware_direct()`, which skips the fallback, will *never* find the file. You must use plain `request_firmware()`.
- Nothing should load firmware in probe. Defer it.

So I moved the load into a **retrying delayed work**. Probe schedules it and returns immediately, boot is never blocked, and the work keeps retrying until ueventd can serve the file:

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

**Finding #3 (a dead end worth knowing).** Before I understood the ueventd angle, I tried sidestepping the filesystem entirely with `CONFIG_EXTRA_FIRMWARE`, which bakes a blob straight into the kernel image. It works, built-in firmware is checked before any filesystem, and it removes the timing problem completely. I dropped it anyway: it bloats `vmlinux`, means a kernel rebuild to change firmware, and is the wrong model for something headed upstream where the blob belongs in `/lib/firmware`. But it is a legitimate trick if you are desperate to get past a firmware-timing wall during bring-up.

## Getting the firmware into the chip: zero-flash download

Having the blob in RAM is not enough; it has to be pushed into the controller's SRAM in the exact shape it expects. The image is a 1K header, a 64K firmware body, then a partition table describing config blocks:

- The 64K body goes to SRAM at `0x20000000`.
- The partition table is parsed, its config partitions merged into one contiguous SRAM window, and that is written too.
- Both are checked with the chip's **hardware CRC engine**, which I cross-check against a CRC-32C computed in software.
- Flash-reload is disabled so the chip runs from SRAM, and the analog front-end is "sensed on".

There is nothing clever here, but it is unforgiving: one wrong address and the CRC quietly fails while everything still says "done". If you are porting this kind of chip, get the memory map exactly right and verify the CRC before you trust anything downstream of it.

## Reset and power: GPIOs the modern way

Touch controllers have a reset line. The modern API is **gpiod** (GPIO descriptors), which reads the GPIO and its polarity from the device tree so your code never hardcodes a pin number:

```c
ts->reset_gpio = devm_gpiod_get(dev, "reset", GPIOD_OUT_LOW);
...
gpiod_set_value_cansleep(ts->reset_gpio, 1);  /* assert reset  */
gpiod_set_value_cansleep(ts->reset_gpio, 0);  /* release reset */
```

The key thing about `gpiod`: values are **logical**. If the device tree marks the line `GPIO_ACTIVE_LOW`, then `gpiod_set_value(1)` drives the pin physically *low*. Your code says "assert reset"; the DT decides the electrical detail.

**Finding #4.** My first boot with the driver failed here:

```
himax-hx83112f spi0.0: failed to get reset gpio ... error -2
```

`-2` is `-ENOENT`, "no such entry". `devm_gpiod_get(dev, "reset", ...)` looks for a device tree property named `reset-gpios`. The vendor node did not have one, it used OnePlus's own `touchpanel,reset-gpio`, which gpiod does not understand. So I added the standard property to the node:

```dts
reset-gpios = <&tlmm 21 GPIO_ACTIVE_LOW>;
```

`GPIO_ACTIVE_LOW` matters: this chip is held in reset by driving the line *low*, so with the flag set my logical "assert" (value 1) does the right physical thing, and the reset pulse comes out high -> low -> high. Get the polarity wrong and you either never reset the chip or hold it in reset forever.

## The interrupt: a threaded IRQ, and a storm

The chip signals "I have data" by pulling an interrupt line. You handle it with a **threaded IRQ**, because reading the data means SPI transfers that can sleep, which you cannot do in a hard IRQ context:

```c
devm_request_threaded_irq(dev, spi->irq, NULL, himax_irq,
                          IRQF_ONESHOT, "himax-hx83112f", ts);
```

- `spi->irq` is filled in from the `interrupts` property on the device tree node, so you do not request a GPIO IRQ by hand.
- The 4th argument is your **threaded** handler, run in a kernel thread where sleeping is fine. The hard handler (3rd arg) is `NULL`.
- `IRQF_ONESHOT` keeps the line masked until your thread finishes, which is exactly what you want for a level-triggered line you are about to drain over a slow bus.

Inside the handler you read the chip's coordinate FIFO, checksum it, decode each contact, and report the frame:

```c
static irqreturn_t himax_irq(int irq, void *dev_id)
{
    struct himax_ts_data *ts = dev_id;
    struct himax_event event;

    if (himax_read_event(ts, &event))
        return IRQ_NONE;
    if (!himax_verify_checksum(ts, &event))
        return IRQ_HANDLED;

    /* decode points, report into MT slots, then: */
    input_mt_sync_frame(ts->input);
    input_sync(ts->input);
    return IRQ_HANDLED;
}
```

The coordinate frame itself is just a fixed byte layout the firmware produces. Describe it with a packed struct and let the compiler do the offset math:

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

**Finding #5, the good one.** Firmware loaded, CRC clean, `touchscreen ready` in the log, and touch did not work. `getevent` showed nothing. So I looked at the interrupt count:

```
$ grep himax /proc/interrupts
316:  201984  ...  msmgpio  22 Level  himax-hx83112f
316:  206731  ...  msmgpio  22 Level  himax-hx83112f
316:  210399  ...  msmgpio  22 Level  himax-hx83112f
```

Climbing by thousands per second, with nobody touching the screen. An **interrupt storm**.

The line is level-triggered and active-low. The chip pulls it low when a frame is ready and releases it once you *read the frame out of the FIFO*. My handler was reading, but in the wrong bus mode, so it got garbage, failed the checksum, and returned without actually draining the FIFO. The line stayed low, the handler fired again, forever, and every frame was junk so `getevent` stayed silent. Two symptoms, one cause.

The fix was one call the vendor makes before every coordinate read and I had skipped, putting the AHB into continuous burst mode first:

```c
/* Without this the FIFO read returns garbage, the checksum fails every
 * time, and the level-low line never clears -> interrupt storm. */
himax_burst_enable(ts, false);
```

One line. The storm stopped and `getevent` lit up with `ABS_MT_POSITION_X/Y`, tracking IDs, and clean `BTN_TOUCH`. Ten fingers, independent slots. If you ever see a rising interrupt count with no input events, this is the shape of the bug: you are being interrupted but not acknowledging it, and for most chips "acknowledge" means "read the data".

## Suspend, resume, and the in-cell tax

Touch worked. Then I locked the screen, unlocked it, and touch was dead again.

This is the **in-cell** tax. The HX83112F shares its power rail with the display panel. When the screen blanks, the panel powers down, and the controller loses that volatile SRAM firmware. On wake it comes back powered but empty.

My first instinct was the driver's PM hooks, `.suspend`/`.resume`. They never fired. **Finding #6:** on this platform, screen-off is not a system suspend. The SoC stays awake; only the display blanks, and that is delivered as a `drm_panel` notifier event, not a PM transition. So the fix is to listen to the panel:

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

You register for this with `drm_panel_notifier_register()`, after finding the panel from the `panel` phandle on your node with `of_drm_find_panel()` (returning `-EPROBE_DEFER` until the panel driver shows up). Disabling the IRQ *before* power-down matters too: an unpowered input can float and put you right back into a storm.

If your device is in-cell, budget for this from the start. It is not an edge case; it fires every single time the screen turns off.

## The kernel-version tax: writing for 4.19

I built this on the mainline `himax_hx83112b` driver as a reference, but billie's downstream kernel is **4.19**, and the reference uses APIs that simply do not exist that far back. This is a normal part of backporting, and worth calling out because you will hit it:

| Modern API | What I used on 4.19 |
| --- | --- |
| `guard(mutex)` / `scoped_guard()` (cleanup.h) | plain `mutex_lock()` / `mutex_unlock()` |
| `devm_mutex_init()` | `mutex_init()` |
| `DEFINE_SIMPLE_DEV_PM_OPS` / `pm_sleep_ptr()` | `SIMPLE_DEV_PM_OPS` + `__maybe_unused` |

The lesson is boring but real: the kernel's helper APIs drift constantly, and a driver written against 6.x will not compile on 4.19. When you copy from a newer driver, grep your own tree's headers for every helper before you trust it. `dev_err_probe()` and `touchscreen_report_pos()` happened to be backported here; the cleanup-guard macros were not.

## The display was married to the touch driver

One downstream-only knot caught me completely off guard, and it is a good warning about vendor trees.

When I disabled the vendor touch driver to build mine, the **display** stopped linking:

```
ld.lld: error: undefined symbol: TP_Panel
>>> referenced by dsi_panel.c
```

The display driver publishes the active panel pointer into a global called `TP_Panel`, and the *storage* for that global lived inside the vendor touch driver. Remove the touch driver, remove the symbol, break the display. On this device, touch and display are quietly welded together.

I moved the definition into a part of the vendor stack that is always built, so the display links whether my driver is present or not. On mainline this coupling does not exist, so it just evaporates on the way up. But it is a reminder that in a vendor tree, "unrelated" subsystems often are not.

## Wiring it into the build

Three files make the driver real:

- **Kconfig** entry, with one important twist. Both my driver and the vendor one bind the same `himax,hxcommon` node, so they must be mutually exclusive:

  ```
  config TOUCHSCREEN_HIMAX_HX83112F
      tristate "Himax HX83112F no-flash touchscreen (minimal)"
      depends on SPI_MASTER
      depends on DRM
      depends on !TOUCHPANEL_HIMAX_HX83112F_NOFLASH
  ```

- **Makefile**: `obj-$(CONFIG_TOUCHSCREEN_HIMAX_HX83112F) += himax_hx83112f.o`
- **Device tree**: the `reset-gpios` property from Finding #4, on the existing touch node.

Then the defconfig switch: turn the vendor driver off, turn mine on.

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

Five fingers gives you five `ABS_MT_SLOT` blocks with distinct tracking IDs. And `/proc/interrupts` now sits still when idle and only ticks up when you actually touch, the opposite of the storm.

```
himax-hx83112f spi0.0: touchscreen ready (fw 131072 bytes)
```

## Taking it to mainline

The whole thing is a single self-contained SPI driver, which was the point. The downstream-only pieces are all deliberately isolated so the port up is mostly subtraction:

- the `himax,hxcommon` compatible becomes a proper `himax,hx83112f`
- the `touchpanel,panel-coords` fallback becomes standard `touchscreen-size-x/y`
- the ueventd firmware timing goes away, the blob just lives in `/lib/firmware`
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

`A touchscreen driver is a simple loop wrapped in five things that will each break it once.`

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
