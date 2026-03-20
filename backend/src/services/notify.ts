/**
 * Notification Service
 *
 * Replaces Manus notifyOwner with Telegram Bot API.
 * Falls back to console.log if Telegram is not configured.
 */

import { CONFIG } from "../config.js";

export interface NotificationPayload {
  title: string;
  content: string;
}

/**
 * Send a notification via Telegram Bot API.
 * Returns true if sent successfully, false otherwise.
 */
export async function notifyOwner(payload: NotificationPayload): Promise<boolean> {
  const { title, content } = payload;
  const message = `🔔 *${escapeMarkdown(title)}*\n\n${escapeMarkdown(content)}`;

  // Always log to console
  console.log(`[Notify] ${title}: ${content.substring(0, 200)}`);

  // If Telegram is configured, send there too
  if (CONFIG.telegramBotToken && CONFIG.telegramChatId) {
    try {
      const url = `https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CONFIG.telegramChatId,
          text: message,
          parse_mode: "MarkdownV2",
          disable_web_page_preview: true,
        }),
      });

      if (!res.ok) {
        // Retry without markdown if parse fails
        const retry = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: CONFIG.telegramChatId,
            text: `🔔 ${title}\n\n${content}`,
            disable_web_page_preview: true,
          }),
        });
        return retry.ok;
      }
      return true;
    } catch (err) {
      console.warn("[Notify] Telegram send failed:", err);
      return false;
    }
  }

  return true; // Console-only is still a success
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}
