---
layout: post
title: "Windows on the Nothing Phone (3a) - Part 4: Booting Windows"
date: 2026-10-21 00:00:04 +0530
categories: [Windows on ARM]
tags: [UEFI, Windows, Qualcomm, Mu-Silicium, ARM64, Reverse Engineering, ACPI]
description: "Three minutes of a frozen logo, and a GUID I made up myself."
author: danascape
series: "Windows on the Nothing Phone (3a)"
toc: true
---

## Where we are

After [Part 3]({% post_url 2026-10-21-asteroids-woa-3-going-green %}) the phone boots Mu-Silicium to the logo with storage, buttons, USB and mass storage working. This part is about Windows:

1. Making room on the phone's storage (an ESP and a Windows partition).
2. Building a Windows PE that drops to a command prompt, and putting it on the ESP.
3. A crash caused by the memory map.
4. A long silent hang, and the method I used to find it without a debugger.
5. The cause: a GUID.
6. Making Windows see the phone's storage.
7. Installing full Windows.

The order is the order things happened. Sections 3 to 5 are where most of the day went, and I think they are the most useful part of this series, because the technique works for any "it just hangs" problem on any device.

## Making room: partitioning

### What Windows needs

- An **ESP**: FAT32, GPT type `EF00`. Holds Boot Manager, the BCD, and (for WinPE) the boot image. I made it 2 GiB because WinPE's `boot.wim` is 700+ MB.
- A **Windows partition**: NTFS, GPT type `0700` (Microsoft basic data). Everything else.

On a phone, the only big partition is `userdata`. So: shrink `userdata`, put the new partitions after it. Android keeps working, with less space.

> This wipes Android's data. `userdata` is encrypted per-device, and resizing it means Android has to format it on next boot. Back up anything you care about. And keep the GPT backup from Part 2.
{: .prompt-danger }

### Looking at the table

```bash
adb root
adb shell sgdisk --print /dev/block/sda
```

On my phone the main LUN (`sda`) uses **4096-byte sectors** (UFS usually does), so sector numbers are 4 KiB units, not the 512-byte units you may be used to. `userdata` was partition 13, the last one, running to the end of the disk (234 GiB).

### The new layout

I wanted 64 GiB for Android. 64 GiB / 4 KiB = 16,777,216 sectors. `userdata` started at sector 2,449,992, so:

| # | Name | Start | End | Size | Type |
|---|---|---|---|---|---|
| 13 | `userdata` | 2449992 | 19227647 | 64 GiB | Android data (unchanged type GUID and unique GUID) |
| 14 | `esp` | 19227648 | 19751935 | 2 GiB | `EF00` |
| 15 | `win` | 19751936 | 61390842 | 158.8 GiB | `0700` |

I copied this approach from my OnePlus phone, where I had done the same thing earlier with `sgdisk` from a root shell. On the phone:

```bash
sgdisk --delete=13 \
  --new=13:2449992:19227647 \
  --typecode=13:1B81E7E6-F50D-419B-A739-2AEEF8DA3335 \
  --partition-guid=13:4B7839CC-3B42-5B66-9F3C-08919267C764 \
  --change-name=13:userdata \
  --new=14:19227648:19751935 --typecode=14:EF00 --change-name=14:esp \
  --new=15:19751936:61390842 --typecode=15:0700 --change-name=15:win \
  /dev/block/sda
sgdisk --verify /dev/block/sda
```

Notes:

- Recreating `userdata` with its **original type GUID and unique partition GUID** matters. Android finds it by name, but some firmware and init scripts check the GUIDs too. Read both with `sgdisk --info=13 /dev/block/sda` before deleting.
- The kernel will not see the new partition bounds while `userdata` is mounted, so reboot. The old `userdata` contents do not survive the resize; I did a factory reset, and after it `df -h /data` showed 64 GiB and Android booted normally.
- **Use `/dev/block/by-name/esp` and `/dev/block/by-name/win` from now on**, never `/dev/block/sda14`. On one boot, the main LUN showed up as `sdc` instead of `sda`.

### Formatting from the phone

My phone's root shell has `newfs_msdos` and `mkfs.ntfs`, so no PC is needed:

```bash
newfs_msdos -F 32 -S 4096 -c 1 -L ESP /dev/block/by-name/esp
mkfs.ntfs -f -s 4096 -L Windows /dev/block/by-name/win
```

`-S 4096` tells the FAT formatter the real sector size. Get this wrong and UEFI's FAT driver may refuse the filesystem.

### The 32-entry GPT problem

`sgdisk --print` also told me the GPT on `sda` only has room for **32 partition entries**. The UEFI spec requires at least 128, and recent Windows versions are known to "fix" non-compliant GPTs on their own, which on a phone can be disastrous.

A dry run (`sgdisk --resize-table=128` on a copy of the table) showed the larger table fits without moving any partition. I have not applied it yet; it has to happen before a full Windows boot touches the disk. If you do this yourself, do it at the same time as repartitioning.

## Getting a Windows image

### Which Windows

Windows on ARM builds come as `.esd` files. I used **Windows 11 25H2, build 26200, ARM64**, the consumer "multi-edition" ESD. Mu-Silicium's status page says recent Qualcomm generations need Windows builds **26090 or newer**; older builds do not support the newest CPU cores.

```bash
wimlib-imagex info 26200.9550...A64FRE_EN-US.esd
```

lists the images in it. Mine had six; index 1 is Windows 11 Pro.

### Building a WinPE from the install image

Microsoft's "real" WinPE comes with the Windows ADK, which only runs on Windows. But every install image already contains a WinPE: the recovery environment.

```bash
mkdir -p ~/woa/winpe && cd ~/woa/winpe
wimlib-imagex extract ~/Downloads/26200*.esd 1 \
    /Windows/System32/Recovery/winre.wim --dest-dir=. --no-acls
```

(The path is case-sensitive inside the ESD: `winre.wim`, lowercase. My first try with `Winre.wim` silently extracted nothing.)

WinRE starts a recovery UI via `winpeshl.ini`. Delete that file and it runs `startnet.cmd`, which leaves you at a command prompt:

```bash
cp winre.wim boot.wim
wimlib-imagex update boot.wim 1 --command="delete /Windows/System32/winpeshl.ini"
```

The boot files come from the install image too:

```bash
wimlib-imagex extract ~/Downloads/26200*.esd 1 \
    /Windows/Boot/DVD/EFI/BCD /Windows/Boot/DVD/EFI/boot.sdi \
    /Windows/Boot/EFI/bootmgfw.efi /Windows/Boot/EFI/en-US /Windows/Boot/Fonts \
    --dest-dir=boot --no-acls
```

`Boot/DVD/EFI/BCD` is the BCD Windows uses on its install DVD: one entry, "Windows Setup", that RAM-boots `\sources\boot.wim` using `\boot\boot.sdi`. That is exactly what we need.

The ESP layout:

```
EFI/Boot/bootaa64.efi               (copy of bootmgfw.efi, the fallback path)
EFI/Microsoft/Boot/bootmgfw.efi
EFI/Microsoft/Boot/BCD
EFI/Microsoft/Boot/Fonts/...
EFI/Microsoft/Boot/en-US/...
boot/boot.sdi
sources/boot.wim
```

### Reading and editing the BCD on Linux

The DVD BCD has **boot debugging** enabled for the boot manager (element `26000010`, `bootdebug`). With bootdebug on, Boot Manager tries to talk to a debugger on a serial port that does not exist. I wanted that off.

A BCD is a registry hive. You can read it with the Python library `regipy`:

```python
from regipy.registry import RegistryHive
h = RegistryHive('BCD')
for k in h.recurse_subkeys(as_json=False):
    print(k.path)
```

Each boot object is a key under `\Objects\{GUID}`, each setting a key under `Elements\<hex id>` with an `Element` value. `26000010` is a boolean stored as one byte. Changing one byte in an existing value does not change the hive's structure, so I wrote a tiny script that finds that element's data cell and flips it from `01` to `00`, then verified with regipy that it reads back as 0. (On Windows, `bcdedit /store BCD /set {bootmgr} bootdebug off` does the same.)

### Writing the ESP from Android

With mass storage blocked on my laptop (Part 3), I wrote the ESP from Android. This took some trial and error:

- `adb shell` sessions each get their own **mount namespace**. A mount made in one `adb shell` is invisible in the next one, and `adb push` cannot write into it. So everything (mount, copy, sync, unmount) must happen in **one** shell session.
- I first streamed a tar through `adb exec-in`. It **silently truncated** `boot.wim` by 1.8 MB. Always verify with `sha256sum`.

The reliable way: push to `/data/local/tmp`, then in one session mount the ESP, copy, sync, checksum, unmount:

```bash
#!/bin/bash
# esp_sync.sh <local ESP tree>: replace the phone's ESP contents, verified by sha256
set -e
T=$(realpath "$1")
adb root >/dev/null
adb shell 'rm -rf /data/local/tmp/espstage && mkdir -p /data/local/tmp/espstage'
for d in "$T"/*; do adb push "$d" /data/local/tmp/espstage/ >/dev/null; done
(cd "$T" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > /tmp/esp.local

adb shell '
  for i in 1 2 3 4 5; do mkdir -p /mnt/esp_t
    mount -t vfat /dev/block/by-name/esp /mnt/esp_t 2>/dev/null && break; sleep 2; done
  rm -rf /mnt/esp_t/EFI /mnt/esp_t/boot /mnt/esp_t/sources
  cp -r /data/local/tmp/espstage/. /mnt/esp_t/ && sync
  cd /mnt/esp_t && find . -type f ! -name "*.txt" | sort | while read f; do sha256sum "$f"; done
  cd /; umount /mnt/esp_t; rmdir /mnt/esp_t; rm -rf /data/local/tmp/espstage' > /tmp/esp.remote

diff <(sort -k2 /tmp/esp.local) <(sort -k2 /tmp/esp.remote) && echo "ESP synced and verified"
```

The retry loop on `mount` is there because the previous session's mount sometimes lingers for a second ("Device or resource busy"). Right after Android boots, `adb root` also needs a few seconds before the shell is really root.

## Crash 1: the memory map

First boot with WinPE on the ESP. Mu-Silicium found Boot Manager, loaded it, and crashed almost immediately:

```
Synchronous Exception ... External abort
FAR 0x0000000080000000
```

in `BdsDxe` (the boot manager part of our firmware), not in Windows.

Symbolizing the crash address against `Build/.../BdsDxe.dll` with `llvm-symbolizer --relative-address` pointed to the **Kernel Errata Patcher** (Part 1). KEP watches Boot Manager allocate memory, and at one point it reads memory that Boot Manager had just allocated as `LoaderCode`. That memory was at `0x80000000`.

Remember Part 1: on this phone, DRAM starts at `0x80000000`, and the first chunk of it belongs to the Gunyah hypervisor. Reading it from EL1 is an **external abort**: the hypervisor refuses the access.

But why did the firmware give that memory to Boot Manager? Our memory map from `xbl_config` did not list anything at `0x80000000`. And Mu-Silicium's `RamManagerDxe` reads the total RAM layout from Qualcomm's shared memory and **adds every range not in our map as free RAM**. So the gap became free memory.

### Finding every hole

The source of truth for "which memory may the OS use" is the device tree Android booted with. Two nodes:

- `/memory`: the RAM ranges the kernel is allowed to use at all,
- `/reserved-memory`: carve-outs inside those, with `no-map` meaning "do not even map this".

I wrote two short scripts that walk the DTB structure directly (no libraries needed, the format is simple) and print both:

```python
# memnode.py: print /memory reg ranges from a DTB
import struct, sys
d = open(sys.argv[1], 'rb').read()
off_struct, off_str = struct.unpack_from('>II', d, 8)
def s(o): return d[off_str + o: d.index(b'\0', off_str + o)].decode()
p = off_struct; path = []
while True:
    tok = struct.unpack_from('>I', d, p)[0]; p += 4
    if tok == 1:                                   # FDT_BEGIN_NODE
        e = d.index(b'\0', p); path.append(d[p:e].decode()); p = (e + 4) & ~3
    elif tok == 3:                                 # FDT_PROP
        ln, no = struct.unpack_from('>II', d, p); p += 8; v = d[p:p+ln]; p = (p + ln + 3) & ~3
        if len(path) == 2 and path[1].startswith('memory') and s(no) == 'reg':
            for i in range(0, len(v), 16):
                b, l = struct.unpack_from('>QQ', v, i)
                print('%010x-%010x %10.1f MiB' % (b, b + l, l / 2**20))
    elif tok == 2: path.pop()                      # FDT_END_NODE
    elif tok == 4: continue                        # FDT_NOP
    elif tok == 9: break                           # FDT_END
```

```
$ python3 memnode.py Resources/DTBs/asteroids.dtb
0080e00000-0081800000
0081cf5000-0081cff000
0081f20000-00824a0000
0082800000-008ac00000
...
0880000000-08afafe000
08b0000000-08b9700000
08bf800000-0900000000
0900000000-0a00000000
```

The first usable RAM starts at `0x80e00000`, not `0x80000000`. Everything between the listed ranges belongs to someone else. The `rsvmem.py` script (same walker, for `/reserved-memory` children) names the owners: `gunyah_hyp`, `tme`, `chipinfo`, `smem`, `adsp_mhi`, `pvm_fw`, `hyp_mem_database`, `tz_stat`, the modem/DSP firmware regions, `wlan_msa`, `cpusys_vm`, `qtee`, `trusted_apps`...

Then compare every gap against my `MemoryMapLib.c` and add a **reserved** entry for each one not already covered:

```c
{"NOMAP",            0x80000000, 0x016E0000, AddMem, MEM_RES, UNCACHEABLE, Reserv, UNCACHED_UNBUFFERED_XN},
{"TME",              0x81CA0000, 0x00044000, AddMem, MEM_RES, UNCACHEABLE, Reserv, UNCACHED_UNBUFFERED_XN},
{"ChipInfo",         0x81CF4000, 0x0000C000, AddMem, MEM_RES, UNCACHEABLE, Reserv, UNCACHED_UNBUFFERED_XN},
{"ADSP_MHI",         0x81F00000, 0x00020000, AddMem, MEM_RES, UNCACHEABLE, Reserv, UNCACHED_UNBUFFERED_XN},
{"HYP_Reserved",     0x825A0000, 0x00260000, AddMem, MEM_RES, UNCACHEABLE, Reserv, UNCACHED_UNBUFFERED_XN},
{"WLAN_MSA",         0xA6400000, 0x00C00000, AddMem, MEM_RES, UNCACHEABLE, Reserv, UNCACHED_UNBUFFERED_XN},
{"CPUSYS_VM",        0xE0600000, 0x00400000, AddMem, MEM_RES, UNCACHEABLE, Reserv, UNCACHED_UNBUFFERED_XN},
{"QTEE_Tags",        0xE8900000, 0x00C00000, AddMem, MEM_RES, UNCACHEABLE, Reserv, UNCACHED_UNBUFFERED_XN},
{"HYP_Reserved_Hi0", 0x8AFAFE000,0x00502000, AddMem, MEM_RES, UNCACHEABLE, Reserv, UNCACHED_UNBUFFERED_XN},
{"HYP_Reserved_Hi1", 0x8B9700000,0x06100000, AddMem, MEM_RES, UNCACHEABLE, Reserv, UNCACHED_UNBUFFERED_XN},
```

Don't forget memory above 4 GiB. Two hypervisor holes were up at `0x8AFAFE000` and `0x8B9700000`; a map that only covers the low 4 GiB would hand those out too. The attributes copy what other Silicium devices use for no-map regions (`MEM_RES`, uncached, reserved).

With those entries, the crash was gone.

### The FAT fix

While I was at it, I applied a patch from [topaz-woa](https://github.com/MakrSas/topaz-woa) (a Mu-Silicium port for the Redmi Note 12 4G that boots Windows) to the FAT driver in `Mu_Basecore`. Qualcomm phones have several small partitions with FAT-looking contents, some of which claim to be larger than their partition or are FAT12. The EDK2 FAT driver can hang on those. The patch rejects FAT volumes larger than their partition and skips FAT12. On my phone it fired on 8 partitions. It did not fix anything I could see, but it removed a suspect.

## The silent hang

Now Boot Manager loaded, the screen kept showing the Silicium logo... and nothing else happened. No error, no crash dump, no Windows logo. I waited three minutes several times. The same thing happened with the RELEASE build.

This is the worst kind of bug: no output. Here is how I approached it.

### Step 1: list the possibilities

At this point, Boot Manager was running and had stopped making progress. Candidates:

- it is waiting for something (a timer, a device),
- it is extremely slow (storage reading at KB/s),
- it crashed, but its crash handler shows nothing,
- the hypervisor stalled it.

### Step 2: log firmware calls

Boot Manager uses firmware services until ExitBootServices. So I made the firmware log every Boot Services call it received. In Mu-Silicium, KEP already hooks into the boot at the ReadyToBoot event, so I added a small diagnostic module there that replaces function pointers in the Boot Services table with wrappers that log and then call the original.

The last calls before the hang:

```
GetMemoryMap            -> BUFFER_TOO_SMALL, then Success
AllocatePages (Address, LoaderData, 2 pages)
FreePages
AllocatePages (Address, LoaderCode, 128 pages @ 0x82120000) -> Success
<nothing>
```

After that allocation, Boot Manager made **no further firmware calls**: no disk reads, no timer checks. And my own 2-second heartbeat timer stopped printing too.

### Step 3: write diagnostics to files instead of the screen

Reading tiny log text off a phone screen via photos wasted a lot of time (I misread hex digits more than once and went down a wrong path because of it). So I changed the approach: the diagnostic module waits until the ESP is mounted (it hooks `LoadImage`, which runs right after the file system is up) and writes text files to the ESP root:

- `memmap.txt`: the full UEFI memory map at the moment Boot Manager starts
- `bench.txt`: a quick read benchmark of the ESP
- `pmu.txt`: the CPU performance counter configuration
- later, `acpi.txt`: every ACPI table the firmware installed

On screen, it prints one line:

```
[DIAG] ESP write memmap/bench/pmu/acpi.txt = Success
```

After the test, back in Android, I mount the ESP and read them:

```bash
adb shell 'mkdir -p /mnt/esp_t && mount -t vfat /dev/block/by-name/esp /mnt/esp_t && cat /mnt/esp_t/memmap.txt; umount /mnt/esp_t'
```

Writing a file from UEFI is short: locate `EFI_SIMPLE_FILE_SYSTEM_PROTOCOL` on the ESP's handle, `OpenVolume`, `Open` with create mode, `Write`, `Close`. `PrintLib`'s `AsciiSPrint` formats the text.

What the files ruled out:

| Suspect | Result |
|---|---|
| Slow storage | 4K reads 88 MB/s, 64K 627 MB/s, 1M ~1 GB/s. Fine |
| Bad memory map | 117 descriptors, every usable range inside DT `/memory`, every no-map region reserved |
| The `0x82120000` allocation | That is normal RAM (the `RAMOOPS` neighborhood), inside an allowed range |
| Memory we can't write | Wrote and read back the first page of every free region: all 14 passed |
| PMU / timer | Cycle counter enabled, ~1.6 GHz; timer frequency 19.2 MHz as expected |
| Boot debugger | Off in the BCD |
| Newer Boot Manager | A completely different WinPE (an older 19041-based "driverless" one) hung the same way |

That last one was important: two Boot Manager versions years apart hung identically. So it was not a Boot Manager bug. It was something in **our environment**.

### Step 4: get symbols for Boot Manager

To go further I needed to know where Boot Manager was, which meant reading it. Microsoft publishes symbols for it. Every PE file has a debug directory entry with a "RSDS" record holding the PDB name, a GUID and an age. Extract them:

```python
import struct, sys
d = open(sys.argv[1], 'rb').read()
i = d.find(b'RSDS')
g = d[i+4:i+20]; age = struct.unpack_from('<I', d, i+20)[0]
name = d[i+24:d.index(b'\0', i+24)].decode().split('\\')[-1]
d1, d2, d3 = struct.unpack_from('<IHH', g)
gid = '%08X%04X%04X%s%X' % (d1, d2, d3, g[8:].hex().upper(), age)
print(f'https://msdl.microsoft.com/download/symbols/{name}/{gid}/{name}')
```

```bash
python3 pdburl.py bootmgfw.efi
curl -L -A "Microsoft-Symbol-Server/10.0.0.0" -o bootmgfw.pdb \
  "https://msdl.microsoft.com/download/symbols/bootmgfw.pdb/C6B0B2AA4429A57378F7820C96619A772/bootmgfw.pdb"

llvm-pdbutil dump -publics bootmgfw.pdb > publics.txt
llvm-objdump -d --no-show-raw-insn bootmgfw.efi > bootmgfw.s
```

`publics.txt` entries look like:

```
542340 | S_PUB32 [size = 32] `BlUtlGetAcpiTable`
         flags = function, addr = 0001:1865888
```

`0001:1865888` means section 1 (`.text`), offset 1865888 **decimal**. `.text` starts at RVA `0x1000` in this binary, and the image base is `0x10000000`, so:

```
RVA = 0x1000 + 1865888 = 0x1000 + 0x1C78A0 = 0x1C88A0
VA  = 0x10000000 + RVA = 0x101C88A0
```

I wrote a small script that loads all publics into a sorted list and annotates the disassembly with function names, so `bootmgfw.s` reads like `BlInitializeLibrary+0x33c: bl MmArchInitialize`. With that, I could read Boot Manager's startup sequence. `BlInitializeLibrary` initializes, in order: firmware interface, boot debugger, devices, architecture (exception vectors, EL handling), memory manager (`MmFwGetMemoryMap`, then the page allocator, heap, ...), time, logging, security, crypto, TPM, I/O, and so on. Then `BmMain` opens the BCD, picks an entry, loads the next stage.

The 128-page `LoaderCode` allocation was inside the memory manager setup. After that, Boot Manager does a lot of work without calling the firmware at all, so "no more firmware calls" did not necessarily mean "stuck right there". I needed a way to see how far it actually got.

### Step 5: breakpoints as checkpoints

The idea from Part 1: replace one instruction with `brk #0`. If execution reaches it, the CPU takes an exception, the firmware's handler prints a crash dump with ELR pointing at my breakpoint, and I know execution got there. If the logo just sits there, it did not.

```python
# bmbrk.py <in> <out> <VA>...: put brk #0 at virtual addresses in a PE file
import struct, sys
src, dst = sys.argv[1], sys.argv[2]
d = bytearray(open(src, 'rb').read())
pe = struct.unpack_from('<I', d, 0x3c)[0]
ns = struct.unpack_from('<H', d, pe + 6)[0]
so = pe + 24 + struct.unpack_from('<H', d, pe + 20)[0]
base = struct.unpack_from('<Q', d, pe + 24 + 24)[0]
secs = [struct.unpack_from('<8sIIII', d, so + 40 * i) for i in range(ns)]

def off(va):           # VA -> file offset, using the section table
    for name, vsize, vaddr, rsize, raw in secs:
        if base + vaddr <= va < base + vaddr + rsize:
            return raw + va - base - vaddr

for spec in sys.argv[3:]:
    va = int(spec, 16); o = off(va)
    print('brk at', hex(va), 'was', hex(struct.unpack_from('<I', d, o)[0]))
    struct.pack_into('<I', d, o, 0xD4200000)    # brk #0
open(dst, 'wb').write(d)
```

My first breakpoint, at the start of `MmArchInitialize`: no dump, just the hang. A breakpoint even earlier, at a function I *knew* had run: also no dump. Breakpoints were not producing dumps at all.

**Why:** Part 1 again. Whoever owns `VBAR_EL1` owns crash handling. Boot Manager installs its own exception vectors very early (in `ArchInitializeContext`), so my `brk` went to *Boot Manager's* handler, not the firmware's. Boot Manager's handler, with no debugger attached, just spins.

The fix for testing: in my test copy of Boot Manager, replace the instruction that writes `VBAR_EL1` with a `nop`, so the firmware's handler stays in place. I found the writes by searching the disassembly:

```bash
grep -n "msr.*VBAR_EL1" bootmgfw.s
```

There were **two**: one in `ArchInitializeContext` (`0x102a1d84`) and a second in `ArchSetExceptionState` (`0x102a1e78`), which re-installs Boot Manager's vectors every time it switches execution context. My first attempt only removed the first one, which is why my first "results" were wrong: the second write put Boot Manager's handler back. With both removed, I ran a **control test**: a breakpoint at `MmFwGetMemoryMap`, which I knew ran because it called the firmware. It printed a dump. The method worked.

> Always run a control. A test that cannot fail tells you nothing. A breakpoint at a place you know is reached proves the method before you trust any "not reached" result.
{: .prompt-tip }

Boot Manager also checks its own image when it starts, so a modified copy needs that accounted for too. These patched copies were only ever test builds on my ESP; the final setup uses the original, unmodified Boot Manager.

### Walking forward

Then it was a loop. Pick a point, plant a breakpoint, build, push to the ESP, boot, read the result:

```bash
python3 bmbrk.py bootmgfw.vbar.efi bootmgfw.brkX.efi 0x101bbee8
cp bootmgfw.brkX.efi esp/EFI/Boot/bootaa64.efi
cp bootmgfw.brkX.efi esp/EFI/Microsoft/Boot/bootmgfw.efi
./esp_sync.sh esp
# boot, look for a dump, reboot to Android
```

The firmware's dump shows ELR, and the "Loading driver at" line for `bootmgfw.efi` gives the load base for that boot, so ELR minus base gives the RVA, which should match the breakpoint.

| Checkpoint | Reached? |
|---|---|
| `MmFwGetMemoryMap` | yes |
| `MmArchInitialize` entry | yes |
| after `MmArchInitialize` returns | yes |
| firmware init, logging, security, crypto | yes |
| TPM init (call and return) | yes |
| I/O init, TCB launch init, resource init | yes |
| end of `BlInitializeLibrary` | yes |
| BCD opened (`BmpOpenStoreAndUpdateOptions`) | yes |
| boot entry selected (`BmpGetSelectedBootEntry`) | yes |
| `BlImgStartBootApplication` (WinPE RAM disk and winload loaded) | yes |
| `BlpArchTransferToEfiBootApplication` (jump to winload) | yes |

All of Boot Manager worked. The "no firmware calls after the 128-page allocation" was a red herring: it was just doing work that did not need the firmware. The hang was later.

### Into winload and the kernel

Same technique, one level deeper. `winload.efi` lives inside `boot.wim`, so each test meant replacing it in the WIM:

```bash
wimlib-imagex extract esp/sources/boot.wim 1 /Windows/System32/Boot/winload.efi --dest-dir=. --no-acls
# ... patch it ...
wimlib-imagex update esp/sources/boot.wim 1 \
    --command="add winload.brk.efi /Windows/System32/Boot/winload.efi"
```

> `wimlib-imagex update` with several `--command` options in one call silently applied none of them for me. One command per call, then extract and `sha256sum` to verify the file really changed.
{: .prompt-warning }

winload's symbols are `winload_prod.pdb` (same download method), image base `0x180000000`. It also writes `VBAR_EL1` in two places, which I `nop`ed in the test copy. The kernel's PDB is `ntkrnlmp.pdb`, image base `0x140000000`, with its own vector table setup in `KiInitializeExceptionVectorTable`. For the kernel tests, the test copy of winload also had its check of the kernel image relaxed, since the kernel was modified too.

| Checkpoint | Reached? |
|---|---|
| winload `OslMain` | yes |
| winload `OslArm64TransferToKernel` (after ExitBootServices) | yes |
| kernel entry `KiSystemStartup` | yes |
| `KiInitializeKernel` | yes |
| `InitBootProcessor` | yes |
| `MmInitSystem` call | **different result** |

Two interesting things here. First, firmware crash dumps still printed after ExitBootServices, because the firmware's vector table and framebuffer were still mapped. Second, the last test did not stop at my breakpoint. It produced a **real crash**.

### The real crash

```
Data abort, translation fault, level 3
FAR = 0x0000000000000000
ELR = 0x00000000CE952AA0
```

A NULL pointer read. And the ELR was not in the kernel. That boot's log said:

```
Loading driver at 0x000CE78A000 EntryPoint=0x000CE7C8130 bootmgfw.efi
```

So:

```
0xCE952AA0 - 0xCE78A000 = 0x1C8AA0      (RVA in bootmgfw.efi)
```

From earlier, `BlUtlGetAcpiTable` starts at RVA `0x1C88A0`. So the crash was at **`BlUtlGetAcpiTable+0x200`**, in Boot Manager's code. (Parts of Boot Manager's library stay in use while the next stages run, so an address in it showing up late is not strange.)

The disassembly at that point:

```asm
; BlUtlGetAcpiTable+0x1f0 ...
bl    BlMmMapPhysicalAddressEx     ; map an XSDT entry's physical address
...
ldr   w8, [x0]                     ; read the table's 4-byte signature  <- crash, x0 = 0
```

`BlUtlGetAcpiTable` walks the XSDT, maps each entry, and compares its signature to the one it wants. One of the XSDT's entries was **zero**. Lookups stop at the first match, so tables that came before the bad entry were found fine, and any lookup that had to walk past it crashed. That also explained why the behavior had seemed inconsistent.

To keep these dumps readable on the phone screen, I trimmed Mu_Basecore's exception handler output (no vector registers, no stack dump) to a compact summary with the faulting module and offset. Small change, big time saver.

## The cause: a GUID

Time for the last diagnostic file. `acpi.txt` walks the RSDP and XSDT and prints every entry's address, signature, length and OEM ID:

```
RSDP CFE35018 rev 2 RSDT 0 XSDT CFE35F18
XSDT len 52 entries 2
  [0] 0 NULL
  [1] CFE35B18  BGRT len 56 oem QCOM
```

Two entries. One NULL, one BGRT (the boot logo table). **No APIC, no FACP, no GTDT, no DSDT, no SSDT.** None of my ACPI tables were installed at all.

No interrupt controller description, no timers, no CPUs. Windows got remarkably far without them.

Mu-Silicium's ACPI platform driver installs tables from a firmware file found by GUID, `PcdAcpiTableStorageFile`, defined in `MdeModulePkg.dec`:

```
7E374E25-8E01-4FEE-87F2-390C23C606CD
```

Every device's `AcpiTables.inf` in Silicium-ACPI uses that as its `FILE_GUID`:

```bash
$ grep -rh FILE_GUID Silicium-ACPI/Platforms/*/*/AcpiTables.inf | sort | uniq -c
     50   FILE_GUID = 7E374E25-8E01-4FEE-87F2-390C23C606CD
      1   FILE_GUID = 9FD3388E-2945-4017-B8D0-9781BDA5D80B
```

That `1` was mine. In Part 2, when I created the file, I gave it a fresh random GUID, the same way I had for my library copy. The build was happy. UEFI was happy (it does not need ACPI). Android was happy (it does not use ACPI). The ACPI driver found no file with the expected GUID and installed nothing, and the only table in the XSDT was BGRT, which a different driver adds. The NULL entry was a side effect of an empty table list.

One line:

```ini
FILE_GUID = 7E374E25-8E01-4FEE-87F2-390C23C606CD
```

Rebuilt, booted with the original, unmodified WinPE on the ESP... and a Windows command prompt appeared on the phone.

![WinPE command prompt](/assets/img/asteroids/winpe-cmd.jpg)
_Placeholder: add the photo of the WinPE prompt._

> If a firmware component "does nothing" with no error, check how it is found. A wrong GUID, name or path fails silently almost everywhere in UEFI.
{: .prompt-danger }

Was the breakpoint hunt wasted? No. Without it I would not have known that Boot Manager, winload and the kernel were all fine, and the NULL pointer in `BlUtlGetAcpiTable` was what pointed at ACPI. But had I compared my new files against existing devices at the start (that `grep | uniq -c` takes one second), I would have saved most of a day. Do that for every file you create from a template.

## Making Windows see the storage

WinPE runs from RAM, so it booted without any storage driver. A full Windows installation needs to read its own partition. At the WinPE prompt:

```
diskpart
list disk
```

would have nothing to show: the ACPI tables I copied from Palawan (`DSDT_Minimal`) only describe the CPUs. Windows does not know a UFS controller exists.

### Windows already has a UFS driver

Windows ships a UFS storage driver, `storufs.sys`. Its INF lists the hardware it supports. I extracted it from the WinPE image to read it:

```bash
wimlib-imagex extract winre.wim 1 /Windows/INF/storufs.inf --dest-dir=. --no-acls
iconv -f utf-16 -t utf-8 storufs.inf | grep -iE "QCOM|^\["
```

```ini
[Qualcomm.NTarm64]
%ACPI\QCOM24A5.DeviceDesc%=UfsQualcomm8996Install, ACPI\QCOM24A5
```

So any ACPI device with `_HID` `QCOM24A5` gets the inbox driver. (The install section is named after the Snapdragon 820, "8996", and is still used for newer Qualcomm UFS controllers.) Other Silicium devices' DSDTs use the same ID.

### Writing the ACPI device

The controller's details come from the DT:

```bash
python3 fdtq.py Resources/DTBs/asteroids.dtb ufshc
```

```
/soc/ufshc@1d84000 compatible qcom,ufshc
/soc/ufshc@1d84000 reg ['0x1d84000', '0x3000', '0x1d88000', '0x18000']
/soc/ufshc@1d84000 reg-names ufs_mem ice
/soc/ufshc@1d84000 interrupts ['0x0', '0x109', '0x4']
/soc/ufshc@1d84000 dma-coherent []
```

(`fdtq.py` is the same FDT walker as `memnode.py`, printing properties of nodes whose name contains a string.)

- Registers at `0x1D84000`. For the size I used `0x15000`, the same value the Waipio and Nothing Phone (2) DSDTs use for their UFS0 at this address; it covers the UFS register block.
- Interrupt: SPI `0x109` → GSIV `0x109 + 32 = 0x129` (Part 1).
- `dma-coherent` → `_CCA` = 1.

I checked the Snapdragon 8 Gen 1 (Waipio) DSDT in Silicium-ACPI: its UFS0 device has the same address and interrupt, which was reassuring.

I created `Silicium-ACPI/Silicon/Qualcomm/Milos/DSDT_Minimal.asl`: Palawan's minimal DSDT (eight CPU devices) plus:

```
Device (UFS0)
{
    Name (_HID, "QCOM24A5")
    Name (_UID, 0)
    Name (_CCA, 1)

    Name (_CRS, ResourceTemplate ()
    {
        Memory32Fixed (ReadWrite, 0x01D84000, 0x00015000)

        Interrupt (ResourceConsumer, Level, ActiveHigh, Exclusive, ,, ) { 0x129 }
    })

    Method (_STA, 0, NotSerialized) { Return (0x0F) }

    Device (DEV0)
    {
        Name (_ADR, 8)
        Name (_RMV, 0)
    }
}
```

`DEV0` is the storage device on the controller, marked not removable (Windows treats removable disks differently, and will not install onto them).

### Compiling it

I did not have `iasl` installed, and no sudo on this machine. Project Mu publishes it as a NuGet package (`edk2-acpica-iasl`), which is just a zip:

```bash
mkdir -p ~/woa/iasl && cd ~/woa/iasl
curl -sSL -o p.nupkg "https://pkgs.dev.azure.com/projectmu/acpica/_packaging/mu_iasl/nuget/v3/flat2/edk2-acpica-iasl/20230628.0.1/edk2-acpica-iasl.20230628.0.1.nupkg"
unzip -oq p.nupkg
chmod +x edk2-acpica-iasl/Linux-x86/iasl

cd Silicium-ACPI/Silicon/Qualcomm/Milos
~/woa/iasl/edk2-acpica-iasl/Linux-x86/iasl DSDT_Minimal.asl
# Compilation successful. 0 Errors, 0 Warnings
```

Point the device's INF at it:

```ini
[Binaries]
  ASL|Common/SSDT.aml
  ASL|Palawan/APIC.aml
  ASL|Milos/DSDT_Minimal.aml
  ASL|Palawan/FACP.aml
  ASL|Palawan/GTDT.aml
```

Rebuilt, booted WinPE, `diskpart`, `list disk`: a **234 GB disk**. That is UFS LUN 0, the one with `userdata`, `esp` and `win`.

Windows could see the phone's storage with its own inbox driver, with no Qualcomm driver package at all. As far as I can tell this works because the controller is already initialized and the device started when Mu-Silicium hands over (that START UNIT patch from Part 3 again).

## Installing Windows

The usual way to install Windows on these phones is: boot UEFI in mass storage mode, plug into a Windows PC, and run `dism` and `bcdboot` there. I had no Windows PC and a laptop that blocks USB disks. So I built the Windows partition **on Linux** and wrote it to the phone with fastboot.

### Applying the image on Linux

`wimlib` can apply a Windows image directly onto an NTFS filesystem using the NTFS-3G library. In that mode it keeps everything Windows needs: security descriptors (ACLs), reparse points, hard links, short names. (Applying to a mounted directory does not, and the result will not boot.)

The `win` partition is sectors 19751936 to 61390842, so 41,638,907 sectors of 4096 bytes. Create a sparse file of exactly that size, format it, apply:

```bash
mkdir -p ~/woa/install && cd ~/woa/install
truncate -s $((41638907 * 4096)) win.raw
mkntfs -F -Q -s 4096 -p 19751936 -L Windows win.raw
wimlib-imagex apply ~/Downloads/26200*.esd 1 win.raw
```

- `-F`: it is a file, not a device; `-Q`: quick format.
- `-s 4096`: the disk's sector size.
- `-p 19751936`: the partition's start sector, stored in the NTFS boot sector. mkntfs warns "Windows will not be able to boot from this device" because the CHS geometry fields are empty; that only matters for BIOS booting from the partition itself, not for UEFI.
- The file is 158.8 GiB on paper but only takes the space of the data written to it (about 18 GB), because it is sparse.

Applying index 1 extracted 16 GiB of files, 215,766 of them.

### Converting to a fastboot sparse image

`fastboot flash` can write "Android sparse" images, which only carry the non-empty blocks. Convert:

```bash
img2simg win.raw win.simg 4096
```

(The block size is a positional argument. `img2simg -b 4096` is not a thing, I tried.) The result is about 18 GB.

### Flashing

```bash
adb reboot bootloader
fastboot getvar partition-size:win
fastboot flash win win.simg
```

`fastboot` splits the image into chunks the bootloader can accept (`max-download-size` was 768 MB on my phone) and writes them one by one. 18 GB over USB takes a while. Watch the output; it prints each chunk.

> `fastboot flash` only writes the one partition you name. It does not touch `userdata`, `boot` or anything else. Still, double check the partition name before pressing enter.
{: .prompt-warning }

### Boot files

The installed Windows needs its own Boot Manager and BCD on the ESP, pointing at the `win` partition. That is what `bcdboot` does, and WinPE has it. Boot Mu-Silicium with WinPE still on the ESP, and at the prompt:

```
diskpart
list vol
exit
```

Find the letter of the 158 GB NTFS volume labeled "Windows" (say `C:`), then:

```
bcdboot C:\Windows /f UEFI
bcdedit /set {default} recoveryenabled no
bcdedit /set {default} bootstatuspolicy IgnoreAllFailures
bcdedit /set {default} testsigning on
```

- `bcdboot` copies Boot Manager to the ESP and writes a new BCD with an entry for `C:\Windows`. It finds the ESP by its `EF00` type.
- `recoveryenabled no` and `bootstatuspolicy IgnoreAllFailures`: if a boot fails, do not jump into automatic repair. On a device like this, automatic repair cannot fix anything and only hides the real error.
- `testsigning on`: needed later, for community drivers (touch, USB host) that are not signed by Microsoft.

This replaces the WinPE boot files on the ESP. I keep the WinPE tree on my PC, so putting it back is one `esp_sync.sh` away.

## Where things stand

As I write this:

| | |
|---|---|
| Mu-Silicium UEFI | boots, display, storage, buttons, USB, mass storage |
| Windows PE | boots to a command prompt |
| Internal storage in Windows | visible through the inbox UFS driver |
| Full Windows | image built and being written to the `win` partition; `bcdboot` and first boot to setup are next |

What is left, roughly in order:

1. **Finish the install** and boot to Windows setup (OOBE). Without touch or a keyboard, I will not get far into it, but reaching it proves the full boot path.
2. **Resize the GPT to 128 entries** before Windows touches the disk for real.
3. **USB host mode** in ACPI (an XHCI controller device, like topaz-woa does), so a USB keyboard and mouse work through a USB-C hub.
4. **Proper ACPI tables for Milos**: right now APIC, FACP and GTDT are Palawan's, and only CPUs and UFS are described.
5. **Clean up**: the diagnostic module and the compact exception handler come out, the FAT fix goes in properly, and the memory map and ACPI fixes are committed (the GUID fix and the memory map reservations already are).

I will update this post when Windows reaches setup.

## Lessons from this part

- **Copy-and-modify is how ports start, and also where they go wrong.** Diff every new file against two or three existing devices. My one-day bug was a single line that a `grep | uniq -c` would have caught.
- **The memory map is a security boundary.** On a hypervisor-based phone, memory you do not own faults. Compare your map against DT `/memory` and `/reserved-memory`, including above 4 GiB.
- **Silence is information.** "No firmware calls after X" and "no crash dump" both meant something different from what they first suggested. Prove your observation method with a control before trusting a negative result.
- **Get diagnostics off the screen.** Text files on the ESP, read from Android, were faster and more accurate than photos of a log.
- **Symbols are free.** Microsoft's symbol server turns Windows binaries from a wall of hex into named functions. `BlUtlGetAcpiTable+0x200` told me more than an hour of guessing.
- **Bisect everything.** Drivers, boot stages, kernel init: pick a midpoint, test, halve.

## Credits

This would have taken much longer without the work of others:

- [Project Silicium](https://github.com/Project-Silicium) for Mu-Silicium, Silicium-ACPI and the WoA-Guides.
- The patch authors credited in `Binaries/asteroids/README.md`: Gustave Monce, Robotix, Kancy Joe, Shandorman and N1kroks.
- [topaz-woa](https://github.com/MakrSas/topaz-woa) for the FAT and memory map work and USB host notes.
- [woa-pong](https://github.com/Govro150/woa-pong) (Nothing Phone (2)), the [Renegade Project](https://renegade-project.tech/), [Port-Windows-11-Xiaomi-Pad-5](https://github.com/erdilS/Port-Windows-11-Xiaomi-Pad-5), [mu_aloha_platforms](https://github.com/Project-Aloha/mu_aloha_platforms) and [edk2-gunyah](https://github.com/Droid-VM/edk2-gunyah) for references along the way.
- Microsoft, for Project Mu and for public symbols.
