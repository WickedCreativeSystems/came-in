import { render } from "preact";
import "@shared/tokens.css";
import "./app.css";
import { Wall } from "./pages/Wall";
import { WhichShop, Channels, Reading } from "./pages/FirstRun";
import { Later } from "./pages/Later";
import { injectMarkSprite } from "./ui/marks";
import { listenForFirstInteraction } from "./lib/bell";

listenForFirstInteraction();
injectMarkSprite();

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
      return <Later tab="week" sample={false} title="This week" phase={3} />;
    case "/sample/week":
      return <Later tab="week" sample title="This week" phase={3} />;
    case "/setup":
      return <Later tab="setup" sample={false} title="Setup" phase={2} />;
    case "/sample/setup":
      return <Later tab="setup" sample title="Setup" phase={2} />;
    default:
      if (p.startsWith("/post/")) return <Later tab="wall" sample={false} title="A post" phase={3} />;
      location.href = "/";
      return null;
  }
}

render(route(), document.getElementById("app")!);
