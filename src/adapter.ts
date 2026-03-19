import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { DiscordEmbed, DiscordComponent, DiscordMessage } from "./discord-api.js";
import { DISCORD_API_BASE } from "./constants.js";
import { withRetry } from "./retry.js";

export interface PlatformAdapter {
  sendText(channelId: string, text: string): Promise<string | null>;
  sendButtons(
    channelId: string,
    embeds: DiscordEmbed[],
    components: DiscordComponent[],
  ): Promise<string | null>;
  editMessage(
    channelId: string,
    messageId: string,
    message: DiscordMessage,
  ): Promise<boolean>;
  formatAgentLabel(agentName: string): string;
  formatMention(userId: string): string;
  formatCodeBlock(text: string, language?: string): string;
}

export class DiscordAdapter implements PlatformAdapter {
  constructor(
    private ctx: PluginContext,
    private token: string,
  ) {}

  async sendText(channelId: string, text: string): Promise<string | null> {
    try {
      const response = await withRetry(() =>
        this.ctx.http.fetch(
          `${DISCORD_API_BASE}/channels/${channelId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bot ${this.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ content: text }),
          },
        ),
      );

      if (!response.ok) {
        const body = await response.text();
        this.ctx.logger.warn("sendText failed", {
          status: response.status,
          body,
          channelId,
        });
        return null;
      }

      const data = (await response.json()) as { id: string };
      return data.id;
    } catch (error) {
      this.ctx.logger.error("sendText error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async sendButtons(
    channelId: string,
    embeds: DiscordEmbed[],
    components: DiscordComponent[],
  ): Promise<string | null> {
    try {
      const response = await withRetry(() =>
        this.ctx.http.fetch(
          `${DISCORD_API_BASE}/channels/${channelId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bot ${this.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ embeds, components }),
          },
        ),
      );

      if (!response.ok) {
        const body = await response.text();
        this.ctx.logger.warn("sendButtons failed", {
          status: response.status,
          body,
          channelId,
        });
        return null;
      }

      const data = (await response.json()) as { id: string };
      return data.id;
    } catch (error) {
      this.ctx.logger.error("sendButtons error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async editMessage(
    channelId: string,
    messageId: string,
    message: DiscordMessage,
  ): Promise<boolean> {
    try {
      const response = await withRetry(() =>
        this.ctx.http.fetch(
          `${DISCORD_API_BASE}/channels/${channelId}/messages/${messageId}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bot ${this.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              content: message.content,
              embeds: message.embeds,
              components: message.components,
            }),
          },
        ),
      );

      if (!response.ok) {
        const body = await response.text();
        this.ctx.logger.warn("editMessage failed", {
          status: response.status,
          body,
          channelId,
          messageId,
        });
        return false;
      }

      return true;
    } catch (error) {
      this.ctx.logger.error("editMessage error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  formatAgentLabel(agentName: string): string {
    return `**[${agentName}]**`;
  }

  formatMention(userId: string): string {
    return `<@${userId}>`;
  }

  formatCodeBlock(text: string, language?: string): string {
    const lang = language ?? "";
    return `\`\`\`${lang}\n${text}\n\`\`\``;
  }
}
