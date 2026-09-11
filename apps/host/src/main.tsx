import "@fontsource/ubuntu/400.css";
import "@fontsource/ubuntu/500.css";
import "@fontsource/ubuntu/700.css";
import "@cinder/ui/styles.css";
import "./host.css";
import "./audit.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@cinder/ui";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><ThemeProvider><App /></ThemeProvider></React.StrictMode>);
