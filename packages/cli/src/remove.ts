import { HandoffError } from "@ember-handover/core";
import { applyRemove, planRemove, renderDiff } from "./init.js";
import type { Io } from "./main.js";

/** `npx ember-handover remove`: undo agent setup exactly (SPEC S14). Asks first: it deletes .handoff/. */
export async function runRemove(opts: { cwd: string; io: Io; yes: boolean }): Promise<number> {
  const plan = planRemove(opts.cwd);
  if (!plan.length) {
    opts.io.stdout("Handoff has nothing to remove here.\n");
    return 0;
  }
  opts.io.stdout(`Handoff will make these changes:\n\n${renderDiff(plan)}\n\n`);
  if (!opts.yes) {
    if (!opts.io.ask) throw new HandoffError("REMOVE_NEEDS_CONFIRM");
    const a = (await opts.io.ask("Remove Handoff from this repo? (y/N) ")).toLowerCase();
    if (a !== "y" && a !== "yes") {
      opts.io.stdout("Nothing was changed.\n");
      return 0;
    }
  }
  applyRemove(opts.cwd, plan);
  opts.io.stdout("Removed. Your repo is back to how it was before Handoff.\n");
  return 0;
}
