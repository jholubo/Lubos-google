import { useEffect, useRef } from 'react';

/**
 * Closes a modal/dialog/popover when the user presses the mobile back button
 * instead of navigating away from the app.
 */
export function useBackButtonClose(isOpen, onClose) {
  // Keep latest onClose in a ref so we don't re-run the effect on every render
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    // Push a marker state so the back button has something to consume
    window.history.pushState({ modalOpen: true }, '');

    const handler = () => {
      onCloseRef.current && onCloseRef.current();
    };
    window.addEventListener('popstate', handler);

    return () => {
      window.removeEventListener('popstate', handler);
      // If modal was closed by other means (X button, save, etc.), pop our marker
      if (window.history.state && window.history.state.modalOpen) {
        window.history.back();
      }
    };
  }, [isOpen]);
}
