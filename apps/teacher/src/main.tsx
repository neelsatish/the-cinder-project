import React from "react";
import ReactDOM from "react-dom/client";
import "@cinder/ui/styles.css";
import { ThemeProvider } from "@cinder/ui";
import "./teacher.css";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
