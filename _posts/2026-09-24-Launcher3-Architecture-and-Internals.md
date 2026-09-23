---
layout: post
title: "Launcher3: Architecture and Internals"
date: 2026-09-24 00:00:01 +0530
categories: [AOSP]
tags: [Android, AOSP, Launcher3, Frameworks, SystemUI]
description: "The app you touch a hundred times a day and almost never read"
author: danascape
toc: true
---

## What this is?

Notes from a year of carrying Launcher3 patches across Android releases. Not a tutorial on writing a launcher, more like **the map I wish someone had handed me** before I started rebasing this thing every six months.

Ain't gonna explain "what is a home screen".

## Launcher3 is not an app drawer

The first thing that surprised me is how much of the Android experience actually lives inside this one app. It is not one screen. It is **six surfaces living in one process**, and you move between them constantly without noticing:

- **Home / Workspace** — pages of icons, folders, the hotseat
- **All Apps** — the drawer and its search box
- **Widgets** — other apps drawing inside yours
- **Overview** — Recents, live system tasks
- **Taskbar** — on tablets, always on screen
- **The -1 screen** — the odd one out, which gets its own post

![](/assets/images/posts/Launcher3-Internals/workspace.png)

Recents is the one that trips people up. It is **not** a system screen. The launcher renders your live tasks.

![](/assets/images/posts/Launcher3-Internals/overview.png)

## The source split

Before reading any code, look at how the tree is divided. This tells you more than any doc:

```bash
packages/apps/Launcher3
├── src/            # the launcher proper
├── quickstep/      # the half that needs platform privileges
├── src_plugins/    # interfaces only, the plugin seam
└── ...
```

Rough numbers from the Android 17 tree I work in:

| directory | files | lines |
|---|---|---|
| `src/` | 780 | ~146,000 |
| `quickstep/src/` | 619 | ~158,000 |
| `src_plugins/` | 9 | **434** |

That last row is not a typo. Around **300,000 lines of launcher, and the entire plugin surface is 434 lines**. Everything that is allowed to plug in from outside Launcher3 goes through those nine files. Keep that number in your head, it becomes important in the next post.

The `src/` vs `quickstep/` split is the practical one. `src/` builds without system privileges. `quickstep/` links against SystemUI's shared libraries and will not build unless you are on the platform. If your change does not compile and you cannot work out why, check which half you are in.

## A mental model

Six names get you oriented in any Launcher3 tree, from any Android version.

On the view side:

- **`Launcher`** — the Activity. Around 2,900 lines of lifecycle and wiring.
- **`Workspace`** — the pager that holds your home screens
- **`DragLayer`** — sits above everything, owns anything you can drag

And the three things that drive them:

- **`LauncherModel`** — what exists (apps, shortcuts, widgets, the database)
- **`DeviceProfile`** — how big everything is, derived per device and posture
- **`StateManager`** — which surface is showing (`NORMAL`, `ALL_APPS`, `OVERVIEW` …)

Views on the left, drivers on the right. **Most launcher bugs you will chase are a state that disagrees with a profile.** I will come back to that.

## What happens when you unlock

This is the part I find genuinely well designed, and it explains why unlock feels instant.

1. **Activity starts** — inflate the views, work out the grid for this device
2. **Loader wakes up** — a worker thread opens the launcher database
3. **Load in stages** — workspace first, then all apps, then shortcuts, then widgets
4. **Bind and draw** — items come back to the UI thread, first frame

The staging is deliberate and it is visible in the code. `LoaderTask` literally logs its own phases:

```java
logASplit("step 1 loading workspace complete");
logASplit("step 2 loading AllApps complete");
logASplit("step 3 loading all shortcuts complete");
```

Your home screen is drawable before the app drawer has finished loading. You can watch these in a systrace if you want to see where your boot time actually goes.

<video src="/assets/images/posts/Launcher3-Internals/workspace-nav.mp4" controls muted loop width="320"></video>

## The workspace is a grid of grids

The view hierarchy is simpler than it looks once you see the nesting:

```
Workspace            the pager
  CellLayout         one page, a fixed grid
    a cell           icon, folder or widget
Hotseat              a CellLayout that never scrolls
```

Three things follow from this:

- Every page is the **same grid**, sized by `DeviceProfile`
- A **folder** is just a cell that opens into another grid
- **Drag and drop** lifts a view into the `DragLayer`, which sits above everything

That last one is why the drag target chrome renders over your pages rather than inside them:

![](/assets/images/posts/Launcher3-Internals/drag-widget.png)

And All Apps is its own surface, not a workspace page:

![](/assets/images/posts/Launcher3-Internals/all-apps.png)

## The launcher is not an island

This is the bit that surprises people who have only read `src/`.

Launcher3 and SystemUI are in constant conversation:

- **Recents is not a system screen.** The launcher renders your live tasks.
- **Swipe-up-to-home** is a SystemUI gesture handed to launcher code mid-animation.
- That handoff is exactly **why the `quickstep/` half needs platform privileges to build at all**.

If you are forking Launcher3 for a ROM, this is the coupling that will bite you on every platform bump. Your launcher does not fail alone, it fails together with whatever SystemUI shipped that release.

## Things that actually bite

A short list of what has cost me the most time:

**Grids and `DeviceProfile`.** Stay scared of these. Every dimension on screen comes out of a profile, and profiles are derived per device, per posture, per display size. A change that looks right on your phone will look wrong on a tablet, in landscape, or with a non-default display size. Database migration between grid sizes is its own special pain.

**State transitions.** When something looks visually broken, my first check is no longer the view code. It is which `LauncherState` we are in and which `DeviceProfile` was active when the layout ran.

**Upstream changes that do not conflict.** This one deserves its own paragraph. Git only warns you about lines *you* edited. It says nothing about call sites you depend on. I have had a patch rebase perfectly clean, compile, boot, and do nothing at all, because upstream deleted the call site that used to invoke my code. More on this in the next post, where it happened to me for real.

## Where to start reading

If you want to actually go through the source, this order worked for me:

1. `Launcher.java` — read `onCreate` end to end, ignore everything else
2. `LoaderTask.java` — follow the three steps
3. `DeviceProfile.java` — skim it, then keep it open forever
4. `Workspace.java` and `CellLayout.java` — the grid
5. `src_plugins/` — all 434 lines, it takes ten minutes

Step five is the one nobody does, and it is the one that opens up the **-1 screen**, which is where I have spent most of my time lately.

That is the next post: what actually sits to the left of your home screen, what is inside `libGoogleFeed.jar`, and how to replace it with something you wrote yourself.

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

[launcher3]: https://android.googlesource.com/platform/packages/apps/Launcher3
[build-numbers]: https://source.android.com/docs/setup/reference/build-numbers
[email]: mailto:saalim.priv@gmail.com
