# Dashboard vendor assets

These browser assets are intentionally checked in because the dashboard is a
vanilla ES-module application served directly by the local Pilot process.
Keeping them local avoids a third-party script execution dependency on the
remote-control surface.

| File | Package | Version | License |
| --- | --- | --- | --- |
| `marked.umd.js` | `marked` | 18.0.10 | MIT |
| `purify.min.js` | `dompurify` | 3.4.14 | Apache-2.0 or MPL-2.0 |
| `qrcode.js` | `qrcode-generator` | 2.0.4 | MIT |

Update the exact development dependency with Bun, copy the matching browser
distribution into this directory, and run the dashboard security tests.
