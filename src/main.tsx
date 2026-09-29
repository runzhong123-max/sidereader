import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./reading-experience.css";
import { applyTheme, readTheme } from './theme';
applyTheme(readTheme());
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

import "./learning-objects.css";
import "./research.css";
import "./study-workspace.css";

import "./paper-workspace.css";
import "./reader-shell.css";
import "./theme.css";
