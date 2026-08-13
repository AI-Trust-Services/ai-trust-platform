import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Statically bundle UI5 asset registries so the prod build does not fall back
// to runtime dynamic `import("@ui5/...")` calls. Those bare-specifier dynamic
// imports work in `vite dev` (Vite resolves them on the fly) but break in the
// production build — the browser sees `import("@ui5/webcomponents/dist/bundle.esm.js")`
// verbatim and throws `Module name ... does not resolve to a valid URL`,
// which crashes <ui5-icon>/locale loading. The MFE then never renders inside
// the Luigi iframe (the host's loading spinner stays up).
//
// Importing each package's Assets.js statically pulls the icon registry and
// locale data into the bundle, removing the runtime dynamic import altogether.
import "@ui5/webcomponents/dist/Assets.js";
import "@ui5/webcomponents-icons/dist/Assets.js";

import { ThemeProvider } from "@ui5/webcomponents-react";
import "./styles/tokens.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>
);
