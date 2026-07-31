import { useEffect } from "react";
import GroupApp from "./GroupApp";

// How often to check for a newer deploy. Paired with netlify.toml's
// no-cache on index.html, this is what actually gets a fix in front of
// someone who already has the app open, without asking anyone to know what
// "clear your cache" means.
const CHECK_INTERVAL_MS = 60000;

function currentBundleSrc() {
  return document.querySelector('script[type="module"]')?.src ?? null;
}

async function fetchLatestBundleSrc() {
  const res = await fetch(`/index.html?_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  const html = await res.text();
  const match = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/);
  return match ? new URL(match[1], window.location.origin).href : null;
}

export default function App() {
  useEffect(() => {
    const loadedSrc = currentBundleSrc();
    if (!loadedSrc) return;

    // A stale bundle showing up mid-keystroke is worse than a slightly late
    // update, so skip a check (and retry next interval) while the user is
    // actively typing rather than reloading out from under them.
    async function checkForUpdate() {
      if (document.hidden) return;
      const active = document.activeElement;
      const isTyping = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
      if (isTyping) return;

      const latestSrc = await fetchLatestBundleSrc().catch(() => null);
      if (latestSrc && latestSrc !== loadedSrc) {
        window.location.reload();
      }
    }

    const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", checkForUpdate);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", checkForUpdate);
    };
  }, []);

  return (
    <div className="page">
      <GroupApp />
    </div>
  );
}
