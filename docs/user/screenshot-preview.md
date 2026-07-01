# Screenshot Preview

RokDock includes a dedicated screenshot preview window for capturing and inspecting device screenshots. The preview opens as a separate window with its own toolbar, zoom controls, measurement tools, and comparison overlay support.

![The Screenshot Preview window showing a captured device frame (a channel grid UI): the top toolbar with refresh, auto-refresh, save, copy, measure, overlays, capture-feed, and history controls, a Full HD safe-zone overlay with measurement guides over the image, and the zoom dock with the zoom and comparison-opacity sliders at the bottom](images/screenshot-preview.png)
*The Screenshot Preview window with a captured device frame, a safe-zone overlay and measurement guides applied, and the zoom and comparison controls in the bottom dock.*

![The Screenshot Preview with the Overlays dropdown open over a device frame: the menu shows Load image, Built-in, Recent, and Screenshot History, with the Built-in submenu expanded to TV safe zones, Rule of thirds, Aspect ratio, and Column grid (each in 1080p and 720p), alongside the comparison-opacity slider in the bottom dock](images/screenshot-preview-overlay.png)
*The Overlays dropdown open, with the Built-in overlay choices and the comparison-opacity slider. A safe-zone overlay is applied over the captured frame.*

## Opening the Preview

- Click the camera button in the Remote panel header.
- A device must be selected. The button is enabled as soon as a device is selected.
- Capturing a screenshot requires developer credentials stored for that device. RokDock uses HTTP Digest authentication with a POST to the device's `/plugin_inspect` endpoint to trigger the capture, then downloads the resulting image.
- The camera button tooltip shows the active app context. If the dev app is active, the tooltip notes that copy and overlay controls are available in the preview window.
- If credentials are missing or invalid, a toast appears with a shortcut to Device Properties and an option to open the screenshot window anyway.

## Window Layout

- **Toolbar** (top): refresh, auto-refresh toggle, interval selector, save, save-with-overlay, copy, copy-with-overlay, measure tool, overlay loader, capture-feed toggle, history
- **Viewport** (center): scrollable image display with zoom and pan support
- **Zoom dock** (bottom center): zoom controls and comparison overlay controls
- **Countdown** (bottom right): auto-refresh countdown timer

The zoom dock and countdown timer dim automatically when they overlap the image, and restore on hover.

## Toolbar Actions

### Refresh

- Click the refresh button to capture a new screenshot.
- The button shows a loading spinner during capture.
- Refreshing requires that the active app on the device is "dev". If a different app is active, a toast reports that refresh is unavailable.

### Auto-Refresh

- Toggle auto-refresh on/off with the switch.
- Interval dropdown: `5s`, `15s`, `30s` (default), `45s`, `60s`, `90s`, `120s`.
- The interval selector is disabled while auto-refresh is off.
- The countdown timer (bottom right) shows seconds remaining until the next capture.
- Auto-refresh pauses if the active app is no longer "dev". The countdown changes to "Auto-refresh paused (dev app not running)".

### Save

- **Save As...** - saves the screenshot to a file, preserving the original PNG or JPEG format.
- **Save with overlay** - composites the screenshot with the comparison overlay at the current opacity and exports as PNG. Disabled until an overlay is loaded.

### Copy

- **Copy screenshot** (`Ctrl+C`) - copies the screenshot only (no overlay) to the clipboard.
- **Copy with overlay** (`Ctrl+Shift+C`) - copies the composited screenshot and overlay to the clipboard. Disabled until an overlay is loaded.

### Capture Feed

A video-camera icon in the toolbar switches the viewport to a live capture device feed (requires a capture device configured in Settings). In capture mode:

- Auto-refresh controls are hidden.
- The refresh button captures a still frame from the video feed.
- Zoom, pan, and measurement all continue to work on the live feed.
- Click the button again to return to screenshot mode.

## Zoom Controls

Located in the zoom dock at the bottom of the window.

- **Zoom slider**: 10% to 300%
- **Zoom pill**: displays the current zoom percentage
- **1:1 button**: resets zoom to 100%
- **Fit to window**: auto-fits the image to the viewport
- `Ctrl + mouse wheel` zooms in/out (approximately 1.1x per step)
- Zoom snaps to 100% when within +/-2%

When the image is larger than the viewport, click and drag to pan.

## Measurement Tool

Toggle with the ruler button in the toolbar.

- Activates crosshair cursor.
- Click and drag on the image to measure pixel distances.
- Hold `Shift` to constrain to horizontal or vertical axis only.
- Displays dimensions in a label overlay:
  - Horizontal only: "X px (horizontal)"
  - Vertical only: "Y px (vertical)"
  - Diagonal: shows delta-x, delta-y, and diagonal distance
- Tick marks appear every 20 image pixels on longer measurements.
- After drawing a measurement, drag either endpoint to adjust it.
- Press `Escape` to clear the measurement and exit measure mode.
- Loading a new screenshot clears the active measurement automatically.

## Comparison Overlay (Onion Skin)

Overlay a semi-transparent reference image over the current screenshot to compare UI against a design mockup or a previous state.

### Loading an overlay

Two entry points load an overlay:

1. Click the layer-group icon in the toolbar to open the file picker directly.
2. Use the **Overlays** dropdown in the zoom dock, which has four sections:
   - **Load image...** - opens a file picker (PNG, JPG, WEBP, GIF, BMP)
   - **Built-in** - pre-defined overlays:
     - TV safe zones (1080p / 720p)
     - Rule of thirds (1080p / 720p)
     - Aspect ratio (1080p / 720p)
     - Column grid (1080p / 720p)
     - 4-column grid (1080p / 720p)
   - **Recent** - up to 20 custom overlays loaded previously (most recent first)
   - **Screenshot History** - load any previous screenshot as the overlay for side-by-side comparison

### Overlay controls

- **Opacity slider**: 0% (transparent) to 100% (opaque), default 50%
- **Clear button** (X icon): removes the loaded overlay
- The overlay auto-sizes to match the screenshot dimensions.
- A loaded overlay unlocks the **Save with overlay** and **Copy with overlay** actions.

### Overlay persistence

Custom overlay files are copied to a persistent directory inside RokDock's app data folder so that Recent entries survive file moves and deletes. Built-in overlays are embedded in the app binary and appear only under the Built-in section, never in Recent.

## Screenshot History

- The History button in the toolbar opens a dropdown of recent captures.
- Stores up to 20 screenshots.
- Each entry shows a thumbnail and a timestamp.
- Pixel-identical screenshots are deduplicated (the newest entry is kept).
- Click an entry to load that screenshot at the current zoom level.
- History persists across sessions.

## Context Menu

Right-click inside the viewport for a context menu containing:

- Load comparison overlay...
- Clear comparison overlay (enabled only when an overlay is active)
- Copy screenshot (no overlay)
- Copy screenshot with overlay (enabled only when an overlay is active)
- Refresh
- Save
- Save with overlay (enabled only when an overlay is active)
- Auto-Refresh submenu: Disabled, 5s, 15s, 30s, 45s, 60s, 90s, 120s
- Screenshot history submenu (appears only when history exists)

## Native Menu Bar

The preview window has a native menu bar (hidden by default on Windows, revealed with `Alt`).

- **File:** Save, Save with Overlay, Copy, Copy with Overlay, Close
- **View:** Refresh, Load Comparison Overlay, Clear Overlay

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Copy screenshot (no overlay) |
| `Ctrl+Shift+C` | Copy screenshot with overlay |
| `Escape` | Clear measurement / exit measure mode |
| `Ctrl + scroll` | Zoom in/out |

## Persistence

The following preferences persist across sessions:

- Zoom level (default: 100%)
- Auto-refresh enabled (default: off)
- Auto-refresh interval (default: 30s)
- Comparison overlay opacity (default: 50%)
- Recent overlays list (max 20)
- Screenshot history (max 20)

The active comparison overlay is not restored on reopen (it always starts cleared).

## Theme Integration

The preview window follows the app's current light/dark theme.

## Related

- [Remote Control](remote-control.md) - camera button and device selection
- [Devices](devices.md) - configuring developer credentials
