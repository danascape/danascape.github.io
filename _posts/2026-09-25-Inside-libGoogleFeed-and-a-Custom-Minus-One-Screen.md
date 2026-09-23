---
layout: post
title: "Inside libGoogleFeed, and Writing My Own -1 Screen"
date: 2026-09-25 00:00:01 +0530
categories: [AOSP]
tags: [Android, AOSP, Launcher3, Reverse Engineering, Frameworks]
description: "The panel to the left of your home screen is another app's window"
author: danascape
toc: true
---

## What this is?

Part two of the [Launcher3 post][launcher3-internals]. That one was the map. This one is the part I actually went down a hole for: **what sits to the left of your home screen**, what is inside the jar every ROM ships to get it, and what it takes to replace that jar with something you wrote.

## Whose code runs when you swipe?

Swipe past the first home screen and a panel slides in. Quick question: **whose code just drew that?**

Not the launcher's.

This took me longer to accept than it should have. I kept looking for the view. There is no view.

## Why -1 is not just another page

Put the two side by side:

| | A workspace page | The -1 panel |
|---|---|---|
| What it is | a `CellLayout` in your view tree | not a view at all |
| Where it lives | rows in the launcher database | not in the model |
| Whose process | yours | **another app entirely** |

The launcher never draws the panel. It only **forwards your finger**, and gets back a number saying how far open the panel is.

## AOSP ships the socket and no plug

Remember those 434 lines in `src_plugins/` from the last post? This is what they are for.

Launcher3 defines the entire overlay contract, and then implements none of it. The default is literally an empty object:

```java
protected LauncherOverlayManager getDefaultOverlay() {
    return new LauncherOverlayManager() { };
}
```

That is it. That is the whole extension point. **Override that one method and the -1 screen is yours.**

Every OEM feed, every custom launcher's left panel, goes through this. AOSP ships you the socket and no plug.

## The protocol

The overlay lives in another process, so the two sides talk over binder:

- **The interface** — `ILauncherOverlay.aidl`, 17 methods. Scroll, attach, detach, open, close, activity state.
- **The handshake** — the launcher binds an intent with action `com.android.launcher3.WINDOW_OVERLAY` and data `app://<launcher-package>:<launcher-uid>`. The provider checks that pair against the calling UID before handing back a binder.
- **The negotiation** — a `service.api.version` meta-data tag on the service. The client gates features on it: version 3 unlocks `windowAttached2`, 4 unlocks `setActivityState`, 7 unlocks `redraw`.

Nothing about that is Google-specific. It is a versioned, authenticated, plain AIDL service. Only the implementation on the other end is closed.

## Inside libGoogleFeed.jar

Most ROMs ship Google's feed by dropping in a prebuilt jar and wiring a config flag. I wanted to know what was actually in it, so I pulled it apart.

Decompiled it is about **1,300 lines**, and half the class names are single letters:

```bash
com/google/android/libraries/gsa/launcherclient/LauncherClient.java
com/google/android/libraries/gsa/launcherclient/a.java
com/google/android/libraries/gsa/launcherclient/b.java
com/google/android/libraries/gsa/launcherclient/c.java
...
com/google/android/libraries/a/a.java   # ILauncherOverlay, obfuscated
com/google/android/libraries/a/c.java
```

The obfuscated interface is exactly what you would expect once you line it up:

```java
public interface c extends IInterface {
    void d() throws RemoteException;                  // startScroll
    void e(float f) throws RemoteException;           // onScroll
    void f() throws RemoteException;                  // endScroll
    void g(WindowManager.LayoutParams p, e cb, int i) // windowAttached
    ...
}
```

And here is the part that made the whole thing click. Compare the jar against the open-source client:

| | Google's jar | Open-source client |
|---|---|---|
| Bind action | `com.android.launcher3.WINDOW_OVERLAY` | `com.android.launcher3.WINDOW_OVERLAY` |
| Interface descriptor | `com.google.android.libraries.launcherclient.ILauncherOverlay` | same string, exactly |
| Talks to | `com.google.android.googlequicksearchbox`, hardcoded | any package you point it at |

**Same door, same handshake.** The jar is not magic. It is a client, hardcoded to one provider, and you can write your own.

(For the curious: the jar negotiates a newer protocol than the open client does, `v10/cv19` against `v7/cv9`. The handshake itself is identical, which is exactly why a from-source client works at all.)

## Building my own

So I did. The project is split the way you would expect:

```
Launcher3Feed
├── core/          # reusable overlay base
├── google-gsa/    # the server side of ILauncherOverlay
└── helloworld/    # a minimal provider, ~5 lines of glue
```

The provider side is four steps:

1. **Export a service** — answer the overlay action, declare your api version
2. **Check the caller** — the launcher names its package and UID, verify both
3. **Own a window** — the launcher passes its `LayoutParams`, you add your panel beside it
4. **Fill it** — anything you like

The sample provider really is this small:

```kotlin
class HelloWorldOverlayService : FeedOverlayService() {
    override fun createOverlay(context: Context): FeedOverlay = HelloWorldOverlay(context)
}

class HelloWorldOverlay(context: Context) : FeedOverlay(context) {
    override fun onCreateContentView(inflater: LayoutInflater, container: ViewGroup): View =
        inflater.inflate(R.layout.overlay_layout, container, false)
}
```

And there it is. No Google app, no prebuilt jar, no network dependency:

<video src="/assets/images/posts/Inside-libGoogleFeed/minus-one-helloworld.mp4" controls muted loop width="320"></video>

Not much to look at yet. But that is *my* window, in *my* process, on the -1 screen.

## Two things that cost me a day each

### AIDL numbers its methods by position

My server was written against a different revision of `ILauncherOverlay` than the launcher was. The interface names matched. The transaction codes did not:

| code | launcher sends | my app ran |
|---|---|---|
| 5 | `windowDetached()` | `requestVoiceDetection()` |
| 6 | `closeOverlay()` | nothing, unhandled |
| 10 | `requestVoiceDetection()` | `windowDetached()` |
| 16 | `setActivityState()` | `closeOverlay()` |

Codes 1 to 4 matched, so **scrolling worked perfectly** and everything else was subtly wrong. Code 16 was the worst: at api version 7 the launcher calls `setActivityState()` on every `onStart`/`onResume`/`onPause`/`onStop`, and my side was running `closeOverlay()` on it. The panel closed itself every time you came back to the launcher.

Lesson: **do not count methods by hand.** Run the aidl compiler and read the generated codes:

```bash
prebuilts/build-tools/linux-x86/bin/aidl -I<dir> -o<out> ILauncherOverlay.aidl
grep TRANSACTION_ out/.../ILauncherOverlay.java
```

Insert one method in the middle of an AIDL and every call after it silently means something else.

### The upstream change that does not conflict

I mentioned this in the last post. Here is the real version.

Moving my overlay patches from Android 16 to 17, git reported four conflicts. All four were easy, mechanical stuff. The change that actually broke the feed produced **no conflict at all**.

Upstream had deleted the `onAttachedToWindow` and `onDetachedFromWindow` calls into the overlay. Lines my patch had never touched, so git had nothing to say.

The effect: `LauncherClient` only sets its `mLayoutParams` inside `onAttachedToWindow`, and every overlay call is gated behind a null check on it. So the client bound fine, connected fine, logged nothing unusual, and drew nothing.

**Conflicts are the changes that announce themselves.** Audit the call sites your patch depends on, not just the lines it edits.

## What is next

The helloworld panel proves the plumbing. The interesting question is what to actually put in it.

What I am chasing now is bridging the **Glanceable Hub** into the -1 screen, so the panel shows the *same widget instances* as the lock screen rather than a second copy. SystemUI already built most of the machinery for this in Android 17, for its own reasons, and it streams `RemoteViews` for widget ids you do not own.

That is a whole post of its own. Once it is not held together with tape.

## If you want to poke at this

The short version for anyone who wants to try:

- Read `src_plugins/`, all 434 lines
- Find `getDefaultOverlay()` in `Launcher.java`
- Write a service that answers `com.android.launcher3.WINDOW_OVERLAY`
- Generate the AIDL, do not trust the method order

The -1 screen is a bound service, not a Google feature. **Anyone can replace it.**

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

[launcher3-internals]: /posts/Launcher3-Architecture-and-Internals/
[launcher3]: https://android.googlesource.com/platform/packages/apps/Launcher3
[email]: mailto:saalim.priv@gmail.com
