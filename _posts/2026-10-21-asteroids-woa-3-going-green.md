---
layout: post
title: "Windows on the Nothing Phone (3a) - Part 3: Going Green"
date: 2026-10-21 00:00:03 +0530
categories: [Windows on ARM]
tags: [UEFI, Qualcomm, Mu-Silicium, ARM64, Reverse Engineering]
description: "Every hang is a loop waiting for something that will never happen."
author: danascape
series: "Windows on the Nothing Phone (3a)"
toc: true
---

## Where we are

At the end of [Part 2]({% post_url 2026-10-21-asteroids-woa-2-uefi-project %}) the firmware started, printed its log, loaded twenty-odd drivers, and stopped at:

```
Loading driver at 0x000... PmicDxe.efi
```

This part goes from there to a fully booted UEFI: the Silicium logo, working storage, buttons, USB, and mass storage. In `Status.md` terms:

| Feature | State at the end of this part |
|---|---|
| Display | working |
| Internal Storage | working |
| Side Buttons | working |
| USB Device Mode | working |
| Mass Storage | working |
| USB Host Mode | not tested yet |
| USB Power Delivery | not tested yet |
| Windows Boot / Linux Boot | Part 4 |

Most of this part is about one skill: **reading and patching closed-source ARM64 binaries**. Qualcomm does not give us source for its drivers. When one hangs, we disassemble it, figure out what it is waiting for, and change a few bytes so it stops waiting.

## Tools for this part

```bash
# disassemble a whole driver
/usr/lib/llvm-18/bin/llvm-objdump -d --no-show-raw-insn PmicDxeLa.efi > pmic.s

# disassemble a few bytes at a file offset
xxd -s 0x13120 -l 24 -p PmicDxeLa.efi | sed 's/../0x& /g' | \
  /usr/lib/llvm-18/bin/llvm-mc --disassemble -triple=aarch64 -mattr=+v9.2a

# assemble one instruction to get its bytes
echo 'mov w0, wzr' | /usr/lib/llvm-18/bin/llvm-mc -triple=aarch64 -show-encoding

# compare two binaries byte by byte (offsets are decimal, values octal)
cmp -l Original.efi Patched.efi
```

I wrapped the second command in a tiny Python helper because I used it hundreds of times:

```python
# aadis.py: disassemble n instructions at a file offset
import subprocess
def dis(path, off, n=6):
    d = open(path, 'rb').read()[off:off + 4*n]
    src = ' '.join('0x%02x' % b for b in d)
    r = subprocess.run(['/usr/lib/llvm-18/bin/llvm-mc', '--disassemble',
                        '-triple=aarch64', '-mattr=+v9.2a,+mte,+pauth'],
                       input=src, capture_output=True, text=True).stdout
    lines = [l.strip() for l in r.splitlines() if l.strip() and not l.strip().startswith('.')]
    for i, l in enumerate(lines):
        print('    %06x  %s' % (off + 4*i, l))
```

One thing to know when reading `llvm-mc` output: it prints branch targets as **offsets relative to the instruction**, not absolute addresses. `bl #24668` at `0x13128` means a call to `0x13128 + 24668 = 0x13128 + 0x605C = 0x19184`. `llvm-objdump` on the whole file prints absolute addresses instead, which is easier to follow when you are reading a full function.

> For Qualcomm's small DXE drivers, the code section's file offset and its virtual address are the same, so the offsets in this post are both file offsets and RVAs. Check this for your own binaries (Part 1 explains the conversion); for large Microsoft binaries it is not true.
{: .prompt-info }

## Porting other people's patches

Before writing any patches of my own, I ported the ones that already exist for bale_b, the donor device. Every device folder in `Binaries` has a `README.md` describing its patches, and keeps both the stock file and the `.patched.efi` one. bale_b's list:

| Driver | Patch | Why |
|---|---|---|
| SPMIDxe | Stub out the SPMI handle function | Crash during boot |
| PmicDxe | Make a failing SPMI write call return success | Hang during boot |
| ClockDxe | Remove the `Clock_CESTADisableDependencies` call | Keep some clocks on |
| TzDxeLA | Flip a global "TZ applet" flag from FALSE to TRUE | Crash during boot |
| UFSDxe | Replace the sleep call with a wakeup, plus a hibernate-exit | Use internal storage |
| ButtonsDxe | Map the power button to ENTER instead of SUSPEND | Usable power button |
| UsbConfigDxe | Do not de-initialize USB at ExitBootServices | USB keeps working in the OS |
| UsbMsdDxe | Report the disk as non-removable | Mass storage behaves |

The patches are tied to *bale_b's* binaries. My binaries are built from the same boot branch, so the code is mostly the same, but at different offsets, with different addresses in branch instructions. Copying bytes at the same offsets would corrupt random code. The process for each patch:

### Step 1: see exactly what the donor changed

```bash
cd Binaries/bale_b/QcomPkg/Drivers/ClockDxe
cmp -l ClockDxe.efi ClockDxe.patched.efi
```

`cmp -l` prints every differing byte (offset in decimal, then old and new values in octal). Convert the first offset to hex, then disassemble both files there:

```
bale_b ClockDxe.efi @ 0xa514:
    sub   sp, sp, #64
    stp   x29, x30, [sp, #16]
    ...
bale_b ClockDxe.patched.efi @ 0xa514:
    mov   w0, #0
    ret
```

So the patch replaces the start of a function with "return 0". Now I need the same function in *my* ClockDxe.

### Step 2: find the same code in your binary

Searching for the exact bytes fails. Most instructions are identical between the two builds, but anything that encodes an address relative to itself (`bl`, `b`, `adrp`, `cbz`, `ldr` literal) changes when code moves.

So I search with those parts **masked out**. For each instruction, keep the opcode bits and register fields, zero the immediate offset, and compare:

```python
# fuzzy.py: find code from one binary in another, ignoring PC-relative offsets
import struct

def mask(w):
    if (w & 0x7C000000) == 0x14000000: return w & 0xFC000000   # b / bl
    if (w & 0xFF000010) == 0x54000000: return w & 0xFF00001F   # b.cond
    if (w & 0x7E000000) == 0x34000000: return w & 0xFF00001F   # cbz / cbnz
    if (w & 0x7E000000) == 0x36000000: return w & 0xFFF8001F   # tbz / tbnz
    if (w & 0x1F000000) == 0x10000000: return w & 0x9F00001F   # adr / adrp
    if (w & 0x3B000000) == 0x18000000: return w & 0xFF00001F   # ldr literal
    if (w & 0x7F800000) == 0x11000000: return w & 0xFFC003FF   # add imm (page offsets)
    if (w & 0x3B000000) == 0x39000000: return w & 0xFFC003FF   # ldr/str unsigned offset
    return w

def words(path):
    d = open(path, 'rb').read()
    return [struct.unpack_from('<I', d, i)[0] for i in range(0, len(d) - 3, 4)]

def find(src, soff, dst, before=8, after=8):
    s = words(src); t = words(dst); i0 = soff // 4
    pat = [(k - i0, mask(s[k])) for k in range(i0 - before, i0 + after) if 0 <= k < len(s)]
    return [j * 4 for j in range(len(t))
            if all(0 <= j + r < len(t) and mask(t[j + r]) == m for r, m in pat)]
```

```python
>>> find('bale_b/.../ClockDxe.efi', 0xa514, 'asteroids/.../ClockDxe.efi')
[0xa66c]
```

Exactly one match means the same code is at `0xa66c` in my binary. Zero matches means the code changed (shrink the window with `before`/`after`, or read both functions by hand). Two or more means the pattern is too short.

The masks come from the ARM instruction encoding tables. You do not need all of them memorized; the ones above cover the instructions that commonly differ between builds.

### Step 3: verify by reading, then patch

Always disassemble your match and the donor's original side by side and read them. Same instructions, same structure, same registers? Then apply the patch at your offset:

```python
import struct
d = bytearray(open('ClockDxe.efi', 'rb').read())
assert struct.unpack_from('<I', d, 0xa66c)[0] == 0xD10103FF   # sub sp, sp, #64 (sanity check)
struct.pack_into('<I', d, 0xa66c, 0x52800000)   # mov w0, #0
struct.pack_into('<I', d, 0xa670, 0xD65F03C0)   # ret
open('ClockDxe.patched.efi', 'wb').write(d)
```

The `assert` is important. If you run the script on the wrong file, or twice, it stops instead of silently corrupting something.

Then point the INF at the patched file:

```ini
[Binaries.AARCH64]
  DXE_DEPEX|ClockDxe.depex|*
  PE32|ClockDxe.patched.efi|*
```

Keep the stock file next to it. You will want to compare against it later.

### Where each bale_b patch landed on my phone

| Driver | bale_b offset | My offset | Change |
|---|---|---|---|
| SPMIDxe | | `0x154c`, `0x2e58` | `mov w0, #0; ret` |
| PmicDxe | | `0x1c6ac` | `mov w0, #0; ret` (SPMI write wrapper) |
| ClockDxe | `0xa514` | `0xa66c` | `mov w0, #0; ret` |
| TzDxeLA | | byte `0xe5a8` | `0` → `1` |
| UFSDxe | | `0xa528` | see the UFS section below |
| ButtonsDxe | | `0x3cc0` | `mov w8, #13; b #-76` |
| UsbConfigDxe | `0x565c` | `0x561c` | `cbz` → `b` |
| UsbMsdDxe | `0x3ff0` | `0x3ff0` | `mov w8, #0x80` → `mov w8, #0` |

UsbMsdDxe happened to be at the same offset in both builds. Most were not.

#### The TzDxe flag

TzDxe's patch is not code, it is data: one byte in the data section that holds a global boolean. To port it, I found which instructions *read* that byte in bale_b's binary (its cross references), found the same instructions in mine with the fuzzy matcher, and followed their `adrp` + `ldrb` to the address they read. In my binary it was file offset `0xe5a8`, read from code at `0x2fc0` and `0x3320`:

```python
d = bytearray(open('TzDxeLA.efi', 'rb').read())
assert d[0xe5a8] == 0
d[0xe5a8] = 1
open('TzDxeLA.patched.efi', 'wb').write(d)
```

#### The buttons patch

A good example of a patch that changes behavior rather than skipping something. In ButtonsDxe, the power button's key code is loaded into `w8` and then the code jumps to the common "report key" path:

```
stock:                               patched:
3cb8  cmp   w15, #1                   3cb8  cmp   w15, #1
3cbc  b.ne  #12                       3cbc  b.ne  #12
3cc0  mov   w8, #258    (0x102)       3cc0  mov   w8, #13     (ENTER)
3cc4  b     #-168                     3cc4  b     #-76
```

`0x102` is the UEFI scan code for SUSPEND, which does nothing useful in a menu. The patch loads 13 (carriage return, ENTER) instead, and jumps to the path that reports a *character* key rather than a scan code. So the power button selects menu items.

#### UsbConfigDxe

```
stock:                               patched:
5618  ldrb  w8, [x8, #2233]           5618  ldrb  w8, [x8, #2233]
561c  cbz   w8, #52                   561c  b     #52
```

In the ExitBootServices handler, a flag decides whether to tear down the USB controller. Turning the conditional `cbz` into an unconditional `b` always takes the "skip teardown" path.

## Hang 1: PmicDxe

With all bale_b patches ported, the log still stopped at PmicDxe.

The **PMIC** (Power Management IC) is the chip that supplies every voltage rail on the board, handles the power key, charging and the battery. Qualcomm phones have several PMIC chips, and the SoC talks to them over a two-wire bus called **SPMI**. PmicDxe initializes them through SPMIDxe.

bale_b's patches make SPMI calls return success instead of crashing (our firmware is not allowed to do some PMIC writes the way Qualcomm's own UEFI did). That fixes a crash, but creates a new problem: any code that writes a PMIC register and then **waits for it to change** will now wait forever, because the write never actually happened.

### Patches from other devices

Other ports on the same boot branch (muyu, peridot, salami) had one more PmicDxe patch: "Removed PMIC Post Init". I found the matching code in my binary with the fuzzy matcher: two `bl` calls inside PmicDxe's main init sequence:

```
3910  mov   w19, w0
3914  bl    #64340      <- post-init step
3918  orr   w19, w0, w19
391c  bl    #58056      <- post-init step
```

Replacing both with `mov w0, wzr` makes them "return success" without running. Rebuilt, tested: still stuck at PmicDxe, with no new log lines.

### Bisecting a binary

No new lines means I had no idea where inside PmicDxe it was stuck. The driver's entry function runs a long list of init steps. So I built **six test images**, each making PmicDxe return success at a different point:

| Image | How much of PmicDxe runs |
|---|---|
| cut0 | nothing, return immediately at the entry point |
| cut1 | setup only, before the main init function |
| cut2 | the first 3 init steps |
| cut3 | 2 more steps |
| cut4 | 1 more step |
| cut5 | almost everything |

The patch for a "cut" is simple: at the cut point, set the status register to 0 and jump to the function's epilogue (its cleanup and `ret`):

```python
# cut.py <in> <out> <variant>
import struct, sys
src, dst, variant = sys.argv[1], sys.argv[2], int(sys.argv[3])
d = bytearray(open(src, 'rb').read())
put = lambda off, w: struct.pack_into('<I', d, off, w)
b = lambda pc, t: 0x14000000 | (((t - pc) >> 2) & 0x3FFFFFF)    # encode "b target"
MOV_X0_XZR, RET, MOV_W21_WZR = 0xAA1F03E0, 0xD65F03C0, 0x2A1F03F5

if variant == 0:   put(0x1148, MOV_X0_XZR); put(0x114C, RET)      # entry point
elif variant == 1: put(0x15CC, MOV_X0_XZR); put(0x15D0, RET)      # main init
else:
    cut = {2: 0x15F4, 3: 0x1618, 4: 0x1684, 5: 0x1698}[variant]
    put(cut, MOV_W21_WZR)               # the function keeps its status in w21
    put(cut + 4, b(cut + 4, 0x16D8))    # jump to the epilogue at 0x16d8
open(dst, 'wb').write(d)
```

How I picked these addresses: I read the main init function in the full disassembly (`llvm-objdump`), found its epilogue (the block that restores registers and returns, at `0x16d8`), noticed it returns `w21` as its status, and picked cut points between the `bl` calls of the init sequence.

Then I built one image per variant and booted them in order. The result:

- cut0 to cut4: the log went past PmicDxe (later drivers loaded, some complained, which is expected when PMIC setup is skipped)
- cut5: stuck at PmicDxe

So the hang was in the steps between cut4 and cut5: two calls, to `0x1514` and `0x1305c`.

### Finding the loop

`0x1305c` was the battery init function. Inside it:

```
13120  tst   w8, w10
13124  b.eq  #28
13128  bl    #24668      -> 0x19184
1312c  mov   w19, w0
13130  bl    #31780      -> 0x1ad54
13134  orr   w19, w0, w19
```

Reading `0x19184` and `0x1ad54`: both are battery and charger detection routines. They write PMIC registers to start a detection, then poll a status register in a loop until it reports done. With PMIC writes disabled, the detection never starts, and the poll never ends.

The fix (I called it fixA) replaces just those two calls:

```
13128  mov   w0, wzr
1312c  mov   w19, w0
13130  mov   w0, wzr
13134  orr   w19, w0, w19
```

```python
import struct
d = bytearray(open('PmicDxeLa.patched.efi', 'rb').read())
bl = lambda pc, t: 0x94000000 | (((t - pc) >> 2) & 0x3FFFFFF)
for pc, t in ((0x13128, 0x19184), (0x13130, 0x1AD54)):
    assert struct.unpack_from('<I', d, pc)[0] == bl(pc, t)   # really the call we expect
    struct.pack_into('<I', d, pc, 0x2A1F03E0)                 # mov w0, wzr
open('PmicDxeLa.patched.efi', 'wb').write(d)
```

I also built a fixB that skipped the whole battery init function, as a fallback. I did not need it. fixA got past PmicDxe.

> Patch the narrowest thing that works. Skipping a whole init function may "fix" the hang and break something unrelated later, and you will not know which patch caused it.
{: .prompt-tip }

### A side note: PmicDxe's own logs

PmicDxe has its own debug prints, filtered by a print mask stored in the binary (at file offset `0x2946c`, value `0x80000400`) and a second filter (`b.eq` at `0x493c`). Patching those makes it print much more. I used that once while chasing this hang; it showed nothing useful because the hang was before any print, which is why the bisect was needed. Still worth knowing.

## Hang 2: UFSDxe

Past PmicDxe, the log now stopped at UFSDxe with:

```
ufs_error_log: 11
ufs_error_log: 96
ufs_error_log: fffffffb
```

### What UFS needs at boot

UFS storage has two parts: the **host controller** inside the SoC (at `0x1D84000` on this chip) and the **UFS device** (the flash chip). They talk over a high-speed serial link. The controller is commanded with **UIC commands** (link-level: power modes, hibernate) and **SCSI commands** (data-level: read, write, start unit).

When the phone's bootloader hands over, the link and the device can be in different states: link active or in hibernate (a low power link state), device powered on or stopped. The UEFI driver must bring both to active before reading anything.

### Decoding the error log

`ufs_error_log` prints numbers, not messages, so I searched the disassembly for where each value is passed to the logging function. `0x11` is logged when a UIC command completes but reports failure. `0x96` identifies the call site: the command being sent was `0x18`, `DME_HIBERNATE_EXIT`, "wake the link from hibernate". `fffffffb` is -5, `EFI_DEVICE_ERROR`.

That command was not in the stock driver's path. It came from the patch I ported from bale_b, which had **two parts**:

1. Replace a call that puts the device to sleep with a call that sends SCSI **START STOP UNIT** with "active".
2. A code cave (extra code written into unused space in the binary) that sends `DME_HIBERNATE_EXIT` first, because on bale_b the bootloader leaves the link in hibernate.

On my phone the link was already active. Exiting hibernate when you are not in hibernate fails. And bale_b's cave, on failure, logs the error and jumps back to its own start, so it retries forever. That is the hang.

### Three test images

| Image | Contents | Result |
|---|---|---|
| ufsA | both parts, but the cave continues on failure instead of looping | long register dump, then `ASSERT ... Device Error`, reboot. The failed hibernate exit left the link broken |
| ufsB | stock UFSDxe, no patch | short trace, ASSERT, reboot. But the trace showed the device *answering*: SCSI sense data `70 00 02 ... 04 02` |
| ufsC | stock UFSDxe + part 1 only | **works** |

ufsB was the useful failure. SCSI sense data is how a storage device explains why it refused a command:

- `70`: standard sense format
- sense key `02`: NOT READY
- additional sense code `04`, qualifier `02`: "logical unit not ready, initializing command required"

In plain terms: "I am fine, but someone needs to send me a START UNIT command." That is exactly what part 1 of bale_b's patch does. So ufsC kept only part 1:

```
stock:                               ufsC:
a520  cmp   w20, #208                 a520  cmp   w20, #208
a524  b.ne  #116                      a524  b.ne  #116
a528  bl    #5724     -> 0xbb84       a528  mov   x1, #1
a52c  cbnz  w0, #-80                  a52c  bl    #6020     -> 0xbcb0
a530  mov   x0, x19                   a530  mov   x0, x19
```

`0xbb84` is the stock call (it checks the state and fails when the device is stopped). `0xbcb0` is the function that sends START STOP UNIT; `x1 = 1` is the "start, active" argument.

With ufsC, the log went past UFSDxe, past the rest of the drivers, and the screen showed the **Silicium logo**. UEFI booted.

> Ported patches encode assumptions about the donor's bootloader. Read what each part does, and test the parts separately. "Patch from a similar phone" is a starting point, not a fix.
{: .prompt-warning }

## Boot messages that look scary but are fine

With UEFI booting, the DEBUG log had a few errors:

```
IQSEEComCompatAppLoader_loadFromBuffer failed ret = 16     (featenabler app)
SPSS not supported ...
Pwload - ERR - fail!
```

- The first is TrustZone refusing to load the `featenabler` secure app. It only affects `FeatureEnablerDxe`, which nothing we need depends on.
- SPSS (the secure processor subsystem) is not used in UEFI on this chip and is skipped.
- `Pwload` comes from GpiDxe failing to load firmware for GPI, a DMA engine used by I2C/SPI controllers. They still work without it, just slower.

None of them block anything. The way to judge an error message: find which driver prints it, and ask whether anything you need depends on that driver.

## Buttons

With the ButtonsDxe patch, volume up/down move through the menu and power selects. Nothing else to do. Side buttons: green.

## Display

The display was "working" since the very first boot, because we never drive the display hardware. ABL already turned the panel on and set up a framebuffer at `0xE3940000` to show its splash. Mu-Silicium's SimpleFbDxe just draws into that same buffer, at the resolution set in the dsc (1080 x 2392, 32 bits per pixel).

Two things had to be right for that:

- the `Display_Reserved` entry in the memory map at the splash address, so nothing else allocates that memory,
- the SMMU detach in `PlatformSecLib` (Part 2), so the display engine reads physical memory directly.

Windows also uses this framebuffer through the generic "Basic Display" driver, so no display driver is needed to see Windows.

## USB and mass storage

Mu-Silicium's front page has a **Mass Storage** option. It exposes UFS LUN 0 (the big one with `userdata`) to a PC as a USB disk.

On the phone side, it worked once UsbConfigDxe and UsbMsdDxe were patched. On my laptop, it did not show up. This took a while, and none of it was the phone's fault.

### What I checked on the PC

```bash
lsusb                                  # is the device there at all?
dmesg -w                               # what does the kernel do when it attaches?
journalctl -f | grep -iE "usb|scsi"
```

The phone enumerated as `05c6:f000` in mass storage mode (it shows up as `045e:066b` "Windows Flashing Capable Device" in plain UEFI USB mode). Then three separate things got in the way:

1. **usb_modeswitch**. It has rules for `05c6:f000` because some 4G modems use that ID, and it tried to "switch" the phone into modem mode. Fix: `DisableSwitching=1` in `/etc/usb_modeswitch.conf`.
2. **gvfs MTP**. GNOME's MTP volume monitor guessed it was a OnePlus phone in MTP mode and grabbed it. Fix: `systemctl --user stop gvfs-mtp-volume-monitor.service`.
3. **Endpoint security software.** My work laptop runs Kaspersky's endpoint agent with device control, which removes USB storage devices about 36 ms after they attach. That one I could not turn off.

### Proving the phone side works anyway

Since the laptop would not let a USB disk exist, I talked to the phone's mass storage directly with `pyusb`, sending SCSI commands myself the way the kernel's `usb-storage` driver would. USB mass storage ("Bulk-Only Transport") is simple: you send a 31-byte **Command Block Wrapper** containing a SCSI command, optionally read data, then read a 13-byte **Command Status Wrapper**.

```python
# msdprobe.py: talk SCSI to a USB mass storage device without the kernel driver
import struct, usb.core, usb.util

dev = usb.core.find(idVendor=0x05c6, idProduct=0xf000)
if dev.is_kernel_driver_active(0):
    dev.detach_kernel_driver(0)
usb.util.claim_interface(dev, 0)

tag = 1
def cmd(lun, cdb, inlen):
    global tag
    # CBW: signature 'USBC', tag, data length, direction, LUN, CDB length, CDB
    cbw = struct.pack('<IIIBBB', 0x43425355, tag, inlen, 0x80 if inlen else 0,
                      lun, len(cdb)) + cdb.ljust(16, b'\0')
    tag += 1
    dev.write(0x01, cbw, timeout=3000)
    data = bytes(dev.read(0x81, inlen, timeout=3000)) if inlen else b''
    csw = bytes(dev.read(0x81, 13, timeout=3000))      # CSW: 'USBS', tag, residue, status
    return csw[12], data

st, d = cmd(0, bytes([0x12, 0, 0, 0, 36, 0]), 36)      # INQUIRY
print('INQUIRY', st, d[8:36])
st, d = cmd(0, bytes([0x00] * 6), 0)                    # TEST UNIT READY
print('TEST UNIT READY', st)
st, d = cmd(0, bytes([0x25] + [0] * 9), 8)              # READ CAPACITY(10)
last, bs = struct.unpack('>II', d)
print('blocks', last + 1, 'block size', bs, 'GiB %.1f' % ((last + 1) * bs / 2**30))

usb.util.release_interface(dev, 0)
dev.attach_kernel_driver(0)
```

The result: INQUIRY answered, TEST UNIT READY passed, READ CAPACITY reported **234.2 GiB** with 4096-byte blocks. That is LUN 0, exactly right. Once I had stopped usb_modeswitch and gvfs, the laptop did briefly see it as a disk with all thirteen partitions, before device control removed it again.

So mass storage works. If you are on a normal Linux or Windows PC, it should just show up. If it does not, check for anything on the PC side that claims USB devices before blaming the firmware.

> This is also why I did the Windows install in Part 4 without mass storage. Most guides tell you to put the phone in mass storage mode and run `dism` from a Windows PC. I had neither a Windows PC nor a laptop that would allow it, so everything was done from Android and from Linux tools.
{: .prompt-info }

## Writing it down

Two pieces of documentation for this part.

`Binaries/asteroids/README.md` lists every patch: the driver, the reason, what changed, and who originally made it. Patch authors on Silicium are credited by name, and if you reuse their work you should do the same. Mine credits Gustave Monce (buttons), Robotix (clocks, PMIC), Kancy Joe (SPMI, PMIC, UFS), Shandorman (PMIC) and N1kroks (TzDxe, UFS), and notes which parts I changed for this phone (the extra PMIC battery-detection patch, and UFS without the hibernate exit).

`Status.md` gets a section for the device:

```markdown
## Nothing Phone (3a)

**State:** Active <br>
**Codename:** asteroids

| Feature            | Description | State |
|:-------------------|:------------|:-----:|
| Display            |             | ✅    |
| Internal Storage   |             | ✅    |
| Side Buttons       |             | ✅    |
| USB Host Mode      |             | ❔    |
| USB Device Mode    |             | ✅    |
| USB Power Delivery |             | ❔    |
| Mass Storage       |             | ✅    |
| Windows Boot       |             | ❔    |
| Linux Boot         |             | ❔    |
```

Then commit. In the `Binaries` submodule I committed **one patch per commit**, then the README, so anyone can see exactly which bytes each fix changed. Then the submodule pointer and `Status.md` in the main repo.

## What I learned in this part

- A hang in a closed driver is almost always a loop waiting for hardware. Bisect to find the function, then read it to find the loop.
- Build several test images at once. Each boot test costs a minute or two, and having cut0 to cut5 ready meant one sitting instead of six round trips.
- Port patches by meaning, not by offset. Masked pattern search finds the code; reading it confirms it.
- Every ported patch is someone else's fix for someone else's bootloader. When one does not work, split it into parts and test them separately.
- Use `assert` in every patch script.

In [Part 4]({% post_url 2026-10-21-asteroids-woa-4-booting-windows %}) we make room for Windows on the phone, boot Windows PE, and spend a long time finding out why Windows Boot Manager hangs.
