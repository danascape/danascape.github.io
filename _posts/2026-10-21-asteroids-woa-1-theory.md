---
layout: post
title: "Windows on the Nothing Phone (3a) - Part 1: The Theory"
date: 2026-10-21 00:00:01 +0530
categories: [Windows on ARM]
tags: [UEFI, Windows, Qualcomm, Mu-Silicium, ARM64, ACPI]
description: "Before you boot Windows on a phone, you need to know what booting even is."
author: danascape
series: "Windows on the Nothing Phone (3a)"
toc: true
---

## Why this series exists

I spent a full day getting [Mu-Silicium](https://github.com/Project-Silicium/Mu-Silicium) (a UEFI firmware for Snapdragon phones) running on my Nothing Phone (3a), and then getting Windows to boot on top of it. When I started, I went looking for a guide that explained the whole thing end to end. I did not find one. What exists is scattered: a porting page here, a Telegram message there, a repo with patches and no explanation of why they exist.

So this is the guide I wanted. It is split into four parts:

1. **The theory** (this post). Everything you need to understand *before* touching a single file. Boot chains, ARM64, UEFI, ACPI, how Windows boots, and enough assembly to read a crash dump.
2. **Setting up the UEFI project.** Tooling, backing up the phone, extracting what we need from the stock firmware, and creating the SoC and device packages.
3. **Going green.** Fixing every driver until display, storage, buttons, USB and mass storage work in UEFI.
4. **Booting Windows.** Partitioning, WinPE, a long hunt for a hang, and a full install.

The goal is that someone who has never opened a UEFI source tree or looked at Windows internals can read all four and do it themselves. That means this part is long. You can skip sections you already know, but do not skip it entirely. Every problem I hit later was obvious *in hindsight* once I understood one of the concepts below.

### The device

| | |
|---|---|
| Phone | Nothing Phone (3a), codename `asteroids`, model A059 |
| SoC | Qualcomm SM7635, Snapdragon 7s Gen 3 |
| Qualcomm's internal name | **Milos** |
| RAM | 8 GB |
| CPU | 8 cores in 3 clusters (4 + 3 + 1) |
| Display | 1080 x 2392 |
| Software | Android 17, bootloader unlocked, `adb root` works |

Where things stand at the end of the series: Mu-Silicium boots with display, internal storage, buttons, USB and mass storage working; Windows PE boots to a command prompt and sees the internal storage; and a full Windows 11 install is on the phone.

## What does "booting" even mean?

When you press the power button, the CPU starts executing instructions from a fixed address. It has no idea what an operating system is. Some small piece of code has to set up the hardware enough to load a bigger piece of code, which sets up more hardware and loads an even bigger piece of code, and so on until something big enough (Linux, Windows) is running. That handoff sequence is the **boot chain**.

Every link in the chain has two jobs:

1. Initialize *something* (DRAM, clocks, storage, display).
2. Find, load, and jump to the next link.

The interesting part is what each link tells the next one about the hardware. That turns out to be the whole reason Windows does not "just work" on a phone.

### How a PC boots

On a normal Windows laptop:

```
power on
  -> UEFI firmware (stored in a SPI flash chip on the motherboard)
       initializes CPU, RAM, PCIe, USB, storage, display
       builds ACPI tables that describe the hardware
       reads the EFI System Partition (ESP) on the disk
  -> \EFI\Microsoft\Boot\bootmgfw.efi   (Windows Boot Manager)
  -> \Windows\System32\winload.efi      (Windows OS Loader)
  -> ntoskrnl.exe + hal + boot drivers  (Windows kernel)
```

Two things matter here:

- **UEFI** is a standard interface between firmware and the OS loader. Windows Boot Manager does not care who made your motherboard. It calls standard UEFI functions like "read blocks from this disk" or "give me the memory map".
- **ACPI** is a standard way for firmware to describe hardware to the OS. Windows does not probe for devices on ARM. It reads ACPI tables that say "there is a storage controller at this address, with this interrupt, and its hardware ID is X". Windows then loads the driver that matches X.

Windows *requires* both. No UEFI, no Boot Manager. No ACPI, no devices.

### How an Android phone boots

A Qualcomm phone boots very differently:

```
power on
  -> PBL     (Primary Boot Loader, burned into the SoC ROM, cannot be changed)
  -> XBL     (eXtensible Boot Loader, initializes DDR, loads the rest)
       XBL_CONFIG: configuration data, including device trees
       XBLCore: Qualcomm's own UEFI implementation
  -> ABL     (Android Boot Loader, also called LinuxLoader, a UEFI application)
       this is where fastboot lives
  -> Linux kernel from boot.img, with a device tree
  -> Android
```

Surprise: the phone *already runs UEFI*. Qualcomm's XBL contains a full UEFI implementation, built from the same EDK2 code base that PC firmware uses. ABL is literally a UEFI application.

So why can't we just put Windows Boot Manager on the phone and let Qualcomm's UEFI start it?

- Qualcomm's UEFI on phones is configured to boot ABL and nothing else. There is no boot menu, no ESP scanning, no way to choose another loader.
- It does not provide the ACPI tables Windows needs. Android does not use ACPI; it uses a **device tree**.
- It does not leave hardware in a state Windows can use (it turns off USB, puts storage to sleep, and so on, before handing over to Linux).

Qualcomm *does* ship Windows laptops on Snapdragon chips, and on those the same UEFI is built with a different configuration: ACPI, Windows-ready drivers, and so on. Phones just do not get that build.

That is the gap Mu-Silicium fills. It is a UEFI firmware we build ourselves, which ABL loads *as if it were a Linux kernel*, and which then behaves like PC firmware: it scans the ESP, provides ACPI tables, and hands over to Windows Boot Manager.

### Device tree vs ACPI, the short version

Both answer the same question: "what hardware exists, and where?"

A **device tree** (DT) is a data structure. Here is the UFS storage controller on my phone, from the DT that Android boots with:

```
ufshc@1d84000 {
    compatible = "qcom,ufshc";
    reg = <0x1d84000 0x3000>, <0x1d88000 0x18000>;
    reg-names = "ufs_mem", "ice";
    interrupts = <0 0x109 4>;
    dma-coherent;
};
```

The Linux driver that says `compatible = "qcom,ufshc"` gets matched to this node, reads `reg` to find the registers, and `interrupts` to find its interrupt.

**ACPI** describes the same controller, but in a small bytecode language (AML) that Windows executes:

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
}
```

The Windows driver whose INF file lists `ACPI\QCOM24A5` gets loaded for this device. Same information, different language. You will see this exact pair again in Part 4, because writing that ACPI device is what made Windows see the phone's storage.

The interrupt numbers are not the same, and that is not a typo. I explain why in the ACPI section below.

## ARM64 for people who have never written assembly

You will be reading disassembly and crash dumps. You do not need to *write* assembly fluently. You need to recognize maybe fifteen instructions and understand what the CPU does when something goes wrong.

### Exception levels: who runs where

ARM64 (AArch64) CPUs have four privilege levels, called **exception levels**:

| Level | Who runs here on a Qualcomm phone |
|---|---|
| EL0 | Apps (user space) |
| EL1 | OS kernel (Linux, Windows). **Our UEFI runs here too.** |
| EL2 | Hypervisor. On recent Snapdragons: Qualcomm **Gunyah** |
| EL3 | Secure monitor (part of TrustZone firmware) |

Higher number, more privilege. Code at EL1 cannot touch EL2 or EL3 state. It can ask them for things with special instructions:

- `svc` asks EL1 (system call from an app)
- `hvc` asks EL2 (hypervisor call)
- `smc` asks EL3 (secure monitor call, used for things like PSCI CPU power control and TrustZone apps)

There is also a parallel "secure world" where Qualcomm's trusted OS (QTEE) runs. You can mostly ignore it, except to know that some memory belongs to it and you must not touch that memory.

### Why the hypervisor matters

On older Snapdragons, the bootloader handed the kernel EL2. On recent ones, Qualcomm's Gunyah hypervisor *keeps* EL2 and runs Android (and us) at EL1, inside what is effectively a virtual machine.

Gunyah uses **stage-2 translation**: every physical address our code uses goes through a second set of page tables owned by the hypervisor. If our code touches memory that Gunyah did not give us, the access does not just return garbage. It faults. On my phone that showed up as:

```
Synchronous external abort ... FAR 0x80000000
```

`0x80000000` is the start of DRAM, and on this phone the first chunk of it belongs to Gunyah. Our UEFI handed that memory out to Windows Boot Manager as if it were free, and the first read blew up. Part 4 covers this in detail. The lesson for now: **a phone's RAM is not all yours**. Large pieces belong to the hypervisor, TrustZone, the modem, and the DSPs. Your firmware's memory map must mark them as reserved.

### Registers

AArch64 has 31 general-purpose 64-bit registers, `x0` to `x30`. Each one also has a 32-bit view: `w0` is the low 32 bits of `x0`.

- `x0`-`x7`: function arguments. `x0` is also the **return value**.
- `x29`: frame pointer.
- `x30`: **link register (LR)**. Holds the return address when you call a function.
- `sp`: stack pointer.
- `xzr` / `wzr`: a register that always reads as zero.
- `pc`: the program counter (address of the current instruction). You cannot write to it directly.

UEFI functions return an `EFI_STATUS` in `x0`. Zero means `EFI_SUCCESS`. That single fact is behind half the binary patches in this series: "make this function return success" is `mov w0, #0` followed by `ret`.

### The instructions you need to recognize

```asm
mov   w0, #0            // w0 = 0
mov   w0, wzr           // w0 = 0 (same effect, different encoding)
ldr   w8, [x0]          // w8 = 32-bit value read from memory at address x0
str   w8, [x1, #0x10]   // write w8 to memory at x1 + 0x10
add   x0, x1, #0x20     // x0 = x1 + 0x20
adrp  x0, 0x12000       // x0 = address of a 4 KiB page, relative to pc
bl    0x19184           // call the function at 0x19184 (sets x30 = return address)
b     0x3c80            // jump to 0x3c80 (no return)
cbz   w0, 0x5640        // if w0 == 0, jump to 0x5640
cbnz  w0, 0x5640        // if w0 != 0, jump to 0x5640
b.eq  0x493c            // jump if the last comparison was "equal"
cmp   w0, #3            // compare w0 with 3, sets flags for b.eq / b.ne
ret                     // return to the address in x30
nop                     // do nothing
brk   #0                // breakpoint: raise an exception on purpose
mrs   x0, CNTFRQ_EL0    // read a system register into x0
msr   VBAR_EL1, x8      // write x8 into a system register
```

That is genuinely most of what you will see in the driver code we patch.

### Instructions are just 4-byte numbers

Every AArch64 instruction is exactly 4 bytes, stored **little-endian** (least significant byte first). That makes binary patching simple: find the 4 bytes, replace them with 4 other bytes.

The encodings I used over and over:

| Instruction | 32-bit value | Bytes in the file |
|---|---|---|
| `mov w0, #0` | `0x52800000` | `00 00 80 52` |
| `mov w0, wzr` | `0x2A1F03E0` | `E0 03 1F 2A` |
| `ret` | `0xD65F03C0` | `C0 03 5F D6` |
| `nop` | `0xD503201F` | `1F 20 03 D5` |
| `brk #0` | `0xD4200000` | `00 00 20 D4` |

You do not need to memorize these. `llvm-mc` will assemble any instruction for you:

```bash
echo 'mov w0, #0' | llvm-mc -triple=aarch64 -show-encoding
#   mov w0, #0      // encoding: [0x00,0x00,0x80,0x52]
```

Branches are relative. A `bl` stores the distance to the target, divided by 4, in its low 26 bits:

```
bl encoding = 0x94000000 | (((target - pc) >> 2) & 0x3FFFFFF)
```

Example: a `bl` at offset `0x13128` that calls `0x19184`:

```
0x19184 - 0x13128 = 0x605C
0x605C >> 2       = 0x1817
0x94000000 | 0x1817 = 0x94001817
```

So in the file you would see `17 18 00 94`. If you replace that with `E0 03 1F 2A` (`mov w0, wzr`), the call never happens and the code continues as if the function returned 0. That is exactly how one of the hangs in Part 3 got fixed.

### Exceptions, vectors, and reading a crash dump

When something goes wrong (reading an unmapped address, executing an invalid instruction, hitting a `brk`), the CPU takes an **exception**. It:

1. saves the current `pc` in `ELR_EL1` (Exception Link Register),
2. records *why* in `ESR_EL1` (Exception Syndrome Register),
3. records the faulting memory address (for memory faults) in `FAR_EL1` (Fault Address Register),
4. jumps to an address computed from `VBAR_EL1` (Vector Base Address Register).

`VBAR_EL1` points to a table of exception handlers, the **vector table**. Whoever owns `VBAR_EL1` decides what happens on a crash. In UEFI, the firmware installs a handler that prints a register dump to the screen. Once Windows Boot Manager starts, it installs its *own* vector table, and from then on firmware crash dumps stop appearing. This fact became extremely important in Part 4.

A crash dump in Mu-Silicium looks roughly like this (shortened):

```
Synchronous Exception at 0x00000000CE952AA0
ELR 0x00000000CE952AA0  ESR 0x96000007  FAR 0x0000000000000000
```

How to read it:

- **ELR** is the instruction that faulted.
- **FAR** is the address it tried to access. `0` means it dereferenced a NULL pointer.
- **ESR** tells you the kind of exception. The top 6 bits (bits 31:26) are the **exception class (EC)**:
  - `0x25` = data abort (bad memory access) taken at the same level
  - `0x21` = instruction abort (tried to execute from a bad address)
  - `0x3C` = `brk` instruction
  - `0x15` = `svc`, `0x16` = `hvc`, `0x17` = `smc`
- For data aborts, the low 6 bits (the **DFSC**) say what kind of fault: `0x04`-`0x07` are **translation faults** at level 0-3 (the address is not mapped at all), `0x10` is a synchronous external abort (the address is mapped but something outside the CPU, like the hypervisor, refused the access).

So `ESR 0x96000007`: `0x96000007 >> 26 = 0x25`, a data abort, and `0x07` is a level 3 translation fault. Combined with `FAR 0`, that is "something read through a NULL pointer". That one crash is the end of a detective story in Part 4.

### Turning ELR into a function name

An address like `0xCE952AA0` means nothing on its own. You need to know which image was loaded where. UEFI firmware prints a line every time it loads something:

```
Loading driver at 0x000CE78A000 EntryPoint=0x000CE7C8130 bootmgfw.efi
```

So bootmgfw.efi was loaded at `0xCE78A000`. The crash at `0xCE952AA0` is at offset `0xCE952AA0 - 0xCE78A000 = 0x1C8AA0` inside it. That offset is an **RVA** (relative virtual address), and with the right tools (next section) it turns into a function name.

> Load addresses change between boots. I wasted time once by reusing an old base address. Always read the "Loading driver at" line from the same boot as the crash.
{: .prompt-warning }

## Executable files: PE, RVA, VA and file offsets

UEFI drivers, Windows Boot Manager, winload and the Windows kernel are all **PE/COFF** files, the same format as a Windows `.exe`. You need to understand three kinds of address, because you will convert between them constantly.

A PE file contains headers and a list of **sections** (`.text` for code, `.data`, `.rdata`, and so on). Each section has:

- a **virtual address** (where it goes in memory, relative to the image start)
- a **raw pointer** (where it is stored in the file)
- sizes for both

The headers also have an **ImageBase**, the address the image prefers to be loaded at.

| Term | Meaning |
|---|---|
| **VA** (virtual address) | ImageBase + RVA. What disassemblers show if they assume the preferred load address |
| **RVA** (relative virtual address) | Offset from the start of the loaded image |
| **File offset** | Where the bytes actually are in the `.efi` / `.exe` file on disk |

The conversion from VA to file offset:

```
file_offset = section.raw_pointer + (VA - ImageBase - section.virtual_address)
```

where `section` is the one whose `[virtual_address, virtual_address + size)` contains `VA - ImageBase`.

For small UEFI drivers built by Qualcomm, sections often have equal virtual and raw offsets, so RVA equals file offset and you can patch at the address the disassembler prints. For big Microsoft binaries that is not true, and if you patch at the wrong offset you corrupt unrelated code. I wrote a ten-line Python helper for this in Part 4; the formula above is all it does.

UEFI also uses a stripped-down variant called **TE** (Terse Executable). Firmware tools extract them as `.te` files. Same idea, smaller header.

### Symbols: getting function names for Microsoft binaries

Microsoft publishes debug symbols (PDB files) for Windows binaries on a public symbol server. Every PE file contains a "debug directory" entry with a GUID and age that identifies its exact PDB. You can download it from:

```
https://msdl.microsoft.com/download/symbols/<pdb name>/<GUID><age>/<pdb name>
```

For example, the Boot Manager I used had `bootmgfw.pdb/C6B0B2AA4429A57378F7820C96619A772`. With the PDB, `llvm-pdbutil dump -publics` gives you every public function name and its location. That turned a raw offset like `0x1C8AA0` into `BlUtlGetAcpiTable+0x200`, which immediately told me what was going on. Part 4 shows the exact commands.

## The Qualcomm boot chain in more detail

### Partitions

Phone storage is UFS (Universal Flash Storage). It is split into several **LUNs** (logical units), each of which looks like a separate disk to Linux: `/dev/block/sda`, `sdb`, ... `sdf`. Each has its own GPT partition table. The big one, `sda`, holds `userdata` (your Android data). Firmware partitions live on the others.

The ones relevant to us:

| Partition | Contents |
|---|---|
| `xbl_a/b` | XBL, the first loader after the ROM |
| `xbl_config_a/b` | XBL configuration, including embedded device trees with the UEFI memory map |
| `uefi_a/b` | Qualcomm's UEFI firmware volume: all the DXE drivers we will reuse |
| `abl_a/b` | ABL / fastboot |
| `boot_a/b` | Android boot image (kernel). We never flash this |
| `userdata` | Android data. We shrink it to make room for Windows |

Android uses symbolic links so you do not have to know which `sdX` a partition is on:

```bash
ls -l /dev/block/by-name/
```

Always use these names. On my phone, the letter of the main LUN changed between boots once (it showed up as `sdc`), and a script using `/dev/block/sda14` would have written to the wrong place.

### A/B slots

Most partitions exist twice, `_a` and `_b`. The phone boots from one **slot** and updates the other, so a bad update can fall back. Check the active slot with:

```bash
adb shell getprop ro.boot.slot_suffix      # _b on my phone
fastboot getvar current-slot
```

Extract firmware from the **active** slot. The inactive slot may have a different firmware version.

### fastboot boot vs fastboot flash

```bash
fastboot boot image.img      # load into RAM and boot once, nothing written
fastboot flash boot image.img  # write it to the boot partition, permanent
```

Mu-Silicium is always tested with `fastboot boot`. It replaces nothing. Hold the power button to reboot and the phone boots Android as normal. This is what makes the whole project safe to experiment with: you can try fifty broken firmware builds in an afternoon and the phone is fine.

> One time a failed `fastboot boot` made ABL mark my active slot as unbootable, and the phone kept coming back to fastboot instead of Android. `fastboot set_active b` (your active slot) clears that flag.
{: .prompt-tip }

### What the unlocked bootloader gives us

With a locked bootloader, ABL refuses to boot images that are not signed by the vendor. Unlocking lets ABL boot any boot image you hand it with `fastboot boot`. It does **not** let you replace XBL or Qualcomm's UEFI (those are verified by the ROM with keys burned into the chip). That is fine; we do not need to. We run our firmware *after* ABL, as its "kernel".

## UEFI from zero

UEFI is a specification. EDK2 (from TianoCore) is the open source reference implementation. Almost every UEFI firmware in existence, including Qualcomm's, is built from EDK2.

### Phases

UEFI firmware runs in phases:

```
SEC  -> PEI  -> DXE  -> BDS  -> (OS loader runs) -> RT
```

| Phase | What happens |
|---|---|
| **SEC** (Security) | First code. Sets up a stack, finds the next phase |
| **PEI** (Pre-EFI Initialization) | Minimal hardware init. Builds "HOBs" (hand-off blocks) describing memory |
| **DXE** (Driver Execution Environment) | The big phase. Loads dozens of drivers that initialize everything |
| **BDS** (Boot Device Selection) | Decides what to boot. Scans disks, runs the boot loader |
| **TSL** (Transient System Load) | The OS loader (Windows Boot Manager) is running and still using firmware services |
| **RT** (Runtime) | After the OS takes over. Only a few "runtime services" remain (clock, variables, reset) |

On our phone, Mu-Silicium does SEC and a simplified PEI itself (DRAM is already initialized by XBL, so there is little to do), then runs DXE with a mix of open source drivers and Qualcomm's closed-source drivers, then BDS boots Windows Boot Manager from the ESP.

### Drivers, protocols, handles

DXE is a bunch of independent **drivers**. They talk to each other through **protocols**.

A protocol is a struct of function pointers, identified by a **GUID** (a 128-bit ID like `964E5B21-6459-11D2-8E39-00A0C969723B`). A driver *installs* a protocol on a **handle** (an opaque object). Another driver *locates* that protocol by GUID and calls its functions.

For example, the UFS driver installs `EFI_BLOCK_IO_PROTOCOL` on a handle for each LUN. The partition driver finds every Block IO handle, reads the GPT, and installs a new Block IO handle per partition. The FAT driver finds partitions with a FAT filesystem and installs `EFI_SIMPLE_FILE_SYSTEM_PROTOCOL`. BDS then looks for a file system containing `\EFI\Boot\bootaa64.efi`.

This layering is why a broken driver deep in the stack (say, the PMIC driver hanging forever) prevents everything above it from running. The DEBUG build prints `Loading driver at ... XYZ.efi` for each driver. The last line on the screen when it hangs tells you which driver is stuck.

### Driver load order and APRIORI

DXE drivers declare dependencies (`[Depex]`): "I need protocols X and Y before I can start." The DXE dispatcher runs drivers whose dependencies are satisfied. Some drivers must run first no matter what; those are listed in an **APRIORI** list in the firmware image. Qualcomm's drivers rely heavily on a fixed APRIORI order.

### Boot Services, Runtime Services, ExitBootServices

The firmware provides two tables of functions:

- **Boot Services**: memory allocation (`AllocatePages`, `GetMemoryMap`), loading images (`LoadImage`, `StartImage`), protocols, events, timers.
- **Runtime Services**: get/set time, UEFI variables, reset the system.

When the OS loader is ready to take over the machine, it calls **`ExitBootServices()`**. After that:

- Boot Services are gone. Calling one is a bug.
- The firmware's drivers get a final callback to shut their hardware down cleanly.
- The OS owns all memory except what is marked Runtime or Reserved.

That "shut down cleanly" step matters a lot on phones. Qualcomm's USB driver, for example, turns the USB controller off at ExitBootServices because Linux will re-initialize it. Windows expects the firmware to leave some hardware usable. Several binary patches in Part 3 exist only to stop drivers from turning things off.

### The memory map

The firmware keeps a map of all memory: every range, its type, and its attributes. Windows Boot Manager reads it with `GetMemoryMap()` and decides where to put itself, the kernel, and everything else.

Memory types you will see:

| Type | Meaning |
|---|---|
| `EfiConventionalMemory` | Free RAM, anyone can use it |
| `EfiLoaderCode` / `EfiLoaderData` | Used by the OS loader |
| `EfiBootServicesCode/Data` | Used by firmware, becomes free after ExitBootServices |
| `EfiRuntimeServicesCode/Data` | Used by firmware forever, the OS must not touch it |
| `EfiReservedMemoryType` | Do not touch, ever |
| `EfiMemoryMappedIO` | Device registers, not RAM |

On a PC, the firmware *discovers* the memory map. On our phone, we *write it by hand* in a C file, because the phone has many ranges of RAM owned by other things (hypervisor, modem, TrustZone) and the firmware has no way to know that by itself. Getting this table wrong was the first Windows crash in Part 4.

### Firmware volumes, FD, FFS

The firmware is built into a **Flash Device image (FD)**: one binary blob, loaded at a fixed address. Inside are **Firmware Volumes (FV)**, which are like tiny filesystems. Each file in a volume is an **FFS file** identified by a GUID, and contains **sections**:

| Section | Contents |
|---|---|
| `PE32` / `TE` | Executable code |
| `UI` | Human-readable name (`PmicDxe`) |
| `DXE_DEPEX` | Dependency expression |
| `RAW` | Arbitrary data (config files, ACPI tables, logos) |

Qualcomm's `uefi_b` partition is exactly this: a firmware volume full of DXE drivers. A tool called `uefi-firmware-parser` can unpack it into a directory tree, one folder per file GUID, with the UI name in a separate file. That is how we get Qualcomm's drivers in Part 2.

> File GUIDs are how firmware code finds data. The ACPI tables, for example, are stored as a RAW file with a specific GUID, and the ACPI driver looks for exactly that GUID. If you give the file a different GUID, nothing complains at build time. The driver just never finds your tables. I did exactly this, and it cost me most of a day. Remember it.
{: .prompt-danger }

### The ESP and the default boot path

The **EFI System Partition** is a FAT32 partition with a GPT type code of `EF00`. UEFI firmware can read FAT32 natively. When there is no boot entry configured, firmware tries the **removable media fallback path**:

```
\EFI\Boot\bootaa64.efi        (ARM64)
\EFI\Boot\bootx64.efi         (x86-64)
```

Windows also installs itself at `\EFI\Microsoft\Boot\bootmgfw.efi`, and puts a copy at the fallback path. Mu-Silicium's BDS scans for these, so putting Windows Boot Manager on the ESP is enough to boot it.

## EDK2 and Project Mu: how the source is organized

EDK2 has its own build system with its own file types. You will edit all of these:

| File | Purpose |
|---|---|
| `.dec` (declaration) | Declares a **package**: its GUIDs, PCDs, library classes, include paths |
| `.dsc` (description) | Describes a **platform build**: which modules to build, which library implementation to use for each library class, PCD values |
| `.fdf` (flash description) | Describes the **firmware image**: which modules go into which firmware volume, in what order, APRIORI lists |
| `.inf` (information) | Describes one **module** (driver, library, application, or a prebuilt binary): sources, dependencies, `FILE_GUID` |

A few more concepts:

- **Package**: a directory with a `.dec`, like `MdeModulePkg` or `ArmPkg`. Platforms in Mu-Silicium are packages too (`asteroidsPkg`).
- **Library class**: an interface (like `MemoryMapLib`). The `.dsc` picks which implementation (which `.inf`) to link. This is how a device provides its own memory map without changing shared code: it implements `MemoryMapLib` and the `.dsc` points to it.
- **PCD** (Platform Configuration Database): named configuration values. `gArmTokenSpaceGuid.PcdGicDistributorBase|0x17100000` sets the GIC base for the build. Some are fixed at build time, some can change at runtime.
- **FILE_GUID**: each module's identity inside the firmware image. For prebuilt binaries it must match what other code expects.

**Project Mu** is Microsoft's fork of EDK2, the one Surface devices use. It adds a Python-based build wrapper ("stuart"), split repositories, and a lot of quality-of-life features. Mu-Silicium is built on Project Mu.

## Mu-Silicium: how it works on a phone

Mu-Silicium is a Project Mu platform for Snapdragon phones. The trick that makes it work:

1. We build a UEFI FD image.
2. The build script wraps it in an **Android boot image**, the same format as a Linux kernel `boot.img`, with a small "boot shim" in front so it looks like an ARM64 Linux kernel. The phone's device tree is appended, the same way a real kernel image carries one.
3. ABL loads it like any kernel, and jumps to it.
4. Our UEFI starts from SEC, sets up its own memory map, and runs DXE **from scratch**: its own core, plus Qualcomm's driver binaries extracted from the phone.
5. BDS boots Windows Boot Manager from the ESP.

Why reuse Qualcomm's drivers? Because the hardware documentation for clocks, power management (PMIC), UFS, display and USB on these SoCs is not public. Writing those drivers from scratch would be a multi-year project per SoC. Qualcomm's binaries already know how to drive the hardware. They just have assumptions baked in (about which bootloader started them, what state the hardware is in, what runs after them) that we fix with small binary patches.

### Repository layout

```
Mu-Silicium/
  build_uefi.py                 the build entry point
  Status.md                     what works on each device
  Platforms/<Vendor>/<device>Pkg/    one package per phone
      <device>.dsc / .fdf / .dec
      DeviceBuild.py
      Include/APRIORI.inc, DXE.inc, RAW.inc   driver lists for the FDF
      Library/MemoryMapLib/       the hand-written memory map
      Library/ConfigurationMapLib/ Qualcomm config values
  Silicon/Qualcomm/<SoC>Pkg/        one package per SoC (shared by phones)
  Silicon/Qualcomm/QcomPkg/         shared Qualcomm code
  Silicon/Silicium/SiliciumPkg/     shared Silicium code (KEP, logo, etc)
  Binaries/                     submodule: extracted Qualcomm drivers per device
  Silicium-ACPI/                submodule: ACPI tables per SoC and device
  Mu_Basecore/                  submodule: Project Mu core (EDK2 fork)
  Resources/Configs/<device>.toml   build settings (FD address, boot image header)
  Resources/DTBs/<device>.dtb       device tree appended to the boot image
```

The split between `Silicon/Qualcomm/<SoC>Pkg` and `Platforms/<Vendor>/<device>Pkg` matters. Everything that is the same for every phone with that chip (GIC addresses, CPU count, SMMU setup) goes in the SoC package. Everything specific to one phone (memory map, display size, which driver binaries) goes in the device package.

`Status.md` has a table per device: Display, Internal Storage, Side Buttons, USB Host Mode, USB Device Mode, USB Power Delivery, Mass Storage, Windows Boot, Linux Boot. Part 3 is about turning that table green.

### Mass storage mode

One feature worth understanding now: Mu-Silicium can expose the phone's internal storage to a PC over USB, as a **USB Mass Storage** device (like a USB stick). On other devices this is how people install Windows: boot UEFI, plug into a PC, and the PC sees the phone's whole disk. I ended up not being able to use it on my work laptop (Part 3 explains why), and did the install a different way.

### KEP: the Kernel Errata Patcher

Windows has expectations about ARM CPUs that some Qualcomm chips do not meet: certain system registers being implemented, a specific GIC behavior, a PSCI call working. Windows on real Snapdragon laptops has workarounds that are switched on for specific chips; phones do not match those. Mu-Silicium's **Kernel Errata Patcher (KEP)** hooks into the boot process, follows Windows Boot Manager, then winload, and patches the Windows kernel in memory right before it starts to avoid those instructions. The SoC package declares which errata apply:

```ini
HAS_ACTLR_EL1_UNIMPLEMENTED_ERRATA         = 1
HAS_AMCNTENSET0_EL0_UNIMPLEMENTED_ERRATA   = 1
HAS_GIC_V3_WITHOUT_IRM_FLAG_SUPPORT_ERRATA = 1
HAS_PSCI_MEMPROTECT_FAILING_ERRATA         = 0
```

You do not need to understand the details yet. Just know that KEP exists, that it reads memory the boot loader allocated, and that it was the first thing to crash when my memory map was wrong.

## ACPI from zero

### The table chain

ACPI is a set of binary tables in memory. Windows finds them like this:

```
UEFI configuration table (GUID for ACPI 2.0)
  -> RSDP   (Root System Description Pointer)
       -> XSDT  (eXtended System Description Table): a list of 64-bit pointers
            -> FACP (FADT)  fixed hardware info, points to the DSDT
            -> APIC (MADT)  interrupt controller and CPU list
            -> GTDT         generic timers
            -> DSDT         the main device description, in AML
            -> SSDT         extra device descriptions, in AML
            -> PPTT, DBG2, BGRT, CSRT ...
```

Every table starts with the same 36-byte header: a 4-character **signature** (`APIC`, `DSDT`...), length, revision, checksum, OEM ID, OEM table ID.

The tables that matter for a minimal Windows boot on ARM:

| Table | What Windows gets from it |
|---|---|
| **FACP** (FADT) | Basic platform flags, PSCI support, pointer to the DSDT |
| **APIC** (MADT) | The GIC distributor and redistributor addresses, and one entry per CPU (with its MPIDR) |
| **GTDT** | Which interrupts the architected timers use |
| **DSDT** | Every other device |
| **SSDT** | More devices (Mu-Silicium uses a common SSDT for its own bits) |

Others you will meet: **BGRT** (boot logo, so Windows can keep showing it), **PPTT** (CPU topology and caches), **DBG2** (debug port), **CSRT** (core system resources, used by Qualcomm's Windows drivers for things like DMA controllers).

### ASL and AML

Device descriptions in the DSDT are not plain data. They are written in **ASL** (ACPI Source Language), compiled into **AML** (ACPI Machine Language) bytecode, and the OS has an interpreter that runs it. That lets methods compute things at runtime (for example, return a different status depending on a variable).

The compiler is `iasl`, from Intel's ACPICA project. It also decompiles: `iasl -d table.aml` produces readable ASL.

### Objects you will see in every device

```
Device (UFS0)                         // a device named UFS0
{
    Name (_HID, "QCOM24A5")           // Hardware ID: the driver matches this
    Name (_CID, "...")                // Compatible ID: fallback match
    Name (_UID, 0)                    // Unique ID, to tell two identical devices apart
    Name (_CCA, 1)                    // Cache Coherency Attribute: 1 = DMA is cache-coherent
    Name (_CRS, ResourceTemplate () { // Current Resource Settings
        Memory32Fixed (...)           //   register range
        Interrupt (...)               //   interrupt
    })
    Method (_STA) { Return (0x0F) }   // Status: 0x0F = present, enabled, shown, working
    Device (DEV0) {                   // a child device
        Name (_ADR, 8)                //   address on the parent bus
        Name (_RMV, 0)                //   not removable
    }
}
```

A Windows driver package has an **INF** file that lists hardware IDs it supports:

```ini
[Qualcomm.NTarm64]
%ACPI\QCOM24A5.DeviceDesc%=UfsQualcomm8996Install, ACPI\QCOM24A5
```

When Windows sees a device with `_HID` `QCOM24A5`, it builds the ID `ACPI\QCOM24A5`, finds that line, and loads the driver. That line is from Windows' own built-in UFS driver (`storufs.inf`). It is why Windows could see my phone's storage without any extra driver package, once the ACPI had a device with that `_HID`.

### Interrupt numbers: DT vs ACPI

ARM's GIC interrupt controller numbers interrupts like this:

| Range | Type |
|---|---|
| 0-15 | SGI (software-generated, used between CPUs) |
| 16-31 | PPI (private per CPU, like the timer) |
| 32+ | SPI (shared peripherals) |

A device tree writes interrupts as `<type number flags>`, where type `0` means SPI and the number is counted **from the start of the SPI range**. ACPI uses the absolute number, called the **GSIV** (Global System Interrupt Vector). So:

```
DT:   interrupts = <0 0x109 4>    -> SPI 0x109
ACPI: GSIV = 0x109 + 32 = 0x129
```

That is why the UFS interrupt is `0x109` in the device tree and `0x129` in the ACPI table above. Getting this wrong gives you a device that initializes and then times out on every command, because its interrupts go nowhere.

## How Windows boots, step by step

### The pieces

| File | Where | Job |
|---|---|---|
| `bootmgfw.efi` | ESP `\EFI\Microsoft\Boot\` | **Windows Boot Manager**. Reads the BCD, picks an entry, loads the OS loader |
| `BCD` | ESP `\EFI\Microsoft\Boot\BCD` | **Boot Configuration Data**: the boot menu and settings, stored as a registry hive |
| `winload.efi` | `\Windows\System32\` | **OS Loader**. Loads the kernel, HAL, registry SYSTEM hive and boot drivers, calls ExitBootServices |
| `ntoskrnl.exe` | `\Windows\System32\` | The kernel |
| boot drivers | `\Windows\System32\drivers\` | Drivers needed to reach the boot disk (storage, file system) |

The flow:

```
Mu-Silicium BDS
  -> bootmgfw.efi
       initializes its own library (memory manager, ACPI access, TPM, crypto)
       opens the BCD, picks the default entry
       loads winload.efi (from disk, or from a RAM disk for WinPE)
  -> winload.efi
       loads ntoskrnl, hal, SYSTEM hive, boot-start drivers
       builds the kernel's memory map and page tables
       calls ExitBootServices
       jumps to the kernel
  -> ntoskrnl
       phase 0: CPU, memory manager, HAL, interrupt controller, timers (from ACPI)
       phase 1: start the other CPUs, load drivers, mount the boot disk
       -> smss.exe -> ... -> login screen or Windows Setup
```

The kernel needs the boot disk *by name* (the BCD stores which partition Windows is on). If no driver can see the disk, you get the classic `INACCESSIBLE_BOOT_DEVICE` blue screen. That is why the UFS ACPI device matters so much: without it, a full Windows install cannot boot even if everything else is perfect.

### The BCD

The BCD is a registry hive with "objects" (boot entries, identified by GUIDs) and "elements" (settings, identified by hex IDs). On Windows you edit it with `bcdedit`. A few settings we will use:

```
bcdedit /set {default} testsigning on              # allow test-signed drivers
bcdedit /set {default} recoveryenabled no          # do not jump into recovery on failure
bcdedit /set {default} bootstatuspolicy IgnoreAllFailures
bcdedit /set {default} nointegritychecks on
bcdedit /set {bootmgr} bootdebug off
```

On Linux you can read and modify it with tools that understand registry hives (I used the Python library `regipy` to read it).

### WinPE

**Windows PE** (Preinstallation Environment) is a small Windows that runs entirely from RAM. It is what the Windows installer and recovery environment run on. It ships as a `.wim` file (`boot.wim`) that Boot Manager loads into a RAM disk, using `boot.sdi` as the RAM disk template.

For a port it is perfect as a first target:

- It needs no disk drivers to boot, because it lives in RAM.
- It gives you a command prompt with `diskpart`, `dism`, `bcdboot`, `bcdedit`.
- If it boots, the CPU, memory, interrupt controller, timers and ACPI basics all work.

### WIM and ESD files

Windows images are distributed as **WIM** (Windows Imaging Format) or **ESD** (a more heavily compressed WIM). One file can hold several **images** (indexes), for example Home and Pro editions. On Linux, `wimlib` (`wimlib-imagex`) can list, extract, modify and apply them, including applying straight onto an NTFS filesystem while keeping Windows permissions and special file types intact. That is how I installed Windows without a Windows PC.

Inside every install image there is a recovery environment at `\Windows\System32\Recovery\winre.wim`. WinRE is a WinPE with extra recovery tools. With one small change (deleting the file that launches the recovery UI) it drops you to a plain command prompt. That is the WinPE I used.

## Debugging without a debugger

On a PC you would attach a serial cable or a kernel debugger. On this phone I had neither: no exposed UART, and Windows' network debugging needs a supported USB or network adapter. The tools that actually worked:

1. **Read the screen.** The DEBUG build of Mu-Silicium prints its log to the display. The last line before a hang is your first clue.
2. **Bisect with modified binaries.** Make a copy of the driver that skips half its work. If the hang moves, the problem is in the half you skipped. Repeat.
3. **Write diagnostics to the ESP.** Add code to the firmware that writes text files (memory map, ACPI tables, benchmark results) to the ESP. Reboot into Android, mount the ESP, read the files. This is far more reliable than taking phone photos of tiny text.
4. **Breakpoints as checkpoints.** Replace one instruction in a binary with `brk #0`. If execution reaches it, you get a crash dump that proves it. If not, the problem is earlier. Move the breakpoint and repeat. It is slow, one reboot per test, but it works on code you have no source for. Part 4 is mostly this technique.

The common idea in all of them: **binary search**. Every test should cut the space where the bug can be in half.

## Prerequisites

Hardware:

- A Snapdragon phone with an **unlockable bootloader**, unlocked. Ideally one whose SoC is already supported (or close to one that is) in Mu-Silicium.
- A USB cable and a Linux PC (I used Ubuntu). Windows works too for some steps, but every command in this series is for Linux.
- Patience, and a phone you are willing to factory reset. Repartitioning wipes Android data.

On the phone:

- **Root access.** On my phone the ROM is a userdebug build, so `adb root` gives a root shell directly. On a retail build you would use Magisk and `su`. You need root to read firmware partitions and to repartition.
- Basic tools available as root: `sgdisk`, and ideally `mkfs.ntfs` / `newfs_msdos`. Mine had all of them.

Knowledge:

- Comfortable in a Linux shell.
- Able to *read* C. Most of what you edit is tables and config, not algorithms.
- Python helps a lot. Almost every investigation step was a small Python script.

Software (Part 2 installs everything):

| Tool | Used for |
|---|---|
| `git`, `python3`, `pip` | Mu-Silicium's build system |
| `clang` / LLVM 18 (`llvm-objdump`, `llvm-mc`, `llvm-pdbutil`, `llvm-symbolizer`) | Disassembling, assembling single instructions, reading PDBs, symbolizing crashes |
| `uefi_firmware` (pip) | Unpacking Qualcomm's UEFI partition |
| `fdt` (pip) or `dtc` | Reading device trees |
| `adb`, `fastboot` | Talking to the phone |
| `wimtools` (wimlib) | Working with Windows images |
| `ntfs-3g` (`mkntfs`) | Creating NTFS images on Linux |
| `img2simg` (android-sdk-libsparse-utils) | Converting raw images to fastboot sparse images |
| `iasl` | Compiling ACPI tables |
| `xxd`, `strings`, `grep -boa` | Poking at binaries |

## Before you continue

If you remember only a few things from this post:

- The phone already runs UEFI, but not one Windows can use. Mu-Silicium is our own UEFI, loaded by ABL as if it were a kernel.
- Our firmware runs at EL1 under a hypervisor. Memory that belongs to someone else must be marked reserved, or things fault.
- UEFI drivers find each other by GUID. A wrong GUID fails silently.
- Windows needs ACPI. No tables, no Windows. No storage device in the DSDT, no disk.
- Crashes come with ELR, ESR and FAR. ELR minus the image base gives an RVA, and a PDB turns an RVA into a function name.
- When you have no debugger, bisect.

In [Part 2]({% post_url 2026-10-21-asteroids-woa-2-uefi-project %}) we set up the tools, back up the phone, pull apart the stock firmware, and create the SoC and device packages for the first boot attempt.
