---
layout: post
title: "Using AOSP Kernel Build"
date: 2024-08-14 00:00:00 +0530
categories: [Linux Kernel]
tags: [Linux, Kernel, Linux Kernel, Bazel, Make]
author: danascape
toc: true
---

In my previous blog, we talked about how to cross-compile Android Kernel, but there is another official way that ODMs use to compile their kernel sources, via AOSP Kernel Build.

![](/assets/images/posts/Using-AOSP-Kernel-Build/akb_intro.jpg)

This blog covers 2 aspects:
* Compile using Legacy AOSP Kernel Build
* Add support for bazel Kernel Build

**Bazel** is an open-source build and test tool from Google. It supports a wide range of programming languages and platforms, and it's known for its speed and ability to handle large codebases efficiently. Bazel uses a build system that allows for incremental builds, parallel execution, and sophisticated dependency analysis, making it a popular choice for complex projects like AOSP.

**AOSP Kernel Build System** is the system used to compile the Linux kernel for Android devices. It includes the necessary build scripts, configurations, and toolchains needed to build the kernel from source. The build system is designed to work with AOSP's infrastructure and often uses tools like `make` and `ninja` for the actual compilation process.

In recent years, Bazel has been adopted by some parts of the AOSP for building specific components, but the traditional kernel build process has largely remained based on `make`. However, there's ongoing work to integrate Bazel more deeply into AOSP's build system to leverage its advantages, like better dependency tracking and faster builds.

## Prerequisites
Before diving into the AOSP Kernel Build process, certain requirements need to be met:

* **Basic File and Text Editing**: Familiarity with editing and writing files and text in a Linux environment.
* **Linux Command Line**: Comfort with using the Linux command line interface.
* **Basic Git Knowledge**: Understanding basic Git commands and workflows.
* **Repo Sync and Manifests**: Familiarity with syncing repositories using `repo sync` and working with manifest files.

## Establishing a Build Environment
If you've already set up a Linux build environment, you can skip this step. Otherwise, follow these instructions to get started:
* **Setup Script**: Run the following command on your Linux machine with elevated permissions to set up the necessary environment:
```shell
curl https://raw.githubusercontent.com/akhilnarang/scripts/master/setup/android_build_env.sh | sudo sh
```

This script will install all the required dependencies for building the AOSP Kernel.

## Setup Kernel Manifest
To build the AOSP kernel, you need to set up a kernel manifest, which will allow you to sync the required scripts and compiler.

To do that, head to [here][kmanifest] and sync the required manifest. I would recommend using `common-` and your kernel version branch.
```shell
repo init -u https://android.googlesource.com/kernel/manifest/ -b common-android-4.19-stable --depth 1
```
* **Depth Sync**: The `--depth 1` option is used to perform a shallow sync, which is faster because it doesn't download the entire history. This is ideal if you don't need to develop on the build system itself. If you do plan to develop further, you can perform a full sync by omitting the `--depth 1` option.

After a sync, you can view the structure of the source tree:
```shell
~/kernel/sp# tree -L 1
.
├── build
├── common
├── common-modules
├── hikey-modules
├── kernel
├── prebuilts
├── prebuilts-master
└── tools

8 directories, 0 files
```
Inside the `common/` directory, you'll find the Android Common Kernel source, which we won't need for our purposes. You can replace this with your own kernel source.

Replace common kernel directory with your kernel source with version V4.19.

## Setup Build Config
The AOSP Kernel Build system relies on a `BUILD_CONFIG` variable, which configures the build environment, including kernel configuration and compiler flags.

* Create a file named `build.config.<device-name>`
    * Write basic configuration, like your kernel build directory, which is set to common by default, then required defconfig
```Makefile
KERNEL_DIR=common
. ${ROOT_DIR}/${KERNEL_DIR}/build.config.billie.common.clang
```

* Create a file named `build.config.<device-name>.common.clang`
    * Specify compiler settings, I am differing the names with my perspective, these can be anything.
```Makefile
. ${ROOT_DIR}/${KERNEL_DIR}/build.config.billie.common
CC=clang
LD=ld.lld
CLANG_TRIPLE=aarch64-linux-gnu-
```

* Create a file named `build.config.billie.common`
    * To call the common configuration and define additional settings.
```Makefile
. ${ROOT_DIR}/${KERNEL_DIR}/build.config.common

BUILD_INITRAMFS=1
DEFCONFIG=vendor/billie-perf_defconfig
```
Here, the `build.config.common` file, which is already present in the kernel directory, contains the remaining configuration.

You can find the full reference commit [here][akb-billie-configs]. Fill in the remaining configuration details as per your needs. Depending on your kernel version, you can fully utilize the Build System to start the kernel build process and package the distribution into a boot image.

## Starting the build
Once you have set up your build environment and configured the necessary build files, you can begin compiling the kernel. The AOSP kernel build process uses the `build/build.sh` script, and the build is controlled by the `BUILD_CONFIG` environment variable.

### Step-by-Step Guide to Starting the Build
1. **Setting the `BUILD_CONFIG` Variable:**
    * The `BUILD_CONFIG` variable specifies the path to your configuration file, which contains all the necessary settings for your build, including kernel directories, compiler settings, and other environment variables.
    * You can set the `BUILD_CONFIG` variable by running the following command in your terminal:
```Makefile
export BUILD_CONFIG=common/build.config.<device-name>
```
Replace `<device-name>` with the actual name of your device, or the name you used in your configuration files.

* Running the Build Script:
    * With the `BUILD_CONFIG` variable set, you can now trigger the build process by executing the `build/build.sh` script.
    * The `-j` option is used to specify the number of jobs to run simultaneously, which can significantly speed up the build process on multi-core systems. For example, to run the build with 14 parallel jobs, you can use:
```shell
build/build.sh -j14
```

![](/assets/images/posts/Using-AOSP-Kernel-Build/akb_start.png)

This command will start the kernel compilation process using the configuration you specified in the `BUILD_CONFIG` file.
* Monitoring the Build Process:
    * As the build progresses, you'll see various messages in the terminal, including the compilation of individual source files and linking of the final kernel image.
    * The time it takes to complete the build will depend on your system's hardware and the complexity of the kernel being built. On a modern multi-core system, the build might take anywhere from several minutes to an hour or more.
* Successful Compilation:
    * If everything is configured correctly, the build should complete without errors, and the kernel image will be successfully compiled.

![](/assets/images/posts/Using-AOSP-Kernel-Build/akb_complete.png)

### Customizing `build.config.common`
It's important to note that the `build.config.common` file can vary depending on the kernel sources you're working with. This file contains common settings that are shared across different configurations, such as the default compiler, build options, and any additional environment variables.

* Modifying `build.config.common`:
    * You may need to customize this file to match the specific requirements of your kernel version or device.
    * For instance, the file might include different compiler flags or specify a different defconfig file depending on the target device or kernel features you're working with.

## Part 2: Converting to BUILD.bazel
### Initial Impressions
When I first started experimenting with Bazel for kernel builds, my initial reaction was that it seemed overly complex. However, after spending more time with it and testing it across different kernel versions, I came to a conclusion that it is still in development.

It's important to note that Bazel support in kernel builds is still evolving. Currently, only the latest Pixel kernels (starting from Pixel 8 and kernel version 5.15+) fully support Bazel builds. If you're working with older kernel versions or downstream kernels, you'll face challenges as Bazel support is either incomplete or entirely missing.

If you're interested in trying Bazel for your custom kernel builds, I strongly recommend starting with kernel version 5.15 or newer. These versions are better supported, and you'll encounter fewer issues.

For those working with older or downstream versions (like the 4.19 kernel mentioned earlier), be prepared for a more challenging experience. You'll likely need to make significant modifications to get Bazel working correctly. In this section, I'll share my experience porting a downstream version 4.19 kernel to Bazel, highlighting the challenges I encountered.

### Understanding the Basic Bazel File Structure
At the heart of the Bazel build system is the `BUILD.bazel` file. This file is used to define build rules, targets, and dependencies for your project. In the context of a kernel build, the `BUILD.bazel` file acts as a blueprint, specifying how the kernel and its components should be compiled and linked.

### Prebuilt Bazel Definitons
The top-level `BUILD.bazel` file typically inherits prebuilt Bazel definitions. These definitions are found in the `build/bazel/kleaf` directory within the AOSP kernel manifest source tree. The `kleaf` directory contains essential Bazel macros and rules specifically designed for kernel builds.

You can load these definitions into your `BUILD.bazel` file and override them to customize the build process. This allows you to:
* **Declare New Build Targets**: Define specific targets for different kernel components or modules.
* **Use External Kernel Modules**: Integrate external modules that may not be part of the main kernel source.
* **Customize GKI Configs**: Manage Generic Kernel Image (GKI) configurations, which are crucial for Android devices.
* **Create Boot Images**: Define how the boot image is generated, including the integration of the compiled kernel and ramdisk.

### Example of a basic `BUILD.bazel` file
Here's a simplified example of what a basic `BUILD.bazel` file might look like:
```python
package(
    default_visibility = [
        "//visibility:public",
    ],
)

load("@bazel_skylib//rules:common_settings.bzl", "string_flag")
load("//build/bazel_common_rules/dist:dist.bzl", "copy_to_dist_dir")

load(
    "//build/kernel/kleaf:kernel.bzl",
    "kernel_build",
)
load("@kernel_toolchain_info//:dict.bzl", "BRANCH", "CLANG_VERSION")

kernel_build(
   name = "kernel_billie",
   srcs = glob(
       ["**"],
       exclude = [
           "**/BUILD.bazel",
           "**/*.bzl",
           ".git/**",
       ],
   ),
    outs = [
        "Image",
        "System.map",
        "modules.builtin",
        "modules.builtin.modinfo",
        "vmlinux",
        "vmlinux.symvers",
    ],
   build_config = "build.config.billie",
)
```
Below is a basic `BUILD.bazel` file that I created to compile the kernel source discussed earlier, utilizing the `kleaf` framework provided by Bazel. This file is tailored to work with the specific kernel version and configuration we've been discussing.
Rather than me explaining each and every bit of line, I'll prefer going through bazel documentation to checkout, the changes from `build.config` towards `BUILD.bazel` [here][kleaf-docs].

### Sync Kernel Manifest
To ensure you're working with the latest tools and scripts required for kernel compilation, I recommend syncing the `common-android-mainline` branch from the `kernel/refs+`. This branch is kept up-to-date with the latest changes and includes upstreamed scripts that are essential for a smooth build process.
```shell
repo init -u https://android.googlesource.com/kernel/manifest -b common-android-mainline --depth 1
```
This branch is particularly advantageous because it includes:
* **Latest Compilation Tools**: Ensures you have the most recent versions of tools required for kernel builds.
* **Upstreamed Scripts**: Contains updated scripts that streamline various stages of the build process, from kernel configuration to image generation.
* **Boot Image Generation**: Provides tools necessary for creating boot images directly from the compiled kernel.
* **Kernel ABI and Symbol Generation**: Includes utilities for generating ABI symbols, which are critical for ensuring compatibility with the Android ecosystem.
* **Distribution and Artifacts**: Facilitates the creation of distribution artifacts, making it easier to package and deploy your kernel.

After Sync, the new source tree should look like:
```text
~/kernel/mainline# tree -L 1
.
├── build
├── common
├── common-modules
├── external
├── kernel
├── MODULE.bazel -> build/kernel/kleaf/bzlmod/bazel.MODULE.bazel
├── prebuilts
├── test
└── tools

8 directories, 1 file
```
Once the source tree is set up, the next step is to replace the `common` directory with your custom kernel source.
After doing this, you can proceed to write or modify the `BUILD.bazel` file to tailor the build process to your specific kernel.To compile the kernel target

### Start the build
To initiate the build process for your custom kernel using Bazel:
```shell
tools/bazel build //common:kernel_billie
```
* `tools/bazel`: This specifies the path to the Bazel executable or script that we will use to run the build.
* `build`: This Bazel command triggers the build process for the specified target.
* `//common:kernel_billie`: This is the Bazel target you are building.
In this case, `kernel_billie` is the target defined in the `BUILD.bazel` file located in the `common` directory.

This will start the compilation process.

![](/assets/images/posts/Using-AOSP-Kernel-Build/bazel-start.png)

### Porting a Downstream Version 4.19 Kernel to Bazel
When I attempted to port a 4.19 downstream kernel to Bazel, I encountered several challenges:
* **Missing Bazel Support**: The kernel version didn't natively support Bazel, so I had to manually create `BUILD.bazel` files for various components.
* **Toolchain Compatibility**: Ensuring that the toolchain definitions in the Bazel files matched the kernel's requirements was tricky, especially when dealing with older versions of Clang or GCC.
* **Dependency Management**: Some external kernel modules and dependencies required additional customization to work with Bazel.

#### Successful Compilation
* If everything is configured correctly, the build should complete without errors, and the kernel image will be successfully compiled.

![](/assets/images/posts/Using-AOSP-Kernel-Build/bazel-end.png)

For those interested in diving deeper, I encourage you to explore the official Bazel documentation, which provides extensive resources on setting up and customizing Bazel builds. Ill put everything in references, or you can mail me to ask specific things.

### Tips & Tricks:
* When setting up your own kernel build definitions and Bazel configurations, it's beneficial to refer to the Pixel kernel manifest repositories and their associated `build.config.pixel` files. These resources are maintained by Google and provide a robust base for writing your custom build definitions and Bazel declarations.

### References:
* Kernel Manifest
    * [android-msm-billie-4.19][km-billie]
    * [linux-sunny][km-sunny]
    * [android-msm-ginkgo-4.14][km-ginkgo]
* Kernel Trees:
    * [linux-oneplus-billie][kt-billie]
    * [kernel_xiaomi_ginkgo][kt-ginkgo]
* [AOSP Kernel Build][akb]
* [Build with Bazel][bwBazel]

Let me know your new experiences at [my email][email].

[kmanifest]: https://android.googlesource.com/kernel/manifest/+refs
[akb-billie-configs]: https://github.com/stormbreaker-project/linux-oneplus-billie/commit/bc0d710d79324ca2654ae5e0d9b7ce35cf7e41e4
[kleaf-docs]: https://android.googlesource.com/kernel/build/+/refs/heads/main/kleaf/docs/build_configs.md
[km-billie]: https://github.com/stormbreaker-project/platform_kernel_manifest/tree/android-msm-billie-4.19
[km-sunny]: https://github.com/aosp-sunny/android_kernel_manifest
[km-ginkgo]: https://github.com/stormbreaker-project/platform_kernel_manifest/tree/android-msm-ginkgo-4.14
[kt-billie]: https://github.com/stormbreaker-project/linux-oneplus-billie/commits/master/
[kt-ginkgo]: https://github.com/stormbreaker-project/kernel_xiaomi_ginkgo/commit/cb1b17ba081806b7568b856903ee1bc385eff726
[akb]: https://source.android.com/docs/setup/build/building-kernels
[bwBazel]: https://android.googlesource.com/kernel/build/+/refs/heads/main/kleaf/docs/impl.md
[email]: mail:saalim.priv@gmail.com