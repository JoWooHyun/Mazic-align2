import { useEffect, useCallback } from 'react';
import type { GizmoMode } from '@components/STLViewer';

interface ShortcutCallbacks {
  onModeChange: (mode: GizmoMode) => void;
  onFocusSelected: () => void;
  onDeleteSelected: () => void;
  onClearSelection: () => void;
  onSelectAll: () => void;
}

export function useKeyboardShortcuts(callbacks: ShortcutCallbacks): void {
  const handler = useCallback((e: KeyboardEvent) => {
    // Ignore when typing in input fields
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    // Ignore when modals might be open and key isn't a global shortcut
    switch (e.key.toLowerCase()) {
      case 'q':
        callbacks.onModeChange('select');
        break;
      case 'w':
        callbacks.onModeChange('move');
        break;
      case 'e':
        callbacks.onModeChange('rotate');
        break;
      case 'r':
        callbacks.onModeChange('scale');
        break;
      case 'f':
        callbacks.onFocusSelected();
        break;
      case 'delete':
      case 'backspace':
        callbacks.onDeleteSelected();
        break;
      case 'escape':
        callbacks.onClearSelection();
        break;
      case 'a':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          callbacks.onSelectAll();
        }
        break;
    }
  }, [callbacks]);

  useEffect(() => {
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handler]);
}
