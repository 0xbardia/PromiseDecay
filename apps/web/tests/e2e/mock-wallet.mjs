/**
 * A faithful mock EIP-1193 provider injected into the page before any app code runs.
 *
 * This exists so the frontend's own wallet and transaction code paths can be exercised the
 * way a browser user triggers them — through the UI, not by calling the contract from a
 * script. It implements the parts of the provider surface the app actually uses, and it
 * records every call so a test can assert what the UI asked the wallet to do.
 *
 * Behaviour is configurable per scenario by setting fields on `window.__pdMock` from a
 * later init script (see SCENARIOS):
 *   - `chainId`        which chain the wallet claims to be on
 *   - `accounts`       what `eth_accounts` / `eth_requestAccounts` return
 *   - `autoConnect`    return accounts without prompting (otherwise 4002-unavailable)
 *   - `rejectConnect`  reject the connection prompt (error code 4001)
 *   - `rejectWrite`    reject the signature prompt (error code 4001)
 *   - `requests`       every call the page made, for assertions
 *
 * It is deliberately a plain string: `addInitScript` takes source text, and keeping it as a
 * single self-contained unit means a test cannot accidentally depend on module state.
 */
export const MOCK_WALLET = `
(() => {
  const state = {
    // Computed, not guessed: 61999 === 0xF22F.
    //
    // This mock originally used 0xf7a1, which is 63393, so the "connected, correct network"
    // scenario was silently exercising the wrong-network path — and the app correctly refused
    // it, which is how the mistake surfaced. A literal hex chain id in a test double is a
    // trap; deriving it from the decimal id removes the class of error.
    chainId: 0xf22f,
    accounts: ["0x1111111111111111111111111111111111111111"],
    rejectConnect: false,
    rejectWrite: false,
    autoConnect: true,
    requests: [],
    signed: [],
    listeners: {},
  };
  window.__pdMock = state;

  const emit = (name) => {
    (state.listeners[name] || []).forEach((fn) => {
      try { fn({ type: name }); } catch (e) { /* a listener fault is the wallet's problem */ }
    });
  };

  const reject = (message, code) => {
    const err = new Error(message);
    err.code = code;
    return err;
  };

  const provider = {
    isMockPd: true,
    get chainId() { return "0x" + state.chainId.toString(16); },
    get selectedAddress() { return state.accounts[0] ?? null; },

    async request({ method, params }) {
      state.requests.push({ method, params });
      switch (method) {
        case "eth_requestAccounts":
          if (state.rejectConnect) throw reject("User rejected the request.", 4001);
          if (!state.autoConnect) throw reject("The user does not allow this site to connect.", 4002);
          return state.accounts;

        case "eth_accounts":
          return state.autoConnect ? state.accounts : [];

        case "eth_chainId":
          return "0x" + state.chainId.toString(16);

        case "wallet_switchEthereumChain": {
          const target = params && params[0] && params[0].chainId;
          if (!target) throw reject("No chainId supplied.", -32602);
          state.chainId = parseInt(target, 16);
          emit("chainChanged");
          return null;
        }

        case "net_version":
          return String(state.chainId);

        // The signing surface. Whether a signature is approved is the user's decision, so it
        // is modelled here rather than assumed, and a deterministic hash is returned so the
        // UI has something real-shaped to display.
        case "eth_sendTransaction":
        case "gen_write":
        case "eth_signTransaction": {
          // A wallet that asks to sign is asked to sign, and a wallet that is told to send
          // sends. Both return a transaction hash; neither is a broadcast the SDK does itself.
          if (state.rejectWrite) throw reject("User rejected the request.", 4001);
          const supplied = (params && params[0]) || {};
          state.signed.push({ method, tx: supplied });
          const seed = JSON.stringify(supplied) + state.requests.length;
          let h = "0x";
          for (let i = 0; i < 64; i++) h += ((seed.charCodeAt(i % seed.length) + i * 7) % 16).toString(16);

          if (method === "eth_signTransaction") {
            // Return a serialised transaction, not a hash: genlayer-js takes this value and
            // broadcasts it itself with sendRawTransaction. A realistic stub returns signed
            // bytes, so a hash-shaped string here would hide an integration mismatch.
            return "0x" + h.slice(2) + h.slice(2);
          }
          return h;
        }

        case "wallet_disconnect":
          state.accounts = [];
          state.autoConnect = false;
          return null;

        default:
          // Unknown methods return null, like a minimal injected provider. The app must cope
          // rather than crash.
          return null;
      }
    },

    on(event, fn) {
      (state.listeners[event] = state.listeners[event] || []).push(fn);
      return provider;
    },
    removeListener(event, fn) {
      const list = state.listeners[event] || [];
      state.listeners[event] = list.filter((f) => f !== fn);
      return provider;
    },
  };

  Object.defineProperty(window, "ethereum", { value: provider, configurable: true, writable: true });
})();
`;

/** Scenario presets, applied as a second init script so they run after MOCK_WALLET. */
export const SCENARIOS = {
  connected: "window.__pdMock.chainId = 0xf22f; window.__pdMock.autoConnect = true;",
  wrongNetwork: "window.__pdMock.chainId = 0x1; window.__pdMock.autoConnect = true;",
  rejectConnect: "window.__pdMock.rejectConnect = true;",
  rejectWrite: "window.__pdMock.rejectWrite = true;",
  disconnect: "window.__pdMock.accounts = []; window.__pdMock.autoConnect = false;",
};
