// The Agent Toolkit wrapper behind get_paypal_order. The toolkit itself is replaced here, so nothing
// reaches PayPal: these tests check what Hakika asks it to do.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toolkitOrderLookup } from "@/server/agent/paypal-order";

const toolkit = vi.hoisted(() => ({
  configs: [] as unknown[],
  calls: [] as unknown[],
}));

vi.mock("@paypal/agent-toolkit/bedrock", () => ({
  PayPalAgentToolkit: class {
    constructor(config: unknown) {
      toolkit.configs.push(config);
    }
    async handleToolCall(call: { toolUseId: string }) {
      toolkit.calls.push(call);
      return { toolUseId: call.toolUseId, content: [{ text: JSON.stringify({ id: "5O190127TN364715T", status: "COMPLETED" }) }] };
    }
  },
}));

const ORDER = "5O190127TN364715T";

beforeEach(() => {
  toolkit.configs.length = 0;
  toolkit.calls.length = 0;
  vi.stubEnv("PAYPAL_ENV", "sandbox");
  vi.stubEnv("PAYPAL_CLIENT_ID", "sandbox-client");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "sandbox-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("toolkitOrderLookup", () => {
  it("runs get_order and nothing else, with only order reads enabled, in the sandbox", async () => {
    const lookup = toolkitOrderLookup();
    expect(await lookup(ORDER)).toEqual({ id: ORDER, status: "COMPLETED" });
    await lookup(ORDER);

    expect(toolkit.configs).toEqual([{
      clientId: "sandbox-client",
      clientSecret: "sandbox-secret",
      configuration: { actions: { orders: { get: true } }, context: { sandbox: true } },
    }]); // made once, reused
    expect(toolkit.calls).toEqual([
      { toolUseId: "ask-hakika", name: "get_order", input: { id: ORDER } },
      { toolUseId: "ask-hakika", name: "get_order", input: { id: ORDER } },
    ]);
  });

  it("makes no call outside the sandbox or without credentials", async () => {
    vi.stubEnv("PAYPAL_ENV", "live");
    await expect(toolkitOrderLookup()(ORDER)).rejects.toThrow(/sandbox is not configured/);
    vi.stubEnv("PAYPAL_ENV", "sandbox");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "");
    await expect(toolkitOrderLookup()(ORDER)).rejects.toThrow(/sandbox is not configured/);
    expect(toolkit.configs).toEqual([]);
    expect(toolkit.calls).toEqual([]);
  });

  it("makes no call for something that isn't an order ID", async () => {
    await expect(toolkitOrderLookup()(`${ORDER}/capture`)).rejects.toThrow(/Not a PayPal order ID/);
    expect(toolkit.calls).toEqual([]);
  });
});

describe("the real toolkit, configured as Hakika configures it", () => {
  it("offers only get_order (its handleToolCall would still run any name, hence the fixed method)", async () => {
    const { PayPalAgentToolkit } = await vi.importActual<typeof import("@paypal/agent-toolkit/bedrock")>("@paypal/agent-toolkit/bedrock");
    const real = new PayPalAgentToolkit({
      clientId: "sandbox-client",
      clientSecret: "sandbox-secret",
      configuration: { actions: { orders: { get: true } }, context: { sandbox: true } },
    });
    expect(real.getTools().map((tool) => tool.toolSpec.name)).toEqual(["get_order"]);
  });
});
