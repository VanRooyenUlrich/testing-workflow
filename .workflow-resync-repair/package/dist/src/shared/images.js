import { invariant } from './errors.js';
const pinnedImagePattern = /^(?:[a-z0-9][a-z0-9./:_-]*@)?sha256:[a-f0-9]{64}$/;
export function isPinnedImage(image) {
    return pinnedImagePattern.test(image);
}
export function requirePinnedImage(image) {
    invariant(isPinnedImage(image), 'Immutable repository digest or local image ID required', 'IMAGE_UNPINNED');
}
//# sourceMappingURL=images.js.map