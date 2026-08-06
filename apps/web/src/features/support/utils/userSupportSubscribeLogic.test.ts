import { describe, expect, it } from "vitest";

import {
  buildSubscribePayload,
  buildUnsubscribePayload,
  shouldClearSubscription,
  shouldSkipSubscribe,
  ticketToUnsubscribeBeforeChange,
} from "./userSupportSubscribeLogic";

describe("userSupportSubscribeLogic", () => {
  it("não envia subscribe repetido para o mesmo ticket", () => {
    expect(shouldSkipSubscribe(6, 6)).toBe(true);
    expect(shouldSkipSubscribe(6, 7)).toBe(false);
  });

  it("não indica unsubscribe enquanto selectedTicketId não mudou", () => {
    expect(ticketToUnsubscribeBeforeChange(6, 6)).toBeNull();
    expect(ticketToUnsubscribeBeforeChange(null, 6)).toBeNull();
  });

  it("ao trocar ticket 6 → 7 indica unsubscribe 6", () => {
    expect(ticketToUnsubscribeBeforeChange(6, 7)).toBe(6);
  });

  it("limpa subscription quando ticket é null", () => {
    expect(shouldClearSubscription(null)).toBe(true);
    expect(shouldClearSubscription(6)).toBe(false);
  });

  it("payload subscribe usa ticket_id", () => {
    expect(buildSubscribePayload(6)).toEqual({ type: "support_subscribe", ticket_id: 6 });
  });

  it("payload unsubscribe usa ticket_id", () => {
    expect(buildUnsubscribePayload(6)).toEqual({ type: "support_unsubscribe", ticket_id: 6 });
  });
});
