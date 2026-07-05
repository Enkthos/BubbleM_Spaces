# Bubble M

A small, mobile-first browser audio recorder, editor, and device handoff tool.

## Run locally

The shared-session API needs PHP. When this project is inside XAMPP's `htdocs`,
open:

`http://localhost/Methx/BubbleM_spaces/`

Microphone access requires `localhost` or HTTPS.

### Testing on a phone

Opening an address such as `http://192.168.x.x/...` from a phone is **not** a
secure context, so mobile Safari and Edge will not expose the microphone.
Serve the app from a valid `https://` address and open it directly in the
browser. If the app is embedded in an iframe, that iframe must explicitly allow
microphone access.

## Features

- Records from the device microphone
- Visual waveform with adjustable in/out points
- Preview of the selected cut
- Optional fade-in, fade-out, and volume normalization
- Local 128 kbps MP3 export
- Six-character shared sessions for phone-to-computer handoff
- Server-backed audio upload, playback, and download

## Shared-session storage

Session audio is stored under `storage/sessions` and served only through
`api.php`. Sessions expire after 24 hours and each upload is limited to 25 MB.
The session code is the access key, so share it only with the intended person.

Recordings stay in browser memory unless the user explicitly sends them to a
shared session. MP3 encoding runs in the browser through `lamejs`, loaded from
jsDelivr.
