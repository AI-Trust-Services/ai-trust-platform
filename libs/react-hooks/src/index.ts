/**
 * Shared React hooks for AI Trust Platform MFEs.
 *
 * Provides:
 * - useBranding: Apply custom branding colors from localStorage to CSS variables
 * - useTheme: Apply dark/light theme preference from localStorage
 * - Branding: TypeScript interface for branding configuration
 */
export { useBranding } from './useBranding';
export { useTheme } from './useTheme';
export type { Branding } from './types';
