import type { Wallet, JsonRpcSigner } from 'ethers';
import type { ContentGraph, PersonaProfile, UISpec } from '../core/types';
import { buildMessages } from '../core/prompt';
import { assertValidUISpec } from '../core/uispec-validate';

export interface Broker { chat(messages: { system: string; user: string }): Promise<string>; }

// NOTE on the signer type: the installed SDK's `createZGComputeNetworkBroker`
// (see node_modules/@0gfoundation/0g-compute-ts-sdk/types/broker.d.ts) types
// its `signer` param as `JsonRpcSigner | Wallet`, not the generic ethers
// `Signer` interface. We match that exactly here so the call below typechecks;
// `new ethers.Wallet(...)` (used by scripts/try-inference.ts) satisfies it.
type ZeroGSigner = Wallet | JsonRpcSigner;

/**
 * Builds a `Broker` backed by the real 0G Compute Network SDK.
 *
 * The SDK is loaded lazily via dynamic `import()` the first time `chat()` is
 * called (and memoized after that), so requiring this module — and running
 * the existing unit tests, which only ever exercise `requestUISpec` with a
 * mock `Broker` — never pulls the SDK (and its wallet/network machinery)
 * into the process.
 */
export function createZeroGBroker(signer: ZeroGSigner, providerAddress: string): Broker {
  type SdkBroker = Awaited<ReturnType<typeof import('@0gfoundation/0g-compute-ts-sdk').createZGComputeNetworkBroker>>;
  let brokerPromise: Promise<SdkBroker> | null = null;

  async function initBroker(): Promise<SdkBroker> {
    const { createZGComputeNetworkBroker } = await import('@0gfoundation/0g-compute-ts-sdk');
    const sdkBroker = await createZGComputeNetworkBroker(signer);
    try {
      await sdkBroker.inference.acknowledgeProviderSigner(providerAddress);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/already/i.test(message) && /acknowledg/i.test(message)) {
        console.log(`[zerog-compute] provider ${providerAddress} already acknowledged, continuing`);
      } else {
        throw err;
      }
    }
    return sdkBroker;
  }

  return {
    async chat({ system, user }: { system: string; user: string }): Promise<string> {
      if (!brokerPromise) {
        // Memoize on success; on failure, clear so a later chat() call retries init.
        brokerPromise = initBroker().catch((err) => {
          brokerPromise = null;
          throw err;
        });
      }
      const sdkBroker = await brokerPromise;

      const { endpoint, model } = await sdkBroker.inference.getServiceMetadata(providerAddress);
      const headers = await sdkBroker.inference.getRequestHeaders(providerAddress);

      const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ]
        })
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw new Error(`0G inference HTTP ${res.status}: ${bodyText}`);
      }

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error(`0G inference: unexpected response shape (missing choices[0].message.content): ${JSON.stringify(data)}`);
      }
      return content;
    }
  };
}

function extractJson(s: string): unknown {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf('{'); const end = body.lastIndexOf('}');
  return JSON.parse(body.slice(start, end + 1));
}
export async function requestUISpec(graph: ContentGraph, profile: PersonaProfile, broker: Broker): Promise<UISpec> {
  const raw = await broker.chat(buildMessages(graph, profile));
  return assertValidUISpec(extractJson(raw), graph);
}
