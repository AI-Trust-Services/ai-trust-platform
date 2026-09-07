import { useEffect } from 'react';

const THEME_KEY = 'trust-platform-theme';

export function useTheme(): void {
  useEffect(() => {
    function apply(v: string | null) {
      document.documentElement.classList.toggle('dark', v === 'dark');
    }
    apply(localStorage.getItem(THEME_KEY));
    function onStorage(e: StorageEvent) {
      if (e.key === THEME_KEY) apply(e.newValue);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
}
