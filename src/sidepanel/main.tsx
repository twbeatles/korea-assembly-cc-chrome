import React from "react";
import { createRoot } from "react-dom/client";

import PopupApp from "../popup/App";
import "../popup/popup.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PopupApp surface="sidepanel" />
  </React.StrictMode>,
);

