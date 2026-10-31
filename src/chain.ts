import { config } from "./config.ts";
import type { Curve } from "./strategy.ts";

/** Lit le compte bonding curve pump.fun : [8 discriminator][vTokens u64][vSol u64][realTokens][realSol][supply][complete u8]. */
export async function fetchCurve(bondingCurveKey: string): Promise<Curve> {
  const res = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [bondingCurveKey, { encoding: "base64" }] }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const { result, error } = (await res.json()) as any;
  if (error || !result?.value) throw new Error(`curve introuvable : ${error?.message ?? bondingCurveKey}`);
  const b = Buffer.from(result.value.data[0], "base64");
  return { vTokens: b.readBigUInt64LE(8), vSol: b.readBigUInt64LE(16), complete: b[48] === 1 };
}

/** JSON de métadonnées du token. ipfs.io ne sert plus de JSON : on passe par la passerelle de pump.fun. */
export async function fetchMetadata(uri: string): Promise<Record<string, unknown>> {
  const cid = uri.split("/ipfs/")[1];
  const url = cid ? `https://pump.mypinata.cloud/ipfs/${cid}` : uri;
  const res = await fetch(url, { signal: AbortSignal.timeout(4_000) });
  if (!res.ok) throw new Error(`métadonnées ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}
