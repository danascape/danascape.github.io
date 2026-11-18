---
layout: post
title: "Windows on the Nothing Phone (3a) - Part 2: Setting Up the UEFI Project"
date: 2026-10-21 00:00:02 +0530
categories: [Windows on ARM]
tags: [UEFI, Qualcomm, Mu-Silicium, ARM64, Reverse Engineering]
description: "Most of a port is copying the right things from the right places."
author: danascape
series: "Windows on the Nothing Phone (3a)"
tldr:
  - "Set up Mu-Silicium and back up the phone's firmware"
  - "Pull Qualcomm's UEFI drivers, memory map and config out of the stock firmware"
  - "Create `MilosPkg` and `asteroidsPkg`, and build an image ABL will start (it won't fully boot yet)"
prereqs:
  - "[Part 1](/posts/asteroids-woa-1-theory/), or a working idea of boot chains, UEFI and ACPI"
  - "An Ubuntu machine with ~5 GB free for the Mu-Silicium clone"
toc: true
---

## Where we are

In [Part 1]({% post_url 2026-10-21-asteroids-woa-1-theory %}) I covered the theory: boot chains, ARM64, UEFI, ACPI, and how Windows boots. This part is practical. By the end of it we will have:

- a working build environment for Mu-Silicium,
- a full backup of the phone's firmware,
- Qualcomm's UEFI drivers extracted from the phone,
- the memory map and configuration pulled out of the stock firmware,
- a new SoC package (`MilosPkg`) and device package (`asteroidsPkg`),
- an image that ABL accepts and starts.

It will not *work* yet. The first boot hangs halfway through the driver list. Fixing that is [Part 3]({% post_url 2026-10-21-asteroids-woa-3-going-green %}).

I will show every command I ran. Paths like `~/woa/backup` are just where I kept things; use whatever you like.

## Setting up the PC

I used Ubuntu. Install the basics:

```bash
sudo apt install git python3 python3-venv python3-pip clang lld llvm \
    adb fastboot xxd binutils device-tree-compiler \
    wimtools ntfs-3g android-sdk-libsparse-utils
```

What each is for:

- `clang`, `lld`, `llvm`: the compiler Mu-Silicium uses, plus `llvm-objdump` (disassembler), `llvm-mc` (assembles single instructions) and `llvm-pdbutil` (reads Microsoft symbol files). On my machine they live in `/usr/lib/llvm-18/bin/`.
- `adb`, `fastboot`: talking to the phone.
- `xxd`: hex dumps.
- `device-tree-compiler` (`dtc`): decompiles device trees. If your distro does not have it, the Python `fdt` package does the same job, and that is what I ended up using.
- `wimtools`, `ntfs-3g`, `android-sdk-libsparse-utils`: only needed in Part 4, for Windows images.

### Getting Mu-Silicium

```bash
git clone https://github.com/Project-Silicium/Mu-Silicium.git --recursive
cd Mu-Silicium
./setup_env.sh -p apt
python3 -m pip install -r pip-requirements.txt
```

The clone is about 5 GB because of the submodules (`Mu_Basecore`, `Binaries`, `Silicium-ACPI`, OpenSSL and others).

Before touching anything, **build an existing device** to prove the environment works:

```bash
python3 build_uefi.py -d bale_b -r DEBUG
```

If that ends with a `Mu-bale_b.img` in the repo root, your setup is fine. If it fails now, it is an environment problem, not a porting problem, and it is much easier to fix before you have added your own files.

`build_uefi.py` options worth knowing:

| Option | Meaning |
|---|---|
| `-d <device>` | Which device to build |
| `-r DEBUG` / `-r RELEASE` | DEBUG prints a log on the screen. Always use DEBUG while porting |
| `-c` | Clean build |

### Python tools for poking at firmware

I kept these in a virtual environment so they do not mess with the system Python:

```bash
python3 -m venv ~/woa/venv
~/woa/venv/bin/pip install uefi_firmware fdt
```

- `uefi_firmware` gives you `uefi-firmware-parser`, which unpacks UEFI firmware volumes.
- `fdt` parses device tree blobs (`.dtb`) and can print them as source (`.dts`).

## Getting to know the phone

### Root shell

My phone runs a userdebug ROM, so:

```bash
adb root
adb shell id      # uid=0(root)
```

On a retail ROM with Magisk you would run commands as `adb shell su -c '...'`. Everything below needs root.

### Identity

```bash
adb shell getprop ro.product.device          # asteroids
adb shell getprop ro.product.model           # A059
adb shell getprop ro.board.platform          # volcano
adb shell getprop ro.soc.model               # SM7635
adb shell getprop ro.boot.slot_suffix        # _b
adb shell getprop ro.build.fingerprint
adb shell cat /sys/devices/soc0/soc_id       # 636
```

`volcano` is the name Android uses for this platform. Qualcomm's bootloader uses yet another name, which we find in a moment.

### The partitions

```bash
adb shell ls -l /dev/block/by-name/
```

You get a long list of links like `uefi_b -> /dev/block/sde22`. The ones I cared about are listed in Part 1. Note the active slot (`_b` for me). Everything we extract comes from that slot.

## Backing up the firmware

Before anything else, dump every firmware partition. You will not flash any of these, but you will read them over and over, and if something ever does go wrong you want the originals.

```bash
mkdir -p ~/woa/backup && cd ~/woa/backup
for p in uefi_a uefi_b xbl_a xbl_b xbl_config_a xbl_config_b abl_a abl_b \
         boot_a boot_b init_boot_a init_boot_b vendor_boot_a vendor_boot_b \
         dtbo_a dtbo_b vbmeta_a vbmeta_b imagefv_a imagefv_b devcfg_a devcfg_b \
         toolsfv uefisecapp_a uefisecapp_b; do
    adb exec-out "cat /dev/block/by-name/$p" > $p.img || echo "FAIL $p"
done
sha256sum *.img > SHA256SUMS
```

`adb exec-out` streams raw bytes without the terminal mangling them (plain `adb shell` can convert line endings on some versions).

Also save the partition table of the big LUN. We will change it in Part 4:

```bash
adb exec-out 'sgdisk --backup=/tmp/sda.gpt /dev/block/sda >/dev/null 2>&1; cat /tmp/sda.gpt' > sda-gpt-sgdisk.bak
adb shell sgdisk --print /dev/block/sda > sda-gpt.txt
```

## Finding the SoC's UEFI name

Mu-Silicium organizes Qualcomm SoCs by **the name Qualcomm's UEFI uses**, not the marketing name. SM8635 (Snapdragon 8s Gen 3) is `Palawan`, SM8550 is `Kailua`, and so on. You find the name in the strings of the stock UEFI:

```bash
strings uefi_b.img | grep -m3 -iE "Build/[A-Za-z]+"
strings -n 8 uefi_b.img xbl_b.img | grep -m6 -oE "BOOT\.[A-Z0-9._-]+"
```

On my phone:

- the build path contains `Build/MilosLAA` → the SoC is **Milos**,
- the boot chain version is `BOOT.MXF.2.1-01955-LANAI-1.88923.2`.

That second string matters more than it looks. `BOOT.MXF.2.1` is the branch of Qualcomm's boot code. Phones on the **same branch** have very similar UEFI drivers, which means the binary patches other people made for their phone have a good chance of applying to yours with only the offsets changed.

### Choosing donors

Milos was not in Mu-Silicium. So I needed two donors:

1. **An SoC package to copy.** Palawan (SM8635) is the closest supported SoC: same generation, same GIC layout, same kind of CPU cores. So `PalawanPkg` → `MilosPkg`.
2. **A device package to copy.** I looked for a supported device on the same boot branch, `BOOT.MXF.2.1`. The Realme GT Neo6 (`bale_b`, a Palawan phone) is on it, and its driver patches are documented. So `bale_bPkg` → `asteroidsPkg`.

I also used patches from `muyu`, `peridot` and `salami` (other devices on the same branch) later, in Part 3.

> To check a device's branch, look at the `README.md` in its `Binaries/<device>` folder. Most list the firmware version they were extracted from.
{: .prompt-tip }

## Unpacking Qualcomm's UEFI

```bash
mkdir -p ~/woa/uefi_b && cd ~/woa/uefi_b
~/woa/venv/bin/uefi-firmware-parser -b -e -o . ~/woa/backup/uefi_b.img
```

`-b` brute-forces the search for firmware volumes (Qualcomm wraps them in an ELF), `-e` extracts everything, `-o .` writes here. You get a tree like:

```
volume-4096/
  file-9e21fd93-.../section0/section1/volume-1d301fe9-.../
    file-d93ce3d8-a7eb-4730-8c8e-cc466a9ecc3c/
      section0.pe        <- the driver
      section1.depex     <- dependencies
      section2.ui        <- name, in UTF-16
    file-.../
    ...
```

Every `file-<GUID>` folder is one FFS file. To see what is what, print the names:

```bash
for u in $(find . -name "*.ui"); do
    echo "$(tr -d '\0' < $u)  $(dirname $u)"
done | sort
```

(`.ui` files are UTF-16, so stripping the zero bytes is a lazy way to turn them into ASCII.)

You will see names like `ClockDxe`, `PmicDxe`, `UFSDxe`, `UsbConfigDxe`, `ButtonsDxe`, `TzDxeLA`, and also raw files like `uefiplat.cfg`, `SecParti.cfg`, `uefipil.cfg`, `QcomChargerCfg.cfg`, panel configs and logos.

### uefiplat.cfg

Qualcomm's UEFI reads platform settings from `uefiplat.cfg`. Print it:

```bash
for u in $(find . -name "*.ui"); do
    [ "$(tr -d '\0' < $u)" = "uefiplat.cfg" ] && cat $(dirname $u)/section1.raw | tr -d '\r'
done
```

It has a `[ConfigParameters]` section with entries like:

```ini
EnableShell = 0x1
SharedIMEMBaseAddr = 0x14680000
NumCpus = 8
NumActiveCores = 8
EnableUfsIOC = 1
UfsSmmuConfigForOtherBootDev = 1
...
```

Qualcomm's drivers ask for these values at runtime through a configuration protocol. In Mu-Silicium, each device provides them in `ConfigurationMapLib.c`. For my phone, the values turned out to be identical to bale_b's, which is another sign of how close devices on the same branch are.

## The memory map: the most important file in the port

### Where Qualcomm keeps it

Qualcomm's UEFI also needs a memory map, and older SoCs kept it in `uefiplat.cfg` as plain text. On newer ones it moved. I searched for region names I knew should exist:

```bash
grep -boa "UEFI_FD\|DXE_Heap\|Sched_Heap" ~/woa/backup/*.img
```

The hit was in `xbl_config_b.img`. Looking at the bytes around it with `xxd` showed device tree structure: property names, `reg`, and so on. `xbl_config` contains **embedded device trees**, and the memory map is one of them.

### Carving device trees out of a blob

Every flattened device tree starts with the magic number `d0 0d fe ed`, followed by its total size (big-endian, 4 bytes). So finding them is a simple scan:

```python
# carve_fdt.py: extract every device tree blob from a binary file
import struct, sys
data = open(sys.argv[1], 'rb').read()
out = sys.argv[2]
i = 0; n = 0
while True:
    i = data.find(b'\xd0\x0d\xfe\xed', i)
    if i < 0: break
    size = struct.unpack('>I', data[i+4:i+8])[0]
    if 0x40 < size < len(data) - i:      # ignore false matches
        open(f'{out}/fdt_{n}_{i:x}.dtb', 'wb').write(data[i:i+size])
        print(hex(i), hex(size)); n += 1
    i += 4
```

```bash
mkdir -p ~/woa/xblcfg
python3 carve_fdt.py ~/woa/backup/xbl_config_b.img ~/woa/xblcfg
# then decompile each one
for f in ~/woa/xblcfg/*.dtb; do
  ~/woa/venv/bin/python -c "import fdt,sys; print(fdt.parse_dtb(open(sys.argv[1],'rb').read()).to_dts())" $f > ${f%.dtb}.dts
done
grep -n "uefimem" ~/woa/xblcfg/*.dts
```

The second blob has a node with `compatible = "qcom,uefimem"`, called `memorymap`. Each child is one region:

```
memory@A7000000 {
    device_type = "memory";
    reg = <0x0 0xA7000000 0x0 0x400000>;
    MemLabel = "UEFI_FD";
    ResourceAttribute = <0x703C07>;
    BuildHob = [00];
    ResourceType = [00];
    MemoryType = [04];
    CacheAttributes = [02];
};
```

That is exactly the information Mu-Silicium's `MemoryMapLib` wants, just encoded as numbers.

### Decoding the numbers

Mu-Silicium's memory map entries look like this:

```c
// Name, Address, Length, HobOption, ResourceType, ResourceAttribute, MemoryType, ArmAttribute
{"UEFI_FD", 0xA7100000, 0x00300000, AddMem, SYS_MEM, SYS_MEM_CAP, BsData, WRITE_BACK},
```

Each field corresponds to one DT property:

| DT property | Values | Mu-Silicium name |
|---|---|---|
| `BuildHob` | 0, 1, 4 | `AddMem`, `AddDev`, `NoHob` |
| `ResourceType` | 0, 1, 5 | `SYS_MEM` (RAM), `MMAP_IO` (registers), `MEM_RES` (reserved) |
| `ResourceAttribute` | 0x703C07, 0x400, 0x7 | `SYS_MEM_CAP`, `UNCACHEABLE`, `INITIALIZED` |
| `MemoryType` | 0, 4, 6, 7, 0xB | `Reserv`, `BsData`, `RtData`, `Conv`, `MmIO` |
| `CacheAttributes` | 0x02, 0x22, 0x23, 0x25, 0x00 | `WRITE_BACK`, `WRITE_BACK_XN`, `WRITE_THROUGH_XN`, `UNCACHED_UNBUFFERED_XN`, `NS_DEVICE` |

I worked these out by comparing a device that already had both a DT memory map and a Mu-Silicium `MemoryMapLib.c`, and by reading `MemoryMapLib.h` and `ArmLib.h` in the source. `XN` means "execute never": the CPU may not run code from that region.

Instead of converting a hundred lines by hand, I wrote a script:

{% raw %}
```python
# memmap.py: convert Qualcomm's qcom,uefimem DT node to MemoryMapLib entries
import sys, fdt
t = fdt.parse_dtb(open(sys.argv[1], 'rb').read())
path = [n for n in t.walk() if n[0].endswith('memorymap')][0][0]
node = t.get_node(path)

HOB = {0:'AddMem', 1:'AddDev', 4:'NoHob'}
RT  = {0:'SYS_MEM', 1:'MMAP_IO', 5:'MEM_RES'}
RA  = {0x703C07:'SYS_MEM_CAP', 0x400:'UNCACHEABLE', 0x7:'INITIALIZED'}
MT  = {0:'Reserv', 4:'BsData', 6:'RtData', 7:'Conv', 0xB:'MmIO'}
CA  = {0x02:'WRITE_BACK', 0x22:'WRITE_BACK_XN', 0x23:'WRITE_THROUGH_XN',
       0x25:'UNCACHED_UNBUFFERED_XN', 0x00:'NS_DEVICE'}

def val(n, k):
    p = n.get_property(k)
    v = p.data if hasattr(p, 'data') else p.value
    return v[0] if isinstance(v, (list, bytes, bytearray)) else v

for n in node.nodes:
    r = n.get_property('reg').data
    base = (r[0] << 32) | r[1]; size = (r[2] << 32) | r[3]
    name = n.get_property('MemLabel').value
    print('  {%-22s 0x%08X, 0x%08X, %s, %s, %s, %s, %s},' % (
        '"%s",' % name, base, size,
        HOB[val(n,'BuildHob')], RT[val(n,'ResourceType')],
        RA[val(n,'ResourceAttribute')], MT[val(n,'MemoryType')],
        CA[val(n,'CacheAttributes')]))
```
{% endraw %}

```bash
~/woa/venv/bin/python memmap.py ~/woa/xblcfg/fdt_1_39e4c.dtb
```

The output pastes almost directly into `MemoryMapLib.c`. Two adjustments, both copied from how bale_b does it:

- Qualcomm's map has `UEFI_FD` at `0xA7000000`, 4 MiB. Mu-Silicium splits it: `FD_Reserved` at `0xA7000000` (1 MiB) and `UEFI_FD` at `0xA7100000` (3 MiB). Our firmware image is loaded at `0xA7100000`.
- Regions that only matter to Qualcomm's own UEFI core (which we do not run) can be dropped. If unsure, compare with the donor device's file.

### The part I got wrong at first

The `uefimem` node only lists regions Qualcomm's UEFI cares about. It does **not** list every piece of memory that belongs to the hypervisor, TrustZone, or other processors. And Mu-Silicium has a driver (`RamManagerDxe`) that takes the full RAM size from shared memory and **fills every gap in your map with free RAM**.

So any carve-out missing from your map becomes "free memory" that Windows will happily allocate. My first Windows boot crashed reading `0x80000000`, which belongs to the Gunyah hypervisor, for exactly this reason. The fix (in Part 4) was to compare the map against the Android device tree's `/memory` and `/reserved-memory` nodes and add reserved entries for every hole. If you are doing this yourself, do that comparison *now*. I will show the method in Part 4.

## The device tree for the boot image

ABL refuses to boot a kernel without a device tree it likes, matching the phone's `qcom,msm-id` and `qcom,board-id`. The easiest DTB that ABL definitely accepts is the one it booted Android with:

```bash
adb exec-out cat /sys/firmware/fdt > Resources/DTBs/asteroids.dtb
xxd -l 16 Resources/DTBs/asteroids.dtb        # starts with d00d feed
strings Resources/DTBs/asteroids.dtb | grep -m3 -iE "volcano|asteroids|Nothing"
```

`/sys/firmware/fdt` is the exact blob the kernel received. It is also a great reference for everything else: addresses of the UFS controller, the GIC, the SMMU stream IDs, the display's reserved memory. You can read individual properties live:

```bash
adb shell 'cd /sys/firmware/devicetree/base; cat model; echo; xxd -p qcom,msm-id; xxd -p qcom,board-id'
adb shell 'cd /sys/firmware/devicetree/base/reserved-memory; xxd -p splash_region/reg'
```

From it I got:

| What | Value | Where from |
|---|---|---|
| GIC distributor | `0x17100000` | `interrupt-controller@17100000` `reg` |
| GIC redistributors | `0x17180000` | same node, second `reg` |
| Splash framebuffer | `0xE3940000`, size `0x2B00000` | `reserved-memory/splash_region` |
| Display size | 1080 x 2392 | `adb shell wm size` |
| CPU clusters | 4 + 3 + 1 | `cpus/cpu-map` |
| MDP SMMU stream IDs | `0x1C00`, `0x1C01`, `0x1C02` | `iommus` of the display nodes |

## Creating the SoC package: MilosPkg

Start from Palawan:

```bash
cd Silicon/Qualcomm
mkdir MilosPkg
cp -r PalawanPkg/Library MilosPkg/
```

Then write `MilosPkg/MilosPkg.dsc.inc`. This is included by every device on this SoC. The full file:

```ini
[Defines]
  #
  # Timer
  #
  USE_PHYSICAL_TIMER                         = 0

  #
  # KEP
  #
  HAS_ACTLR_EL1_UNIMPLEMENTED_ERRATA         = 1
  HAS_AMCNTENSET0_EL0_UNIMPLEMENTED_ERRATA   = 1
  HAS_GIC_V3_WITHOUT_IRM_FLAG_SUPPORT_ERRATA = 1
  HAS_PSCI_MEMPROTECT_FAILING_ERRATA         = 0

!include QcomPkg/QcomPkg.dsc.inc

[BuildOptions]
  *_*_AARCH64_CC_FLAGS = -march=armv9.2-a+crypto+rcpc

[PcdsFixedAtBuild]
  #
  # ACPI
  #
  gEfiMdeModulePkgTokenSpaceGuid.PcdAcpiDefaultOemTableId|0x202020534F4C494D
  gEfiMdeModulePkgTokenSpaceGuid.PcdAcpiDefaultOemRevision|0x7635

  #
  # CPU
  #
  gArmPlatformTokenSpaceGuid.PcdCoreCount|8
  gArmPlatformTokenSpaceGuid.PcdClusterCount|3

  #
  # GIC
  #
  gArmTokenSpaceGuid.PcdGicDistributorBase|0x17100000
  gArmTokenSpaceGuid.PcdGicRedistributorsBase|0x17180000

  #
  # SMBIOS
  #
  gSiliciumPkgTokenSpaceGuid.PcdSmbiosProcessorModel|"Snapdragon (TM) 7s Gen 3 @ 2.50 GHz"
  gSiliciumPkgTokenSpaceGuid.PcdSmbiosProcessorPartNumber|"SM7635"

[LibraryClasses]
  #
  # SEC Libraries
  #
  PlatformSecLib|MilosPkg/Library/PlatformSecLib/PlatformSecLib.inf

[Components]
  #
  # Custom Drivers
  #
  QcomPkg/Drivers/IortDtDxe/IortDtDxe.inf
```

Where each value came from:

- **`USE_PHYSICAL_TIMER = 0`**: under a hypervisor we use the virtual timer. Same as Palawan.
- **KEP errata**: copied from Palawan. Same CPU generation, same Windows quirks. Part 1 explains KEP.
- **`-march=armv9.2-a+crypto+rcpc`**: the CPU architecture level. Copied from Palawan.
- **OEM table ID `0x202020534F4C494D`**: this is just the ASCII string `"MILOS   "` read as a little-endian 64-bit number. It ends up in the header of every ACPI table. Compute it with:

  ```bash
  python3 -c "print(hex(int.from_bytes(b'MILOS   ','little')))"
  ```
- **OEM revision `0x7635`**: from the chip number SM**7635**. Other SoC packages follow the same pattern.
- **Core and cluster count**: from the DT `cpu-map`.
- **GIC bases**: from the DT, as shown above.
- **SMBIOS strings**: what Windows shows in System Information. The 2.50 GHz is the prime core's max frequency (`cpuinfo_max_freq` of `cpu7` was 2496000 kHz).

### PlatformSecLib: the SMMU detach

The SoC's `PlatformSecLib` runs very early. On Qualcomm phones, the display engine (MDP) is behind an **SMMU** (an IOMMU: it translates device memory accesses the way the MMU translates CPU accesses). The bootloader leaves the display's SMMU context configured for Android. If we leave it, the display controller's reads of our framebuffer go through translation tables that do not describe our memory, and the screen stays black or shows garbage.

So the SEC library detaches the display's stream IDs from the SMMU:

```c
VOID
PlatformInitialize ()
{
  // Set MDP SIDs
  CONST UINT16 MdpStreams[] = { 0x1C00, 0x1C01, 0x1C02 };

  // Detach IOMMU Domains
  ArmSmmuDetach (MdpStreams, ARRAY_SIZE (MdpStreams));
}
```

Palawan's version had `{ 0x1C00, 0x1C01, 0x1C04, 0x1C06 }`. I took mine from the phone's DT: the `iommus` properties of the display nodes (`qcom,mdss_mdp@ae00000`, `qcom,smmu_sde_unsec_cb`, `qcom,smmu_sde_sec_cb`). An `iommus` property is `<phandle streamID mask>`, so you read the middle value.

```bash
adb shell 'cd /sys/firmware/devicetree/base/soc; for n in qcom,mdss_mdp@ae00000 qcom,smmu_sde_unsec_cb qcom,smmu_sde_sec_cb; do echo "$n: $(xxd -p $n/iommus | tr -d "\n")"; done'
```

Also give the copied `PlatformSecLib.inf` a **new** `FILE_GUID`, so it does not clash with Palawan's copy:

```bash
python3 -c "import uuid; print(str(uuid.uuid4()).upper())"
```

> New GUIDs are right for *modules you created* (libraries, the platform). They are wrong for anything other code looks up by GUID. Remember this; I did not, a bit further down.
{: .prompt-warning }

## Creating the device package: asteroidsPkg

Copy the donor and rename everything:

```bash
cd Platforms
mkdir -p Nothing
cp -r Realme/bale_bPkg Nothing/asteroidsPkg
cd Nothing/asteroidsPkg
mv bale_b.dsc asteroids.dsc
mv bale_b.dec asteroids.dec
mv bale_b.fdf asteroids.fdf
grep -rl "bale_b" . | xargs sed -i 's/bale_b/asteroids/g'
sed -i 's/PalawanPkg/MilosPkg/g' asteroids.dsc
sed -i 's#"Platforms/Realme"#"Platforms/Nothing"#; s#"Silicium-ACPI/Platforms/Realme"#"Silicium-ACPI/Platforms/Nothing"#' DeviceBuild.py
```

Then grep for anything left over from the donor:

```bash
grep -rn -i "palawan\|realme\|oplus" .
```

What is in the package and what I changed:

```
asteroidsPkg/
  asteroids.dsc          platform build description
  asteroids.dec          empty, but required
  asteroids.fdf          firmware image layout
  DeviceBuild.py         build settings for stuart (package paths, scopes)
  Include/APRIORI.inc    drivers that must load first, in order
  Include/DXE.inc        all other drivers
  Include/RAW.inc        raw config files (uefiplat.cfg etc)
  Library/MemoryMapLib/
  Library/ConfigurationMapLib/
```

### asteroids.dsc

The interesting part:

```ini
[Defines]
  PLATFORM_NAME                  = asteroids
  PLATFORM_GUID                  = FFA36E09-833E-4CDD-8955-24E882F40F7F
  ...
  FLASH_DEFINITION               = asteroidsPkg/asteroids.fdf
  USE_CUSTOM_DISPLAY_DRIVER      = 0

!include MilosPkg/MilosPkg.dsc.inc

[PcdsFixedAtBuild]
  gArmTokenSpaceGuid.PcdSystemMemoryBase|0x80000000

  gArmPlatformTokenSpaceGuid.PcdCPUCoresStackBase|0xA760D000
  gArmPlatformTokenSpaceGuid.PcdCPUCorePrimaryStackSize|0x40000

  gSiliciumPkgTokenSpaceGuid.PcdSmbiosSystemManufacturer|"Nothing"
  gSiliciumPkgTokenSpaceGuid.PcdSmbiosSystemModel|"Phone (3a)"
  gSiliciumPkgTokenSpaceGuid.PcdSmbiosSystemRetailModel|"asteroids"
  gSiliciumPkgTokenSpaceGuid.PcdSmbiosSystemRetailSku|"A059"
  gSiliciumPkgTokenSpaceGuid.PcdSmbiosSystemBoardModel|"Asteroids"

  gSiliciumPkgTokenSpaceGuid.PcdFrameBufferWidth|1080
  gSiliciumPkgTokenSpaceGuid.PcdFrameBufferHeight|2392
  gSiliciumPkgTokenSpaceGuid.PcdFrameBufferColorDepth|32

  gQcomPkgTokenSpaceGuid.PcdPlatformType|"LA"

[LibraryClasses]
  MemoryMapLib|asteroidsPkg/Library/MemoryMapLib/MemoryMapLib.inf
  ConfigurationMapLib|asteroidsPkg/Library/ConfigurationMapLib/ConfigurationMapLib.inf

[Components]
  asteroids/AcpiTables.inf
```

- `PLATFORM_GUID`: a new random GUID. This one *should* be unique per device.
- `PcdSystemMemoryBase`: DRAM starts at `0x80000000` on this SoC.
- Stack base `0xA760D000`, size `0x40000`: must match the `UEFI_Stack` region in your memory map.
- Framebuffer: the display resolution. The framebuffer *address* comes from the `Display_Reserved` entry in the memory map (`0xE3940000`), which is where ABL already left the splash screen. Our firmware draws into the same buffer the bootloader set up. No display driver needed.
- `PcdPlatformType|"LA"`: Qualcomm drivers come in "LA" (Linux Android) and "WP" (Windows) flavors. Phones have LA drivers.

bale_b's dsc also had a `SOC_TYPE` define (Palawan has two chip variants); Milos has one, so I removed it.

### The driver lists

`Include/APRIORI.inc` and `Include/DXE.inc` list every driver to put in the image. Each Qualcomm driver is referenced by an INF in the `Binaries` submodule:

```
INF Binaries/asteroids/QcomPkg/Drivers/ClockDxe/ClockDxe.inf
INF Binaries/asteroids/QcomPkg/Drivers/PmicDxe/PmicDxeLa.inf
INF Binaries/asteroids/QcomPkg/Drivers/UFSDxe/UFSDxe.inf
...
```

The APRIORI order is copied from the donor, and you should not change it unless you know why. Qualcomm's drivers do not declare all of their real dependencies; they rely on load order.

After the copy I removed the lines for drivers my phone does not have (`OcdtDxe/OplusProject.inf` is an OPPO/Realme-specific driver), and a display panel block in `RAW.inc` that only applied when `USE_CUSTOM_DISPLAY_DRIVER` was 1.

## The Binaries submodule

`Binaries/<device>/` holds Qualcomm's driver files for that device, each with a small INF that tells the build what it is. For example, bale_b's ClockDxe:

```ini
[Defines]
  INF_VERSION    = 0x0001001B
  BASE_NAME      = ClockDxe
  FILE_GUID      = 4DB5DEA6-5302-4D1A-8A82-677A683B0D29
  MODULE_TYPE    = DXE_DRIVER
  VERSION_STRING = 1.0
  ENTRY_POINT    = EfiEntry

[Binaries.AARCH64]
  DXE_DEPEX|ClockDxe.depex|*
  PE32|ClockDxe.efi|*

[Depex]
  TRUE
```

The `FILE_GUID` here is **Qualcomm's** GUID for ClockDxe, the same on every phone. That gave me an easy way to generate my whole tree: for every INF in `Binaries/bale_b`, find the folder `file-<same GUID>` in my extracted `uefi_b`, copy its `.pe` and `.depex` with the names the INF expects, and write the INF next to them.

```python
# genbins.py <reference tree> <extracted uefi> <output tree>
import os, re, sys, glob, shutil
ref, ext, out = sys.argv[1:4]

# index extracted modules by GUID
mods = {}
for d in glob.glob(f'{ext}/**/file-*', recursive=True):
    g = os.path.basename(d)[5:].upper()
    if any(f.endswith(('.pe', '.te', '.raw', '.depex')) for f in os.listdir(d)):
        mods.setdefault(g, d)

missing, done = [], []
for inf in glob.glob(f'{ref}/**/*.inf', recursive=True):
    rel = os.path.relpath(inf, ref)
    txt = open(inf).read()
    guid = re.search(r'FILE_GUID\s*=\s*(\S+)', txt).group(1).upper()
    if guid not in mods:
        missing.append(rel); continue
    src = mods[guid]
    dst = os.path.join(out, os.path.dirname(rel)); os.makedirs(dst, exist_ok=True)
    def first(sfx):
        c = sorted(f for f in os.listdir(src) if f.endswith(sfx))
        return os.path.join(src, c[0]) if c else None
    new = txt
    for kind, fname in re.findall(r'^\s*(\w+)\|([^|\s]+)\|', txt, re.M):
        base = fname.replace('.patched', '')     # donor's patched files -> stock name
        s = {'PE32': first('.pe'), 'DXE_DEPEX': first('.depex'),
             'TE': first('.te'), 'BIN': first('.raw')}.get(kind)
        if s is None:
            print('WARN no section', kind, rel); continue
        shutil.copyfile(s, os.path.join(dst, base))
        new = new.replace(f'|{fname}|', f'|{base}|')
    open(os.path.join(out, rel), 'w').write(new)
    done.append(rel)

print('generated', len(done))
print('missing:', *missing, sep='\n  ')
```

```bash
cd Mu-Silicium/Binaries
python3 genbins.py bale_b ~/woa/uefi_b asteroids
```

It matched 94 modules. The missing ones were OPPO-specific drivers that only exist on bale_b. Note the `.patched` handling: the donor's INFs point at patched binaries (`PmicDxeLa.patched.efi`). Those are bale_b's patched files and must never end up in my tree, so the script writes *my* stock driver under the plain name. Every patch then gets re-found in my own binaries and applied deliberately. Part 3 shows how; I ported bale_b's eight patches that way before the first boot.

Then copy the raw config files (`uefiplat.cfg`, `SecParti.cfg`, `uefipil.cfg`, charger config, panel files) into `Binaries/asteroids/RawFiles`:

```bash
mkdir -p asteroids/RawFiles
for u in $(find ~/woa/uefi_b -name "*.ui"); do
  n=$(tr -d '\0' < $u)
  case "$n" in *.cfg|*.xml|*.bmp|*.csv)
    r=$(ls $(dirname $u)/*.raw 2>/dev/null | head -1)
    [ -n "$r" ] && cp $r asteroids/RawFiles/$n;;
  esac
done
```

Finally, check that every INF the include files reference exists:

```bash
cd Platforms/Nothing/asteroidsPkg
for f in $(grep -ho "Binaries/asteroids/[^ ]*\.inf" Include/*.inc | sort -u); do
  [ -f ../../../$f ] || echo "MISSING $f"
done
```

Write a `README.md` in `Binaries/asteroids` with the firmware version you extracted from. Future you will want it.

> I briefly added a `RscRtDxe` driver that the phone had and bale_b did not. It turned out to be the same module as Mu's own `ReportStatusCodeRouterRuntimeDxe` (same GUID), and including both broke the build with a duplicate GUID. If a "new" driver has the same GUID as something Mu already builds from source, leave the binary out.
{: .prompt-info }

## ACPI tables

Mu-Silicium gets ACPI tables from the `Silicium-ACPI` submodule. Each device has an `AcpiTables.inf` that lists prebuilt `.aml` files. For a first boot, reusing the closest SoC's minimal tables is fine:

```bash
mkdir -p Silicium-ACPI/Platforms/Nothing/asteroids
cp Silicium-ACPI/Platforms/Realme/bale_b/AcpiTables.inf Silicium-ACPI/Platforms/Nothing/asteroids/
```

```ini
[Defines]
  INF_VERSION                    = 0x00010005
  BASE_NAME                      = AcpiTables
  FILE_GUID                      = 7E374E25-8E01-4FEE-87F2-390C23C606CD
  MODULE_TYPE                    = USER_DEFINED
  VERSION_STRING                 = 1.0

[Binaries]
  ASL|Common/SSDT.aml
  ASL|Palawan/APIC.aml
  ASL|Palawan/DSDT_Minimal.aml
  ASL|Palawan/FACP.aml
  ASL|Palawan/GTDT.aml
```

Here is the mistake that cost me most of a day. When I created this file, I had just given the `PlatformSecLib` copy a new GUID, and I did the same here: I replaced `7E374E25-...` with a random one, thinking each device's INF should be unique.

It must **not** be changed. `7E374E25-8E01-4FEE-87F2-390C23C606CD` is the value of `PcdAcpiTableStorageFile`, defined in `MdeModulePkg.dec`. The ACPI platform driver searches the firmware for a file with *that* GUID and installs whatever tables it contains. With a random GUID, the build succeeds, UEFI boots fine, and the driver silently finds nothing. Android does not care. Windows does, and in Part 4 it crashed in a way that took a long breakpoint hunt to trace back here.

Quick sanity check you can run on any port:

```bash
grep -rh FILE_GUID Silicium-ACPI/Platforms/*/*/AcpiTables.inf | sort | uniq -c
```

Every device has the same GUID. If yours is the odd one out, fix it.

## The build config: asteroids.toml

`Resources/Configs/<device>.toml` tells `build_uefi.py` how to package the firmware. Copy the donor's and adjust:

```toml
#
# Boot Shim Configs
#
[boot_shim]
requires_kernel_header = true

#
# UEFI FD Configs
#
[uefi_fd]
base = 0xA7100000
size = 0x300000

#
# Android Boot Image Kernel Configs
#
[boot_image_kernel]
kernel_compression = "gzip"
append_dtb         = true

#
# Android Boot Image Configs
#
[boot_image]
header_version = 4
os_version     = "17.0.0"
os_patch_level = "2026-10"
```

- `[uefi_fd]`: where the firmware image lives in RAM and how big it is. Must match the `UEFI_FD` entry in the memory map.
- `[boot_shim]` and `[boot_image_kernel]`: make the image look like a gzip-compressed ARM64 Linux kernel with the DTB appended.
- `header_version = 4`: the Android boot image header version ABL expects on this phone. You can check the stock `boot_b.img` header (the version is the 4-byte integer at offset 40 of the header) or just copy what similar phones use.
- `os_version` / `os_patch_level`: see the next section.

## First boot attempt

```bash
python3 build_uefi.py -d asteroids -r DEBUG
adb reboot bootloader
fastboot boot Mu-asteroids.img
```

### "Invalid Parameter"

ABL refused immediately:

```
Failed to load/authenticate boot image: Invalid Parameter
```

bale_b's toml did not set `os_version` and `os_patch_level`, and its ABL did not mind. Mine did. Newer ABLs check the boot image header's OS version and patch level against the device's rollback protection, and an empty value is rejected as invalid. Setting them to the current Android version and a recent month (the two lines at the end of the toml above) fixed it.

> If ABL rejects the image, compare your boot image header with the stock `boot_b.img` field by field. `unpack_bootimg.py` from AOSP (or Mu-Silicium's own scripts under `Resources/Scripts`) prints them.
{: .prompt-tip }

### The slot problem

After one failed attempt, holding power did not bring Android back. The phone went straight to fastboot every time. ABL had counted the failed boot against slot b and marked it unbootable. This fixes it:

```bash
fastboot set_active b
fastboot reboot
```

Do not let the phone fall back to the other slot on its own. On my phone, slot a has different `vendor_boot` and `init_boot`, and booting into a mismatched slot can cause more trouble than it solves.

### It starts

With the header fixed, the screen filled with the DEBUG log, scrolling as DXE loaded drivers one by one:

```
Loading driver at 0x000A8xxx000 EntryPoint=0x000A8xxx... DxeCore.efi
...
Loading driver at 0x000... ClockDxe.efi
...
Loading driver at 0x000... PmicDxe.efi
```

and there it stopped. No crash dump, no error, just the last line sitting there.

That is a good result for a first boot: SEC ran, the memory map is good enough for DXE to run, the display works (we can read the log), and twenty-odd Qualcomm drivers loaded and initialized hardware. Something in `PmicDxe` waits forever, even with bale_b's PmicDxe patch ported.

## Committing

I committed in small pieces, so the history reads like the bring-up:

```
Milos: Initial support             (Silicon/Qualcomm/MilosPkg)
asteroids: Initial support         (Platforms/Nothing/asteroidsPkg)
asteroids: Add DTB                 (Resources/DTBs/asteroids.dtb)
asteroids: Add build config        (Resources/Configs/asteroids.toml)
Silicium-ACPI: Add asteroids       (submodule pointer)
Binaries: Add asteroids            (submodule pointer)
```

`Binaries` and `Silicium-ACPI` are submodules, so commit inside them first (on a branch, since submodules check out in a detached state), then commit the updated pointer in the main repo.

## Checklist

If you are following along with your own phone, by now you should have:

- [ ] A successful build of an existing device
- [ ] A backup of all firmware partitions and the GPT
- [ ] The SoC's Qualcomm codename and boot branch
- [ ] An SoC package (copied from the closest SoC) with GIC, CPU and SMMU values from your DT
- [ ] A device package (copied from a device on the same boot branch)
- [ ] A memory map converted from `xbl_config`'s `qcom,uefimem` node
- [ ] A configuration map from `uefiplat.cfg`
- [ ] Binaries generated by GUID from your own `uefi` partition, all stock
- [ ] `AcpiTables.inf` with `FILE_GUID = 7E374E25-8E01-4FEE-87F2-390C23C606CD`
- [ ] A toml with the right FD address and boot image header
- [ ] An image that ABL starts, and a log on screen

In [Part 3]({% post_url 2026-10-21-asteroids-woa-3-going-green %}) we get past PmicDxe, fix UFS, and work through the rest of the drivers until everything in the status table is green.
