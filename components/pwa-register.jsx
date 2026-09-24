"use client";

import { useEffect, useState } from "react";

const CURRENT_BUILD = process.env.NEXT_PUBLIC_BUILD_ID || "dev";

export default function PwaRegister() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstall, setShowInstall] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    let registration;
    let stopped = false;

    async function registerWorker() {
      if (!("serviceWorker" in navigator)) return;
      try {
        registration = await navigator.serviceWorker.register("/sw.js", {
          updateViaCache: "none",
        });
        registration.update().catch(() => {});
      } catch {}
    }

    async function checkVersion() {
      if (stopped || CURRENT_BUILD === "dev") return;
      try {
        const response = await fetch("/api/version?t=" + Date.now(), {
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (payload?.version && payload.version !== CURRENT_BUILD) {
          setUpdateAvailable(true);
        }
      } catch {}
    }

    registerWorker();
    checkVersion();

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      registration?.update?.().catch(() => {});
      checkVersion();
    };
    const onFocus = () => {
      registration?.update?.().catch(() => {});
      checkVersion();
    };
    const timer = window.setInterval(checkVersion, 5 * 60 * 1000);

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    const standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator.standalone === true;

    const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (!standalone && isiOS) setShowInstall(true);

    const onPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
      if (!standalone) setShowInstall(true);
    };
    const onInstalled = () => {
      setShowInstall(false);
      setInstallPrompt(null);
      setShowIosHelp(false);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
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

  return (
    <>
      {updateAvailable && (
        <div className="pwa-update" role="status">
          <div>
            <strong>New version ready</strong>
            <span>Your Lager iPhone app has an update.</span>
          </div>
          <button
            type="button"
            className="primary"
            onClick={() => window.location.reload()}
          >
            Refresh Update
          </button>
        </div>
      )}

      {showInstall && (
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
      )}
    </>
  );
}
