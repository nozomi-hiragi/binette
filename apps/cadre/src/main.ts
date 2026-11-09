// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { Api, App, DestroyReason, Last, State, launch } from "jsr:@binette/replique";
import { View } from "jsr:@binette/replique/ui";
import { CadreApp } from "./cadre.ts";
import { Home } from "./home/main.ts";
import { Settings } from "./settings/main.ts";
import { Apps } from "./apps/main.ts";

/** 親とサブアプリは同じ入口を使い、それぞれ別の Worker で動く。 */
class Entry extends App {
  private app: App = new CadreApp();

  override onCreate(last: Last, api: Api): void {
    const sub = api.sub();
    if (sub == "home") this.app = new Home();
    else if (sub == "settings") this.app = new Settings();
    else if (sub == "apps") this.app = new Apps();
    this.app.onCreate(last, api);
  }

  override build(): View | null { return this.app.build(); }
  override onStart(last: State): void { this.app.onStart(last); }
  override onResume(): void { this.app.onResume(); }
  override onPause(): void { this.app.onPause(); }
  override onStop(): void { this.app.onStop(); }
  override onDestroy(reason: DestroyReason): void { this.app.onDestroy(reason); }
}

launch(new Entry());
