import { config } from "./config.ts";
import type { Curve, MintInfo, RugReport } from "./strategy.ts";

/** Lit le compte bonding curve pump.fun : [8 discriminator][vTokens u64][vSol u64][realTokens][realSol][supply][complete u8]. */
export async function fetchCurve(bondingCurveKey: string): Promise<Curve> {
  const res = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [bondingCurveKey, { encoding: "base64", commitment: "confirmed" }] }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const { result, error } = (await res.json()) as any;
  if (error || !result?.value) throw new Error(`curve introuvable : ${error?.message ?? bondingCurveKey}`);
  const b = Buffer.from(result.value.data[0], "base64");
  return { vTokens: b.readBigUInt64LE(8), vSol: b.readBigUInt64LE(16), complete: b[48] === 1 };
}

// ipfs.io, dweb.link, w3s.link… ne servent plus de JSON (page « service worker gateway ») : passerelles testées le 03/11/2026.
const IPFS_GATEWAYS = ["https://pump.mypinata.cloud/ipfs/", "https://gateway.pinata.cloud/ipfs/", "https://4everland.io/ipfs/"];

/** JSON de métadonnées du token, en essayant chaque passerelle IPFS tant que la précédente refuse (403, 429…). */
export async function fetchMetadata(uri: string): Promise<Record<string, unknown>> {
  const cid = uri.split("/ipfs/")[1];
  let status = 0;
  for (const url of cid ? IPFS_GATEWAYS.map((g) => g + cid) : [uri]) {
    const res = await fetch(url, { signal: AbortSignal.timeout(4_000) }).catch(() => null);
    if (res?.ok) return res.json() as Promise<Record<string, unknown>>;
    status = res?.status ?? 0;
  }
  throw new Error(`métadonnées ${status}`);
}

/** Solde d'un wallet en SOL. */
export async function fetchBalance(address: string): Promise<number> {
  const res = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address, { commitment: "confirmed" }] }),
    signal: AbortSignal.timeout(5_000),
  });
  const lamports = ((await res.json()) as any).result?.value;
  if (typeof lamports !== "number") throw new Error(`getBalance ${res.status}`);
  return lamports / 1e9;
}

/** Programme propriétaire d'un compte (sert à reconnaître la plateforme d'une pool). */
export async function accountOwner(address: string): Promise<string | undefined> {
  const res = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [address, { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 0, length: 0 } }] }),
    signal: AbortSignal.timeout(5_000),
  });
  return ((await res.json()) as any).result?.value?.owner;
}

// commitment "confirmed" : avec "finalized" (défaut), un mint créé il y a moins de ~15 s est encore introuvable.
// PumpPortal annonce le token dès la transaction traitée, ~1 s avant confirmation : on relit jusqu'à 3 fois.
/** Compte mint on-chain : programme, autorités et extensions Token-2022. */
export async function fetchMint(mint: string, attempt = 1): Promise<MintInfo> {
  const res = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [mint, { encoding: "jsonParsed", commitment: "confirmed" }] }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const { result, error } = (await res.json()) as any;
  const info = result?.value?.data?.parsed?.info;
  if (!error && !result?.value && attempt < 3) {
    await new Promise((r) => setTimeout(r, 1_500));
    return fetchMint(mint, attempt + 1);
  }
  if (error || !info) throw new Error(`mint illisible : ${error?.message ?? "compte introuvable"}`);
  return { program: result.value.owner, mintAuthority: info.mintAuthority, freezeAuthority: info.freezeAuthority, extensions: info.extensions ?? [] };
}

/** Rapport RugCheck complet (public, sans clé) : score, risques, holders, tokens du créateur. */
export async function fetchRugReport(mint: string): Promise<RugReport> {
  const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`rugcheck ${res.status}`);
  return res.json() as Promise<RugReport>;
}
