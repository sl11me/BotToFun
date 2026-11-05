import {
  createKeyPairSignerFromBytes,
  getBase58Encoder,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  type KeyPairSigner,
} from "@solana/kit";
import { config } from "./config.ts";

// Jupiter Swap V2 (meta-aggregator) : /order + /execute. Doc : https://developers.jup.ag/docs/swap/order-and-execute
const BASE_URL = "https://api.jup.ag/swap/v2";
export const SOL_MINT = "So11111111111111111111111111111111111111112";

const headers: Record<string, string> = config.jupiterApiKey ? { "x-api-key": config.jupiterApiKey } : {};

type Order = { transaction: string | null; requestId: string; outAmount: string; errorMessage?: string };

let signer: KeyPairSigner | undefined;
async function getSigner() {
  signer ??= await createKeyPairSignerFromBytes(getBase58Encoder().encode(config.privateKey));
  return signer;
}

/** Adresse publique du wallet de Brigitte, déduite de BS58_PRIVATE_KEY. */
export const walletAddress = async () => (await getSigner()).address;

async function order(inputMint: string, outputMint: string, amount: bigint, taker?: string): Promise<Order> {
  const params = new URLSearchParams({ inputMint, outputMint, amount: amount.toString() });
  if (taker) params.set("taker", taker);
  const res = await fetch(`${BASE_URL}/order?${params}`, { headers, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`/order ${res.status}: ${await res.text()}`);
  return res.json() as Promise<Order>;
}

/** Montant de sortie attendu (unités brutes), sans transaction. */
export async function quote(inputMint: string, outputMint: string, amount: bigint): Promise<bigint> {
  return BigInt((await order(inputMint, outputMint, amount)).outAmount);
}

/** Exécute réellement le swap. Renvoie la signature et le montant reçu. */
export async function swap(inputMint: string, outputMint: string, amount: bigint) {
  const s = await getSigner();
  const o = await order(inputMint, outputMint, amount, s.address);
  if (!o.transaction) throw new Error(`pas de transaction : ${o.errorMessage ?? "inconnue"}`);

  const tx = getTransactionDecoder().decode(Buffer.from(o.transaction, "base64"));
  // La tx décodée n'a pas de lifetime typé, mais le blockhash est bien dans le message construit par Jupiter.
  const signed = await partiallySignTransaction([s.keyPair], tx as Parameters<typeof partiallySignTransaction>[1]);
  const res = await fetch(`${BASE_URL}/execute`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      signedTransaction: Buffer.from(getTransactionEncoder().encode(signed)).toString("base64"),
      requestId: o.requestId,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`/execute ${res.status}: ${await res.text()}`);
  const r = (await res.json()) as { status: string; signature: string; code: number; totalOutputAmount: string; error?: string };
  if (r.status !== "Success") throw new Error(`swap échoué (code ${r.code}) ${r.signature ?? ""} ${r.error ?? ""}`);
  return { signature: r.signature, outAmount: BigInt(r.totalOutputAmount) };
}

// Tokens API v2 : https://developers.jup.ag/docs/api-reference/tokens
export type JupToken = {
  id: string;
  name: string;
  symbol: string;
  dev?: string | null;
  launchpad?: string | null;
  firstPool?: { id: string; createdAt: string } | null;
  telegram?: string | null;
  liquidity: number | null;
  mcap: number | null;
  usdPrice: number | null;
  stats5m?: { buyVolume?: number; sellVolume?: number } | null;
};

async function tokensApi(path: string): Promise<JupToken[]> {
  const res = await fetch(`https://api.jup.ag/tokens/v2/${path}`, { headers, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`tokens/${path.split("?")[0]} ${res.status}`);
  return res.json() as Promise<JupToken[]>;
}

/** Tokens dont la première pool vient d'être créée, toutes plateformes confondues (~30 derniers). */
export const recentTokens = () => tokensApi("recent");

/** Données à jour (prix, liquidité, volumes, réseaux sociaux) d'un ou plusieurs mints. */
export const tokenInfo = (mints: string[]) => tokensApi(`search?query=${mints.join(",")}`);
