/**
 * Lazy official Excalidraw runtime. This module is bundled into a separate
 * page-served chunk and executed only when an Excalidraw document body mounts.
 * React and ReactDOM come from the shared page module table through the build
 * shim; the official CSS is loaded as a separately scoped stylesheet.
 */
import {
  Excalidraw,
  exportToBlob,
  exportToSvg,
  getSceneVersion,
  serializeAsJSON,
} from '@excalidraw/excalidraw'

window.EXCALIDRAW_ASSET_PATH = new URL('api/excalidraw-assets/', document.baseURI).href

export {
  Excalidraw,
  exportToBlob,
  exportToSvg,
  getSceneVersion,
  serializeAsJSON,
}
