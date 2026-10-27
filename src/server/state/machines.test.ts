import { describe, expect, it } from "vitest";
import { MILESTONE_STATUSES, PAYMENT_STATUSES, PROOF_REQUEST_STATUSES, REQUEST_STATUSES } from "../db/enums";
import { InvalidTransition } from "./machine";
import { milestoneMachine, paymentMachine, proofRequestMachine, requestMachine } from "./machines";

// Applies events in order and returns every state visited.
function walk<S extends string, E extends string>(
  machine: { transition(from: S, event: E): S }, start: S, events: E[],
): S[] {
  const states = [start];
  for (const event of events) states.push(machine.transition(states.at(-1)!, event));
  return states;
}

// Every state a machine can reach from its starting state.
function reachable<S extends string, E extends string>(
  machine: { table: Record<S, Partial<Record<E, S>>> }, start: S,
): Set<S> {
  const seen = new Set<S>([start]);
  const queue = [start];
  while (queue.length) {
    for (const to of Object.values(machine.table[queue.shift()!]) as S[]) {
      if (!seen.has(to)) { seen.add(to); queue.push(to); }
    }
  }
  return seen;
}

describe("request machine", () => {
  it("follows the cement story from WhatsApp message to verified delivery", () => {
    expect(walk(requestMachine, "received", [
      "parsed", "checked", "sent_for_approval", "owner_approved", "captured", "proof_requested", "proof_verified",
    ])).toEqual([
      "received", "parsed", "checked", "awaiting_approval", "approved", "paid", "awaiting_proof", "verified",
    ]);
  });

  it("holds on suspicious proof and releases only on fresh proof or an override", () => {
    expect(walk(requestMachine, "awaiting_proof", ["proof_suspicious", "proof_needs_fresh", "proof_verified"]))
      .toEqual(["awaiting_proof", "held", "held", "verified"]);
    expect(requestMachine.transition("held", "owner_overrode")).toBe("verified");
  });

  it("sends a failed capture back for approval instead of marking it paid", () => {
    expect(requestMachine.transition("approved", "capture_failed")).toBe("awaiting_approval");
  });

  it.each([
    ["received", "captured"],
    ["awaiting_approval", "captured"], // no capture without the owner's approval
    ["declined", "owner_approved"],
    ["declined", "captured"],
    ["checked", "owner_approved"], // the owner sees the card before approving
    ["paid", "owner_declined"],
    ["verified", "proof_suspicious"],
    ["awaiting_proof", "owner_overrode"], // overrides are for held requests only
  ] as const)("refuses %s → %s", (from, event) => {
    expect(requestMachine.can(from, event)).toBe(false);
    expect(() => requestMachine.transition(from, event)).toThrow(InvalidTransition);
  });

  it("ends in verified, declined or failed", () => {
    for (const end of ["verified", "declined", "failed"] as const) expect(requestMachine.events(end)).toEqual([]);
  });

  it("can reach every status", () => {
    expect(reachable(requestMachine, "received")).toEqual(new Set(REQUEST_STATUSES));
  });
});

describe("milestone machine", () => {
  it("follows the foundation story: held, fresh proof, verified, Otieno paid", () => {
    expect(walk(milestoneMachine, "in_progress", [
      "proof_requested", "proof_suspicious", "proof_needs_fresh", "proof_verified", "labour_paid",
    ])).toEqual(["in_progress", "awaiting_proof", "held", "held", "verified", "paid"]);
  });

  it("pays labour only from verified", () => {
    for (const state of MILESTONE_STATUSES) {
      expect(milestoneMachine.can(state, "labour_paid"), state).toBe(state === "verified");
    }
  });

  it("can reach every status and ends at paid", () => {
    expect(reachable(milestoneMachine, "planned")).toEqual(new Set(MILESTONE_STATUSES));
    expect(milestoneMachine.events("paid")).toEqual([]);
  });
});

describe("payment machine", () => {
  it("accepts a webhook that repeats the capture response", () => {
    expect(walk(paymentMachine, "created", ["captured", "captured"])).toEqual(["created", "captured", "captured"]);
  });

  it.each([
    ["failed", "captured"],
    ["denied", "captured"],
    ["refunded", "captured"],
    ["created", "refunded"],
  ] as const)("refuses %s → %s", (from, event) => {
    expect(() => paymentMachine.transition(from, event)).toThrow(InvalidTransition);
  });

  it("can reach every status", () => {
    expect(reachable(paymentMachine, "created")).toEqual(new Set(PAYMENT_STATUSES));
  });
});

describe("proof request machine", () => {
  it("is single use", () => {
    expect(proofRequestMachine.transition("issued", "proof_received")).toBe("used");
    expect(proofRequestMachine.can("used", "proof_received")).toBe(false);
  });

  it("takes no proof once expired or superseded", () => {
    expect(proofRequestMachine.can("expired", "proof_received")).toBe(false);
    expect(proofRequestMachine.can("superseded", "proof_received")).toBe(false);
  });

  it("can reach every status", () => {
    expect(reachable(proofRequestMachine, "issued")).toEqual(new Set(PROOF_REQUEST_STATUSES));
  });
});

describe("InvalidTransition", () => {
  it("names the machine, the state and the event", () => {
    expect(() => requestMachine.transition("declined", "captured"))
      .toThrow('request: "captured" is not allowed from "declined".');
  });
});
