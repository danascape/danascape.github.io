---
title: "LFX Mentorship for Linux Kernel Bug Fixing"
date: 2023-07-27 00:00:00 +0530
---
Learn more about the Linux Foundation Mentorship programme, and hear from someone who went through the process.

![](img/lfx_logo.png)

## What is LFX mentorship?
*"The Linux Foundation Mentorship Program is designed to help developers — many of whom are first-time open source contributors — with necessary skills and resources to learn, experiment, and contribute effectively to open source communities. By participating in a mentorship program, mentees have the opportunity to learn from experienced open source contributors as a segue to get internship and job opportunities upon graduation."*

Please have a look at the Mentorship guide to learn how to participate in LFX Mentorship programs: [lfx.linuxfoundation.org/mentorship/guide][lfx-guide]

## Linux Kernel Mentorship Programme (LKMP)
Linux Foundation mentorship programs offer unique opportunities for aspiring developers to contribute to the Linux Kernel, which is the core of the Linux Operating System. The Linux Kernel is an open-source project that continuously evolves through the collective effort of thousands of developers worldwide.

LKMP is one of the programmes run by the Linux Foundation where we get to learn about subsytems inside Linux Kernel and how to contribute to them. Under the mentorship, we got hands-on experience in debugging and resolving issues within the kernel. The program follows a structured approach to ensure participants gain valuable hands-on experience and become proficient in kernel development.

## About Device Tree Bindings

The Device Trees were originally created by Open Firmware as part of the communication method for passing data from Open Firmware to a client program. An operating system used the Device tree to discover the topology of the hardware at runtime, and thereby support a majority of available hardware without hard coded information.

The Device Tree is simply a data structure that describes the hardware. It provides a language for decoupling the hardware configuration from the board and device driver support in the Linux Kernel. Using it allows board and device support to become data driven; to make setup decisions based on data passed into the kernel instead of on per-machine hard coded selections.

## Applying for LFX mentorship
I applied through the [LFX mentorship portal][lfx-portal] where for a particular section you can apply to a **maximum of three projects** where first you have to create your profile, tell a bit about your background and then apply to the projects you want.

I decided to apply for Linux Kernel Mentorship Programme Spring 2023. Here I had to go through a list of different tasks which tests your current knowledge about Linux Kernel, Command-line tools, etc. After completing those tasks and submitting my resume, *I got my selection email for being selected as a mentee for Linux Kernel Mentorship Program*
![](img/lfx-email1.png)
![](img/lfx-email2.png)


## My 12 Weeks Mentorship Journey
My mentorship period was from 1st March 2023 to 31st May 2023. During this period I had to work with Linux Kernel where I had to pick among different subsystems and fix bugs on them.

My mentor, [Shuah Khan][shuahkhan-profile] introduced us with a list of debugging techniques and ways to resolve them. This included using various command-line tools like GDB, event tracing, dynamic analysis of programs, and also the in-famous Google's Syzkaller. With the help of my mentor, I learnt about various subsystems in the linux kernel, from where I chose to contribute to the conversion of Device Tree Bindings to YAML format.

Every week, I used to have a meeting with my mentors other than having discussions on the communication channel with other mentees where we discussed about our subsystems and policies.

And finally, I ended up submitting 13 patches as part of the mentorship program.

## In the End
Apart from the bug fixing, I also learned few other interesting things about the Linux kernel and its developer community, like how we test various changes in the kernel and why we strictly use plain text emails.

My mentorship program experience has been fantastic, and I recommend it to everyone interested in pursuing Linux Kernel development and looking for mentorsing.

I am heartily thankful to my mentor Greg KH, Shuah Khan and The Linux Foundatioon, for providing me with this opportunity and a great learning experience.

Patches can be found on [https://lore.kernel.org/lkml/?q=danascape][lore-saalim]

Let me know your experience with reading this blog at my [email][email].

[lfx-guide]: lfx.linuxfoundation.org/mentorship/guide
[lfx-portal]: https://lfx.linuxfoundation.org/tools/mentorship/
[lore-saalim]: https://lore.kernel.org/lkml/?q=danascape
[shuahkhan-profile]: https://mentorship.lfx.linuxfoundation.org/mentor/5b5c6ac7-5735-4ed6-9666-4ddd0a140c0c
[email]: mail:danascape@gmail.com