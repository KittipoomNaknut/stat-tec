// TypeScript's lib only has the worker-side MediaStreamTrackProcessor. Chromium also
// exposes it on window, taking the track in the constructor.
// https://w3c.github.io/mediacapture-transform/

interface MediaStreamTrackProcessorInit {
  track: MediaStreamTrack;
}
