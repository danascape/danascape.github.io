---
layout: post
title: "Android Boot: Framework Boot Sequence - 2"
date: 2026-02-13 00:00:01 +0530
categories: [AOSP]
tags: [Android, AOSP, Frameworks, Vendor]
description: "What happens after init is started from kernel"
author: danascape
toc: true
---

## From Kernel to Zygote to SystemServer
In Part-1, we stopped at the point where the bootloader hands execution to the Linux Kernel.

Now we enter the phase where Android actually "comes alive", from kernel initialization to Zygote, SystemServer, and finally the first app.

This is where Android stops being firmware and moves to being an **Operating System**.

## From Bootlaoder to Linux Kernel
After AVB verification, ABL loads into memory:
- Linux Kernel
- initramfs (ramdisk)
- DTB/DTBO
- Boot params

Execution jumps to the **kernel entry point**

At this point:

```
- No Android services exist
- No java runtime exists
- Only the Linux Kernel is running
```

## Linux Kernel Early Initialization
Once control is transferred to kernel, it performs its early boot sequence:
- Decompress Kernel (if compressed)
- Setup MMU & virtual memory
- Initialize scheduler
- Setup interrupt handlers
- Detect CPU cores & topology
- Initialize drivers
- Mount initial ramdisk

Modern Android Kernels are customized with:
- Binder
- Ashmem
- ion/DMABUF heaps
- SELinux hooks (LSM)
- cgroups v2

After kernel init completes, it executes the very first userspace process:
```
/init
```
**This is NOT systemd.**

Android uses its own custom `init`.

## Android Init
Android's `init` is PID 1 and is defined in:
```
system/core/init/
```
It is responsible for bringing up the entire Android userspace.
It does:
- Parses `init.rc` and hardware-specific `init.<board>.rc`
- Mounts early partitions (system, vendor, product, odm, etc)
- Initializes SELinux (enforcing very early)
- Starts ueventd (device node manager)
- Sets system properties
- Launches critical native daemons
- Triggers first-stage to second-stage init transition

## First-Stage Init
- Mount essential partitions using `fstab`
- Setup dm-verify / AVB-backed block devices
- Mount logical partitions (`fs_mgr`)
- Prepare logical partition mounts

## Second-Stage init
After core mounts are ready, init re-execs itself into second-stage.

It parses:
- `init.rc`
- `init.<hardware>.rc`
- etc

These scripts defines:
- Services
- Permissions
- Sockets
- Properties
- Triggers (`on boot`, `on property:` etc.)

**This is where Android's real service graph is defined.**

## Native Daemons Started by Init
Before Java, several native services are launched.

Core ones include:
- `ueventd` (device node management)
- `logd` (logging daemon)
- `servicemanager` (Binder context manager)
- `vold` (volume daemon)
- `hwservicemanager` (HAL/AIDL HAL registry)
- `apexd` (APEX module activation)

### APEX
APEX packages (like ART, Conscrypt, etc) are mounted very early by `apexd`, meaning core runtime components are now modular and updatable without full OTAs.

## Zygote: Process Incubator
After core native services are up, `init` launches the **Zygote** process.

Zygote is started via:
```
/system/bin/app_process64
```
with arguments specifying the Zygote class:
```
com.android.internal.os.ZygoteInit
```
Zygote exists because android does not start apps from scratch each time. Instead, it uses a **fork model** (inherited from Linux efficiency priciples).

Zygote:
- Starts the ART runtime
- Preloads core framework classes
- Preloads resources (drawables, assets, etc.)
- Opens binder driver
- Listens on a Zygote socket for fork requests

This reduces app launch latency and memory overhead via:
```
Copy-On-Write (COW) memory sharing
```

## ART Runtime
Zygote initialises:
- ART VM
- JIT/AOT infrastructure
- Boot classpath
- Core libraries (framework.jar, core-oj.jar, etc)

Preloading includes:
- Framework classes
- Android resources
- ICU data
- Fonts
- System configurations

That is why Zygote startup is heavy but done only once.

## Forking SystemServer
the first process Zygote forks is:
```
system_server
```
This is the most critical userspace process in Android.
```
If system_server dies, Android soft reboots (watchdog trigger)
```

## SystemServer Initialisation
Zygote executes:
```
ZygoteInit.main()
    - forkSystemServer()
        - SystemServer.main()
```
Inside `SystemServer`:
- Native Initialization
    - Initializes Binder thread pool
    - Loads native libraries
    - Sets process priority & scheduling policies
    - Configures watchdog

## Starting Core System Services
SystemServer then creates and starts hundreds of system services via `SystemServiceManager`.

Key core services include:
- ActivityManagerService (AMS)
- WindowManagerService (WMS)
- PackageManagerService (PMS)
- PowerManagerService
- DisplayManagerService
- InputManagerService
- SensorService (via native bridge)

These services run inside the same process but on different threads.
```
This design reduces IPC overhead between core framework components.
```
## Service Startup Modes
1. Direct instantiation
```java
new ActivityManagerService(...)
```
Service registered via:
```java
ServiceManager.addService()
```
2. Lazy Singleton pattern
Used when service must be globally unique and initialized on-demand.
3. Lifecycle-driven services
Managed via `SystemService` base class:
- `onStart()`
- `onBootPhase()`
- `systemReady()`

## Boot Phases & systemReady()
SystemServer progresses through structured boot phases:
- `PHASE_WAIT_FOR_DEFAULT_DISPLAY`
- `PHASE_LOCK_SETTINGS_READY`
- `PHASE_SYSTEM_SERVICES_READY`
- `PHASE_BOOT_COMPLETED`

After core services stabilize:
```java
ActivityManagerService.systemReady()
```
is called.

This signals:
```
The Android framework is now operational.
```

## Launching the First App (Home / Launcher)
Once AMS is ready:

It executes logic equivalent to:
```java
startHomeActivity()
```
This:
- Resolves default launcher via PackageManager
- Forks a new app process from Zygote
- Starts the Home Activity (Launcher3/OEM Launcher)

Now the UI appears.

At this exact moment:
```
Android userspace is fully alive.
```

## Binder: Hidden Backbone
Every Android components (Apps - System Services - HALs)
communicates via:
- Binder IPC driver (kernel)
- ServiceManager (context registry)

Framework architecture triad:
- Client (App process)
- Server (System Service)
- Kernel Binder Driver

## Modern Application Model
An Android app is **not a single executable binary**.

It is a package containing components:
- Activities
- Services
- Broadcast Receivers
- Content Providers

The framework (AMS + PMS + Zygote) dynamically:
- Creates process
- Instantiates components
- Calls lifecycle methods (`onCreate()`, etc)

So the real exec entry point of an app is:
```
ActivityThread.main()
```
NOT `main()` of the APK.

## Framework Analogy (EIT Model)

| **Layer** | **Role** |
| Engine | Android Framework + ART + System Services |
| Interface | Android APIs (Activity, Service, etc.) |
| Tire | Application Components written by developers |

When the framework wants to run an Activity:
- Zygote forks process
- ActivityThread attaches to AMS
- Framework involves `onCreate()`
- Developer code is executed

The app never directly controls process creation.

## Recap
```
BootROM -> PBL -> XBL -> ABL -> Linux Kernel -> init (1st) -> init (2nd) -> Native Daemons -> Zyogte -> SystemServer -> System Services -> Launcher -> Apps

```
```
The Android OS is fully operational.
```

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

Got thoughts, feedback, or just want to drop a hi?
→ <a href="mailto:saalim.priv@gmail.com" style="color:#58a6ff;">saalim.priv@gmail.com</a>

</pre>

<hr style="margin-top: 20px;">