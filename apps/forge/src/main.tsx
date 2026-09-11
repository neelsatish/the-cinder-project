import React from "react";
import ReactDOM from "react-dom/client";
// Ubuntu is bundled rather than assumed: BRAND.md §4.2 records that the
// specified UI face was never delivered and the target hardware falls back
// silently. Latin subset only — Forge ships offline, so unused ranges are
// dead weight in the installer.
import "@fontsource/ubuntu/latin-400.css";
import "@fontsource/ubuntu/latin-500.css";
import "@fontsource/ubuntu/latin-700.css";
import "@cinder/ui/styles.css";
import "./forge.css";
import "./components/student-tools.css";
import { ThemeProvider } from "@cinder/ui";
import { ForgeThemeProvider } from "./theme";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ForgeThemeProvider>
        <App />
      </ForgeThemeProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
