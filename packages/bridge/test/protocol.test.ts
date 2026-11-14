import { describe, expect, it } from "vitest";
import { parseBridgeEvent, parseOverlayCommand } from "../src/protocol.js";
import { RAW } from "../../tokens/test/fixtures.js";

describe("overlay → bridge commands", () => {
  it("accepts well-formed commands", () => {
    expect(parseOverlayCommand({ v: 1, type: "hello" })).toEqual({ v: 1, type: "hello" });
    expect(parseOverlayCommand({ v: 1, type: "layout", mode: "panel" })).toEqual({ v: 1, type: "layout", mode: "panel" });
  });

  it.each([
    null,
    undefined,
    "hello",
    42,
    [],
    { type: "hello" },
    { v: 2, type: "hello" },
    { v: 1, type: "eval", code: "alert(1)" },
    { v: 1, type: "layout", mode: "fullscreen" },
    { v: 1, type: "layout", mode: "panel", extra: true },
    { v: 1, type: "hello", __proto__: { polluted: true } },
    Object.create({ v: 1, type: "hello" }),
  ])("rejects %j", (msg) => {
    expect(parseOverlayCommand(msg)).toBeNull();
  });
});

describe("bridge → overlay events", () => {
  it("accepts well-formed events", () => {
    expect(parseBridgeEvent({ v: 1, type: "key", key: "toggle" })).toEqual({ v: 1, type: "key", key: "toggle" });
    expect(parseBridgeEvent({ v: 1, type: "page", url: "http://localhost:4000/a", title: "A" })).toEqual({
      v: 1,
      type: "page",
      url: "http://localhost:4000/a",
      title: "A",
    });
  });

  it("caps string lengths", () => {
    expect(parseBridgeEvent({ v: 1, type: "page", url: "u".repeat(5000), title: "t" })).toBeNull();
    expect(parseBridgeEvent({ v: 1, type: "page", url: "u", title: "t".repeat(600) })).toBeNull();
  });

  it.each([{ v: 1, type: "key", key: "rm -rf" }, { v: 1, type: "page", url: 1, title: "t" }, { v: 1, type: "token" }])(
    "rejects %j",
    (msg) => expect(parseBridgeEvent(msg)).toBeNull(),
  );
});

describe("inspect messages", () => {
  it("accepts inspect commands", () => {
    expect(parseOverlayCommand({ v: 1, type: "inspect", on: true })).not.toBeNull();
    expect(parseOverlayCommand({ v: 1, type: "select", to: "parent" })).not.toBeNull();
    expect(parseOverlayCommand({ v: 1, type: "select", to: "ancestor", index: 3 })).not.toBeNull();
    expect(parseOverlayCommand({ v: 1, type: "select", to: "none" })).not.toBeNull();
  });

  it.each([
    { v: 1, type: "inspect", on: "yes" },
    { v: 1, type: "select", to: "sibling" },
    { v: 1, type: "select", to: "ancestor", index: -1 },
    { v: 1, type: "select", to: "ancestor", index: 1.5 },
    { v: 1, type: "select", to: "ancestor", index: 999 },
  ])("rejects %j", (m) => expect(parseOverlayCommand(m)).toBeNull());

  it("accepts a full spec event", () => {
    expect(parseBridgeEvent({ v: 1, type: "spec", pinned: true, spec: RAW })).toEqual({ v: 1, type: "spec", pinned: true, spec: RAW });
    expect(parseBridgeEvent({ v: 1, type: "spec", pinned: false, spec: null })).not.toBeNull();
  });

  it("rejects malformed specs deeply", () => {
    const bad = [
      { ...RAW, rect: { ...RAW.rect, width: Number.NaN } },
      { ...RAW, rect: { ...RAW.rect, width: Infinity } },
      { ...RAW, box: { ...RAW.box, padding: [1, 2, 3] } },
      { ...RAW, ancestors: Array.from({ length: 100 }, () => RAW.ancestors[0]) },
      { ...RAW, text: "x".repeat(10_000) },
      { ...RAW, extra: 1 },
      { ...RAW, colors: { ...RAW.colors, text: 5 } },
      { ...RAW, typography: { ...RAW.typography, rendered: 7 } },
    ];
    for (const spec of bad) expect(parseBridgeEvent({ v: 1, type: "spec", pinned: true, spec }), JSON.stringify(spec).slice(0, 80)).toBeNull();
  });
});
