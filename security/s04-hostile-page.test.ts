// S4 — App or third-party scripts in the page abuse Handoff.
import { describe, it } from "vitest";

describe("S4 hostile page cannot reach the token or drive the bridge", () => {
  it.todo("M1: bridge exposes no globals on window");
  it.todo("M1: messages from any origin other than the overlay iframe are ignored");
  it.todo("M1: schema-invalid messages are dropped");
  it.todo("M1: hostile page script cannot read the session token");
  it.todo("M1: bridge never mutates DOM outside its own shadow root");
});
