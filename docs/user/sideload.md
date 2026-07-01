# Sideloading

RokDock can install a Roku channel package directly to a device without going through the Roku developer web interface. The package is POSTed to the device's `/plugin_install` endpoint using HTTP Digest authentication, the same mechanism the Roku developer portal uses.

## Prerequisites

Before the Sideload App option becomes active, both of the following must be true for the target device:

- **Developer Mode is enabled on the device.** Enable it by following the [Roku developer mode instructions](https://developer.roku.com/docs/developer-program/getting-started/developer-setup.md) (enter the Roku secret screen sequence from the home screen). RokDock detects developer mode automatically during device discovery.
- **Developer credentials are saved in Device Properties.** Open Device Properties for the device (via the device card dropdown) and enter the username and password you set when you enabled developer mode. See [Devices](devices.md) for how to open Device Properties.

If either condition is not met, the Sideload App option appears dimmed in the device card dropdown. Hovering over it shows a tooltip explaining which requirement is missing.

## How to Sideload

1. Expand a device card in the Devices panel.
2. Open the card dropdown and click **Sideload App...**
3. In the dialog, click **Choose...** to open the system file picker. The picker is filtered to `.zip` files by default. `.pkg` files are also accepted if you select one via "All Files".
4. Confirm the correct device is shown in the Target row.
5. Click **Install** to upload the package.

The dialog cannot be closed while an upload is in progress. The Install and Cancel/Close buttons are disabled until the operation completes.

## Sideload Dialog

The dialog contains:

- **Target row**: the device name (or nickname) and IP address. This is set when you open the dialog and does not change.
- **File picker zone**: shows the selected filename in monospace once a file is chosen, or "No .zip selected" before one is picked. The zone border changes to a solid accent color when a file is selected.
- **Progress bar**: visible only while installing. Displays a status label ("Uploading..." for the first ~95% of transfer, then "Processing..." while the device processes the package) and a percentage counter.
- **Result panel**: appears after the install completes. A green left border and "Installed" heading indicate success. A red left border and "Failed" heading indicate an error.

### On success

The result panel shows "Installed" and the response message returned by the device. Click **Close** to dismiss the dialog.

### On failure

The result panel shows "Failed" and the error message. You can select a different file and click **Install** again to retry, or click **Close** to dismiss.

If the error message indicates that no credentials are configured, an inline link labeled "Set credentials in Device Properties" appears. Clicking it closes the sideload dialog and opens Device Properties for the target device.

## Package Format

Roku sideload packages must be `.zip` archives built by the Roku SDK (BrightScript/SceneGraph source tree compressed as a flat `.zip`, not a nested folder). The file picker defaults to showing `.zip` files. Signed `.pkg` files are also accepted by the installer if you navigate to one manually.

## How It Works

RokDock reads the selected file from disk, retrieves the developer credentials stored for the target device, and uploads the archive to `http://<device-ip>/plugin_install` as a multipart POST. Authentication uses HTTP Digest with the username and password from Device Properties. Upload progress is reported back to the dialog in real time and displayed as a percentage. The device processes the package and returns a result message which RokDock surfaces in the result panel.

## Related

- [Devices](devices.md) - device card actions, Device Properties, and credential configuration
- [Settings](settings.md) - device and port configuration
