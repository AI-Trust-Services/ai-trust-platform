import { useLuigiInit } from "./hooks/useLuigi";
import { useTheme } from './hooks/useTheme';
import { useBranding } from './hooks/useBranding';
import { TraceList } from "./pages/TraceList";

export default function App() {
  // Complete the Luigi handshake so the shell hides its loading spinner.
  useLuigiInit(() => {});
  useTheme();
  useBranding();
  return <TraceList />;
}
