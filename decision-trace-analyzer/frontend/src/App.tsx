import { useLuigiInit } from "./hooks/useLuigi";
import { useTheme, useBranding } from "@ai-trust/react-hooks";
import { TraceList } from "./pages/TraceList";

export default function App() {
  // Complete the Luigi handshake so the shell hides its loading spinner.
  useLuigiInit(() => {});
  useTheme();
  useBranding();
  return <TraceList />;
}
