import { render } from "preact";
import "@shared/tokens.css";
import "./app.css";
import { Wall } from "./pages/Wall";
import { WhichShop, Channels, Reading } from "./pages/FirstRun";
import { Setup } from "./pages/Setup";
import { Week } from "./pages/Week";
import { Post } from "./pages/Post";
import { registerServiceWorker } from "./lib/push";
import { injectMarkSprite } from "./ui/marks";
import { listenForFirstInteraction } from "./lib/bell";

listenForFirstInteraction();
injectMarkSprite();
registerServiceWorker();

function route() {
  const p = location.pathname.replace(/\/+$/, "") || "/";
  switch (p) {
    case "/wall":
      return <Wall sample={false} />;
    case "/sample":
      return <Wall sample />;
    case "/setup/org":
      return <WhichShop />;
    case "/setup/channels":
      return <Channels />;
    case "/setup/reading":
      return <Reading />;
    case "/week":
      return <Week sample={false} />;
    case "/sample/week":
      return <Week sample />;
    case "/setup":
      return <Setup sample={false} />;
    case "/sample/setup":
      return <Setup sample />;
    default:
      if (p.startsWith("/post/")) return <Post sample={false} tileId={decodeURIComponent(p.slice(6))} />;
      if (p.startsWith("/sample/post/")) return <Post sample tileId={decodeURIComponent(p.slice(13))} />;
      location.href = "/";
      return null;
  }
}

render(route(), document.getElementById("app")!);
