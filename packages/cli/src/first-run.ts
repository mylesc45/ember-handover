import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { applyInit, planInit, renderDiff } from "./init.js";
import type { Io } from "./main.js";
import { detectRoutes } from "./routes.js";

const STATE = join(homedir(), ".ember-handover", "state.json");

function declined(root: string): boolean {
  try {
    return (JSON.parse(readFileSync(STATE, "utf8")) as { declined?: string[] }).declined?.includes(realpathSync(root)) === true;
  } catch {
    return false;
  }
}

function rememberDecline(root: string) {
  try {
    const prev = existsSync(STATE) ? (JSON.parse(readFileSync(STATE, "utf8")) as { declined?: string[] }) : {};
    mkdirSync(join(homedir(), ".ember-handover"), { recursive: true });
    writeFileSync(STATE, JSON.stringify({ ...prev, declined: [...new Set([...(prev.declined ?? []), realpathSync(root)])] }, null, 2));
  } catch {
    /* not being able to remember is fine; we'll ask again next time */
  }
}

/**
 * SPEC → First run: one question, in a terminal only. The exact changes are shown before
 * anything is written. Nothing else in the repo changes.
 */
export async function maybeOfferAgentSetup(root: string, io: Io): Promise<void> {
  if (!io.ask || existsSync(join(root, ".handoff")) || declined(root)) return;
  const plan = planInit(root, detectRoutes(root));
  if (!plan.length) return;
  io.stdout(`\nHandoff can connect your coding agent. These are the only changes it would make:\n\n${renderDiff(plan)}\n\n`);
  const a = (await io.ask("Connect your coding agent so it keeps handoff notes up to date? (Y/n) ")).toLowerCase();
  if (a === "" || a === "y" || a === "yes") {
    applyInit(root, plan);
    io.stdout("Done. Your agent will keep .handoff/ current. Undo any time with `npx ember-handover remove`.\n\n");
  } else {
    rememberDecline(root);
    io.stdout("No problem; nothing was changed. Handoff won't ask again for this repo.\n\n");
  }
}
