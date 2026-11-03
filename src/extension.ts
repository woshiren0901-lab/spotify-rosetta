import { RosettaController } from "./app/controller";
import { ControlPanel } from "./ui/controlPanel";

let controller: RosettaController | undefined;
let panel: ControlPanel | undefined;
let attempts = 0;

function ready(): boolean {
  return Boolean(
    window.Spicetify?.Player &&
      window.Spicetify?.CosmosAsync &&
      window.Spicetify?.LocalStorage,
  );
}

function start(): void {
  if (controller || !document.body) return;
  if (!ready()) {
    attempts += 1;
    if (attempts < 100) window.setTimeout(start, 300);
    return;
  }

  window.SpotifyRosetta?.dispose();
  controller = new RosettaController();
  panel = new ControlPanel(controller);
  controller.start();
  window.SpotifyRosetta = {
    dispose() {
      panel?.dispose();
      controller?.dispose();
      panel = undefined;
      controller = undefined;
    },
    async refresh() {
      await controller?.refreshCurrent(true);
    },
    debug() {
      return controller?.getSnapshot();
    },
  };
}

window.addEventListener("beforeunload", () => {
  controller?.dispose();
});

start();

