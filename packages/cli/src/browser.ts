import { execa } from "execa";

/** Open a URL in the default browser. Best effort; never throws. Argument arrays only. */
export async function openBrowser(url: string): Promise<void> {
  if (process.env.HANDOFF_NO_OPEN || process.env.CI) return;
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["explorer.exe", [url]]
        : ["xdg-open", [url]];
  await execa(cmd, args, { reject: false, stdio: "ignore", detached: true, windowsHide: true }).catch(() => undefined);
}
