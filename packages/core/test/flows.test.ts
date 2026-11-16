import { describe, expect, it } from "vitest";
import { describeStep, parseFlows } from "../src/flows.js";

const SPEC_EXAMPLE = `version: 1
baseUrl: /                 # relative only; absolute URLs rejected
fixtures: .handoff/fixtures # optional mock data for states
flows:
  - id: checkout
    name: Checkout
    intent: Buy a plan in under 3 steps
    steps:
      - goto: /pricing
        intent: User compares plans
      - click: { testid: plan-pro }
      - fill: { testid: email, value: "test@example.com" }
      - click: { role: button, name: Continue }
      - expect: { text: "Payment" }
        state: default
    states:              # alternate states of the same flow
      - id: card-declined
        fixture: payments/declined.json
        at: 4
`;

describe("parseFlows", () => {
  it("parses the SPEC example exactly", () => {
    const r = parseFlows(SPEC_EXAMPLE);
    expect(r.errors).toEqual([]);
    expect(r.file).toEqual({
      version: 1,
      baseUrl: "/",
      fixtures: ".handoff/fixtures",
      flows: [
        {
          id: "checkout",
          name: "Checkout",
          intent: "Buy a plan in under 3 steps",
          steps: [
            { goto: "/pricing", intent: "User compares plans" },
            { click: { testid: "plan-pro" } },
            { fill: { testid: "email", value: "test@example.com" } },
            { click: { role: "button", name: "Continue" } },
            { expect: { text: "Payment" }, state: "default" },
          ],
          states: [{ id: "card-declined", fixture: "payments/declined.json", at: 4 }],
        },
      ],
    });
  });

  it("accepts every verb and selector", () => {
    const r = parseFlows(`version: 1
flows:
  - id: all
    name: All verbs
    steps:
      - goto: /a?x=1#h
      - click: { label: Email }
      - hover: { css: ".card" }
      - select: { label: Plan, value: pro }
      - press: Enter
      - press: { testid: email, key: Tab }
      - scroll: bottom
      - scroll: { testid: footer }
      - wait: 2
      - wait: 500ms
      - expect: { role: heading, name: Done }
      - expect: { url: /done }
`);
    expect(r.errors).toEqual([]);
    expect(r.file?.flows[0]?.steps).toContainEqual({ wait: 2000 });
    expect(r.file?.flows[0]?.steps).toContainEqual({ wait: 500 });
    expect(r.file?.baseUrl).toBe("/");
    expect(r.file?.fixtures).toBe(".handoff/fixtures");
  });

  it("flags CSS selectors as fragile, without failing", () => {
    const r = parseFlows(`version: 1\nflows:\n  - id: a\n    name: A\n    steps:\n      - click: { css: "div > button" }\n`);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([expect.objectContaining({ line: 6, message: expect.stringMatching(/fragile/i) })]);
  });

  it("reports errors with line numbers and a plain fix", () => {
    const r = parseFlows(`version: 1\nflows:\n  - id: a\n    name: A\n    steps:\n      - clikc: { testid: x }\n`);
    expect(r.file).toBeNull();
    expect(r.errors[0]).toMatchObject({ line: 6 });
    expect(r.errors[0]?.message).toMatch(/clikc.*isn't a step.*goto, click/);
  });

  it.each([
    ["wait over 10 s", "- wait: 11"],
    ["wait negative", "- wait: -1"],
    ["two verbs in one step", "- { goto: /a, click: { testid: b } }"],
    ["selector with two kinds", "- click: { testid: a, text: b }"],
    ["empty selector", "- click: {}"],
    ["fill without value", "- fill: { testid: a }"],
    ["unknown step key", "- goto: /a\n        onSuccess: run"],
    ["expect url absolute", "- expect: { url: 'https://evil.example/' }"],
  ])("rejects %s", (_name, step) => {
    const r = parseFlows(`version: 1\nflows:\n  - id: a\n    name: A\n    steps:\n      ${step}\n`);
    expect(r.file).toBeNull();
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("rejects duplicate flow ids and bad state references", () => {
    expect(parseFlows(`version: 1\nflows:\n  - { id: a, name: A, steps: [{ goto: / }] }\n  - { id: a, name: B, steps: [{ goto: / }] }\n`).errors[0]?.message).toMatch(/duplicate/i);
    expect(
      parseFlows(`version: 1\nflows:\n  - id: a\n    name: A\n    steps: [{ goto: / }]\n    states: [{ id: s, fixture: x.json, at: 5 }]\n`).errors[0]?.message,
    ).toMatch(/at/);
  });

  it("describes steps in plain words", () => {
    expect(describeStep({ click: { testid: "plan-pro" } })).toBe('Click test ID "plan-pro"');
    expect(describeStep({ fill: { label: "Email", value: "a@b.c" } })).toBe('Type "a@b.c" into label "Email"');
    expect(describeStep({ goto: "/pricing" })).toBe("Go to /pricing");
    expect(describeStep({ expect: { text: "Payment" } })).toBe('Expect text "Payment"');
    expect(describeStep({ wait: 1500 })).toBe("Wait 1.5 s");
  });
});
