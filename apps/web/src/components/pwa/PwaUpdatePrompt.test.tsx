import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setNeedRefresh = vi.fn();
const updateServiceWorker = vi.fn().mockResolvedValue(undefined);
let needRefreshValue = false;
let capturedOnRegisteredSW:
  | ((
      swUrl: string,
      registration: ServiceWorkerRegistration | undefined,
    ) => void)
  | undefined;

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: (options?: {
    onRegisteredSW?: (
      swUrl: string,
      registration: ServiceWorkerRegistration | undefined,
    ) => void;
  }) => {
    capturedOnRegisteredSW = options?.onRegisteredSW;
    return {
      needRefresh: [needRefreshValue, setNeedRefresh] as [
        boolean,
        typeof setNeedRefresh,
      ],
      updateServiceWorker,
    };
  },
}));

import {
  PWA_RELOAD_GUARD_KEY,
  PwaUpdatePrompt,
  shouldApplyWaitingWorker,
} from "@/components/pwa/PwaUpdatePrompt";

function makeWaitingWorker(): ServiceWorker {
  return {
    scriptURL: "https://example.test/sw.js",
    state: "installed",
    postMessage: vi.fn(),
    addEventListener: vi.fn(),
  } as unknown as ServiceWorker;
}

function makeRegistration(overrides: {
  waiting?: ServiceWorker | null;
  installing?: ServiceWorker | null;
} = {}): ServiceWorkerRegistration {
  return {
    waiting: overrides.waiting ?? null,
    installing: overrides.installing ?? null,
    update: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn(),
  } as unknown as ServiceWorkerRegistration;
}

describe("shouldApplyWaitingWorker", () => {
  it("aplica quando há waiting no boot e ainda não tentou", () => {
    expect(
      shouldApplyWaitingWorker({
        hasWaiting: true,
        hasController: true,
        bootStartedAt: 1000,
        now: 2500,
        alreadyTried: false,
      }),
    ).toBe(true);
  });

  it("não aplica depois da janela de boot", () => {
    expect(
      shouldApplyWaitingWorker({
        hasWaiting: true,
        hasController: true,
        bootStartedAt: 1000,
        now: 4002,
        alreadyTried: false,
      }),
    ).toBe(false);
  });

  it("não aplica sem waiting, sem controller ou se já tentou", () => {
    expect(
      shouldApplyWaitingWorker({
        hasWaiting: false,
        hasController: true,
        bootStartedAt: 1000,
        now: 1000,
        alreadyTried: false,
      }),
    ).toBe(false);
    expect(
      shouldApplyWaitingWorker({
        hasWaiting: true,
        hasController: false,
        bootStartedAt: 1000,
        now: 1000,
        alreadyTried: false,
      }),
    ).toBe(false);
    expect(
      shouldApplyWaitingWorker({
        hasWaiting: true,
        hasController: true,
        bootStartedAt: 1000,
        now: 1000,
        alreadyTried: true,
      }),
    ).toBe(false);
  });
});

describe("PwaUpdatePrompt", () => {
  beforeEach(() => {
    needRefreshValue = false;
    capturedOnRegisteredSW = undefined;
    setNeedRefresh.mockClear();
    updateServiceWorker.mockClear();
    sessionStorage.clear();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        controller: { scriptURL: "https://example.test/sw.js" },
        addEventListener: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it("não mostra o banner mesmo com needRefresh do SW true", () => {
    needRefreshValue = true;
    render(<PwaUpdatePrompt />);

    expect(
      screen.queryByText("Nova versão do SAGRA Web disponível."),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Atualizar" })).toBeNull();
  });

  it("não mostra o banner quando o SW está waiting", () => {
    render(<PwaUpdatePrompt />);
    capturedOnRegisteredSW?.(
      "/sw.js",
      makeRegistration({ waiting: makeWaitingWorker() }),
    );

    expect(
      screen.queryByText("Nova versão do SAGRA Web disponível."),
    ).not.toBeInTheDocument();
  });

  it("ativa o SW waiting no boot e pede reload uma vez", () => {
    render(<PwaUpdatePrompt />);
    const waiting = makeWaitingWorker();
    capturedOnRegisteredSW?.("/sw.js", makeRegistration({ waiting }));

    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
    expect(sessionStorage.getItem(PWA_RELOAD_GUARD_KEY)).toBe("1");
  });

  it("não ativa de novo se a guarda de sessionStorage já está setada", () => {
    sessionStorage.setItem(PWA_RELOAD_GUARD_KEY, "1");
    render(<PwaUpdatePrompt />);
    const waiting = makeWaitingWorker();
    capturedOnRegisteredSW?.("/sw.js", makeRegistration({ waiting }));

    expect(waiting.postMessage).not.toHaveBeenCalled();
    expect(updateServiceWorker).not.toHaveBeenCalled();
  });

  it("não ativa waiting na primeira instalação (sem controller)", () => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        controller: null,
        addEventListener: vi.fn(),
      },
    });
    render(<PwaUpdatePrompt />);
    const waiting = makeWaitingWorker();
    capturedOnRegisteredSW?.("/sw.js", makeRegistration({ waiting }));

    expect(waiting.postMessage).not.toHaveBeenCalled();
    expect(updateServiceWorker).not.toHaveBeenCalled();
  });

  it("não ativa waiting encontrado depois da janela de boot", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    render(<PwaUpdatePrompt />);
    vi.setSystemTime(14_000);

    const waiting = makeWaitingWorker();
    capturedOnRegisteredSW?.("/sw.js", makeRegistration({ waiting }));

    expect(waiting.postMessage).not.toHaveBeenCalled();
    expect(updateServiceWorker).not.toHaveBeenCalled();
  });
});
