import { useLuigiInit } from "./hooks/useLuigi";
import { TraceList } from "./pages/TraceList";

export default function App() {
  // Complete the Luigi handshake so the shell hides its loading spinner.
  useLuigiInit(() => {});
  return <TraceList />;
}
