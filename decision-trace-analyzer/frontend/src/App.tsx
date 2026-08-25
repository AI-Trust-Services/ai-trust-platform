import { useLuigiInit } from "./hooks/useLuigi";
import { useTheme } from './hooks/useTheme';
import { TraceList } from "./pages/TraceList";

export default function App() {
  // Complete the Luigi handshake so the shell hides its loading spinner.
  useLuigiInit(() => {});
  useTheme();
  return <TraceList />;
}
