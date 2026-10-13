/** The device has a camera the app can open itself (not just the file picker). */
export const hasLiveCamera = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
