"use client";

import { useEffect, useState } from "react";

export default function PwaRegister() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstall, setShowInstall] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator.standalone === true;
    if (standalone) return;

    const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isiOS) setShowInstall(true);

    const onPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
      setShowInstall(true);
    };
    const onInstalled = () => {
      setShowInstall(false);
      setInstallPrompt(null);
      setShowIosHelp(false);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (installPrompt) {
      await installPrompt.prompt();
      const result = await installPrompt.userChoice;
      if (result?.outcome === "accepted") setShowInstall(false);
      setInstallPrompt(null);
      return;
    }
    setShowIosHelp(true);
  }

  if (!showInstall) return null;

  return (
    <div className="pwa-install">
      <button type="button" className="pwa-install-button" onClick={install}>
        ⬇ Install App
      </button>
      {showIosHelp && (
        <div className="pwa-install-help" role="dialog" aria-label="Install Lager iPhone">
          <button
            type="button"
            className="pwa-help-close"
            aria-label="Close"
            onClick={() => setShowIosHelp(false)}
          >
            ×
          </button>
          <strong>Install on iPhone</strong>
          <span>Open this site in Safari → Share → Add to Home Screen → Add.</span>
          <small>After that Lager iPhone opens full-screen like an app.</small>
        </div>
      )}
    </div>
  );
}
