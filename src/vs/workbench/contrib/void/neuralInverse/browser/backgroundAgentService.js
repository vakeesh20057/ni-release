// Shim: re-exports IBackgroundAgentService from its actual location.
// The React bundles (tsup) externalize this import at the wrong depth.
export { IBackgroundAgentService } from '../../../neuralInverse/browser/backgroundAgentService.js';
