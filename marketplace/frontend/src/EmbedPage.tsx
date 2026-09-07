import { useParams } from "react-router";
import { proxyBase } from "./api";

/** Renders a running service embedded same-origin via the marketplace proxy.
 *  This is the viewUrl target for each internal or discovered service's Luigi node. For discovered
 *  apps the proxy also federates the caller's platform identity (see the backend proxy route). */
export default function EmbedPage() {
  const { name } = useParams<{ name: string }>();
  if (!name) return <div className="wrap">No service specified.</div>;
  return <iframe className="embed" title={name} src={proxyBase(name)} />;
}
