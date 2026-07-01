# Script Editor

RokDock includes a Script Editor for creating and running automation scripts against Roku devices. Scripts are sequences of typed steps that execute via ECP (External Control Protocol). Open it from **Tools > Script Editor** in the menu bar. The editor opens in a separate window. It also opens on its own outside the dock, via its installer shortcut, by double-clicking a `.rasp` or `.rscript` file, or with `RokDock --tool script [path]`. See [Launching Tools Directly](getting-started.md#launching-tools-directly).

![Script Editor window showing a Steps list with PRESS Home, PAUSE, LAUNCH app:12, SCREEN, and PLAYER steps; toolbar with New, Save, Import, Export, Paste RASP, Copy RASP, Record, Play, and Stop buttons; Record Delays toggle and Key Wait control above the step list; and Variables and Scripts panels on the right sidebar.](images/script-editor.png)
*The Script Editor with a sample script loaded and the Scripts library open in the right panel.*

![The Script Editor running a script against a device: the step list shows step 1 (Press Home) complete and step 2 (Pause) running, the device bar has the Roku Ultra selected with the embedded remote, and the execution log at the bottom streams "Starting playback", "Running step 1", "Step 1 complete", "Running step 2"](images/script-editor-running.png)
*A script executing against a device. The completed step shows a check, the running step is marked, and the execution log streams progress at the bottom.*

## Scripts

Scripts are JSON-based automation sequences stored in the Electron userData `scripts/` directory. Each script contains:

- A name
- Metadata (variables, default keypress wait, channel info)
- An ordered list of steps

Scripts are saved as `.rscript` files (older `.rscript.json` files are still read). The library supports reordering, bulk delete, and persistent sort order.

## Step Types

### Input and Control

| Step | Description |
|------|-------------|
| **Press** | Send a single remote key press (Home, Select, Right, etc.) |
| **Key Down / Key Up** | Hold or release a key (added automatically during recording; not in the Add step picker) |
| **Text** | Send text input (supports `${variable}` token substitution) |
| **Delay** | Wait for a specified duration in milliseconds |
| **Launch** | Start a channel by channel ID |

### Control Flow

| Step | Description |
|------|-------------|
| **Loop** | Repeat nested steps N times (iteration count is editable inline in the step list) |
| **Block** | Define a named reusable group of steps |
| **Block Ref** | Insert a reference to a previously defined block |

### Validation and Streaming

| Step | Description |
|------|-------------|
| **Wait Player State** | Poll until the player reaches a target state (play, pause, stop, buffering, finished) |
| **Validate Streaming** | Assert that audio/video codecs and DRM type match expectations |
| **Wait Active App** | Poll until a specific app becomes active (RokDock-only, no RASP equivalent; available via RASP/JSON import, not the Add step picker) |
| **Assert Query** | Query an ECP endpoint and verify a field value (RokDock-only, no RASP equivalent; available via RASP/JSON import, not the Add step picker) |
| **Channel Tile Order** | Verify the home screen app tile order |

### Meta

| Step | Description |
|------|-------------|
| **Screenshot** | Certification snapshot marker. This step is a no-op at runtime; it does not capture an image. |
| **Comment** | User annotation (exports as a `#` comment in RASP; no-op at runtime) |

In the step list and Add step picker, some steps show short labels: Delay appears as PAUSE, Screenshot as SCREEN, Wait Player State as PLAYER, Validate Streaming as VALIDATE, and Channel Tile Order as TILES.

## RASP Compatibility

Scripts can be imported from and exported to RASP (Roku Automation Script Protocol) YAML format using the Import and Export toolbar buttons. You can also paste RASP YAML directly from the clipboard using the Paste RASP button, or copy the current script as RASP YAML using the Copy RASP button.

The following step types round-trip through RASP without data loss: `press`, `text`, `delay`, `screenshot`, `launch`, `loop`, `waitPlayerState`, `validateStreaming`, `channelTileOrder`, and `comment`. All other step types (block, block-ref, waitActiveApp, assertQuery) are RokDock-only extensions. Steps that have no RASP equivalent generate warnings on export.

## Editor Layout

### Toolbar

Left to right:

- **New** (plus icon): create a new empty script
- **Save** (floppy icon): save the current script
- **Import / Export**: import a RASP YAML file from disk or export the current script to RASP YAML
- **Paste RASP / Copy RASP**: paste RASP YAML from the clipboard or copy the current script as RASP YAML to the clipboard
- **Record** (circle icon): start recording key presses from the remote panel
- **Play / Stop**: execute or halt the script

The script name is displayed at the right end of the toolbar and can be clicked to rename it inline.

### Step List Header

Immediately above the step list, the header row contains:

- A step count badge
- **Record Delays** checkbox: when checked, pauses between key presses are recorded as Delay steps during recording
- **Key Wait** control: the default delay applied after each key press during playback (in seconds); this is a per-script metadata field
- **Add step** button: opens the step type picker

### Device Bar

A dropdown at the top of the right panel selects the target Roku device by IP. Selecting a device connects the embedded remote and populates the live app list.

### Step List (left column)

- Add, duplicate, and delete steps
- Each step shows a color-coded type chip, a property summary, and a status indicator during execution
- Drag handles appear on hover for reordering
- Keyword filter to narrow the list by name or type
- Loop and block steps can be collapsed
- Select multiple steps to wrap them in a Loop or Block, or delete them in bulk

### Step Editor (right column)

Selecting a step opens a dynamic form on the right side of the step list:

- Text fields, dropdowns, and toggles for step-specific properties
- A checkbox to skip or disable the step
- An `onError` sub-section to attach recovery steps that run if the step fails

### Execution Log (collapsible)

Appears at the bottom of the step list during playback:

- Real-time event stream
- Color-coded status: green (complete), red (failed), yellow (running)
- Hierarchical step labels preserve nesting context (for example, "3.2.1")

## Execution

When you click **Play**:

1. Steps execute sequentially from top to bottom.
2. Before most steps, the engine pings the device to verify connectivity. Delay, screenshot, comment, and block steps skip the ping.
3. The keypress wait delay (set in the step list header) is applied after each key press.
4. Text steps perform variable substitution using the script's metadata variables.
5. If a step fails, its `onError` chain runs if defined. Otherwise the script stops.
6. Click **Stop** to halt execution at any point.

Execution logs are saved as JSON files to the Electron userData `scripts/logs/` directory.

## Recording

Click the **Record** button to enter recording mode. Key presses made on the embedded remote panel are captured as Press steps. Hold actions record as Key Down, Delay, Key Up sequences.

Enable **Record Delays** in the step list header before starting a recording session to also capture the time between key presses as Delay steps. The recorded duration is rounded to the nearest 100 ms.

While recording is active, the toolbar switches to a recording indicator pill (showing elapsed time and step count) and the Play button is disabled.

## Variable Substitution

Text steps support `${variableName}` tokens. Define variables in the Variables panel in the right sidebar. At runtime, each token is replaced with its configured value. Variables that appear in Text steps are automatically detected and added to the Variables panel.

## Script Library

The Scripts panel in the right sidebar lists all saved `.rscript` scripts (and any older `.rscript.json` ones). Click any entry to load it. Scripts can be reordered by dragging and deleted individually. The sort order is persisted.

## Related

- [Remote Control](remote-control.md) - ECP remote actions
- [Devices](devices.md) - device selection and credentials
- [Settings](settings.md) - general configuration
