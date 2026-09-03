import { useParams } from "react-router";
import { proxyBase } from "./api";

/** Renders a running internal service embedded same-origin via the marketplace proxy.
 *  This is the viewUrl target for each internal service's Luigi node. */
export default function EmbedPage() {
  const { name } = useParams<{ name: string }>();
  if (!name) return <div className="wrap">No service specified.</div>;
  return <iframe className="embed" title={name} src={proxyBase(name)} />;
}
