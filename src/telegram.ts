import { config } from "./config.ts";

// Bot Telegram de Brigitte : notifications d'achat/vente et commandes depuis le mobile.
// Doc : https://core.telegram.org/bots/api — long polling (getUpdates), pas de webhook : rien à exposer sur internet.

export type Button = { text: string; data: string };
export type Reply = string | { text: string; buttons?: Button[][] };
export type Handlers = Record<string, (arg: string) => Promise<Reply>>;

const enabled = () => Boolean(config.telegramToken);

/** Échappe le texte pour parse_mode HTML : les noms de tokens sont choisis par n'importe qui. */
export const h = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

/** Adresse Solana plausible (base58, 32 à 44 caractères) : seule entrée libre acceptée pour /acheter. */
export const isMint = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

/** « /acheter@BrigitteBot  ABC » → { name: "acheter", arg: "ABC" } ; null si ce n'est pas une commande. */
export function parseCommand(text: string): { name: string; arg: string } | null {
  const m = /^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  return m ? { name: m[1].toLowerCase(), arg: (m[2] ?? "").trim() } : null;
}

async function api(method: string, body: object, timeoutMs = 10_000): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
  // Jamais l'URL dans l'erreur : elle contient le token du bot.
  if (!json.ok) throw new Error(`${method} : ${json.description ?? res.status}`);
  return json.result;
}

function send(chatId: string, reply: Reply) {
  const { text, buttons } = typeof reply === "string" ? { text: reply, buttons: undefined } : reply;
  return api("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: buttons && { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) },
  });
}

/** Message au propriétaire du bot ; une panne Telegram est loguée sans bloquer le trading. */
export function notify(reply: Reply) {
  if (!enabled() || !config.telegramChatId) return;
  send(config.telegramChatId, reply).catch((e) => console.error(`[telegram] ${(e as Error).message}`));
}

/**
 * Écoute les commandes. Seul TELEGRAM_CHAT_ID peut piloter Brigitte : les autres chats sont ignorés.
 * Sans TELEGRAM_CHAT_ID, le bot répond seulement son chat id à qui lui écrit, pour la configuration.
 */
export async function startTelegram(handlers: Handlers, menu: [string, string][]) {
  if (!enabled()) return;
  await api("setMyCommands", { commands: menu.map(([command, description]) => ({ command, description })) }).catch((e) =>
    console.error(`[telegram] ${(e as Error).message}`),
  );
  console.log(`[telegram] actif${config.telegramChatId ? "" : " (TELEGRAM_CHAT_ID manquant : envoie /start au bot pour l'obtenir)"}`);

  let offset = 0;
  for (;;) {
    try {
      const updates = await api("getUpdates", { offset, timeout: 30, allowed_updates: ["message", "callback_query"] }, 40_000);
      for (const u of updates) {
        offset = u.update_id + 1;
        void handle(u, handlers).catch((e) => console.error(`[telegram] ${(e as Error).message}`));
      }
    } catch (e) {
      // Token invalide, 409 (une autre instance écoute déjà ce bot) ou réseau : on réessaie sans tuer le bot.
      console.error(`[telegram] ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}

async function handle(u: any, handlers: Handlers) {
  const query = u.callback_query;
  if (query) await api("answerCallbackQuery", { callback_query_id: query.id });
  const chatId = String((u.message ?? query?.message)?.chat?.id ?? "");
  if (!chatId) return;
  if (!config.telegramChatId) {
    return send(chatId, `Ton chat id : <code>${h(chatId)}</code>\nAjoute <code>TELEGRAM_CHAT_ID=${h(chatId)}</code> dans .env puis redémarre Brigitte.`);
  }
  if (chatId !== config.telegramChatId) return;

  // Les boutons envoient « vendre <mint> » : même parcours qu'une commande tapée.
  const cmd = parseCommand(query ? `/${query.data}` : (u.message?.text ?? ""));
  if (!cmd) return;
  const run = handlers[cmd.name] ?? handlers.aide;
  await send(chatId, await run(cmd.arg).catch((e) => `Erreur : ${h((e as Error).message)}`));
}
