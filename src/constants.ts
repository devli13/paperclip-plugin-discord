export const PLUGIN_ID = "paperclip-plugin-discord";
export const PLUGIN_VERSION = "0.9.2";

export const WEBHOOK_KEYS = {
  discordInteractions: "discord-interactions",
} as const;

export const SLOT_IDS = {
  settingsPage: "discord-settings-page",
} as const;

export const EXPORT_NAMES = {
  settingsPage: "DiscordSettingsPage",
} as const;

export const DEFAULT_CONFIG = {
  discordBotTokenRef: "",
  paperclipBoardApiKeyRef: "",
  defaultGuildId: "",
  defaultChannelId: "",
  approvalsChannelId: "",
  errorsChannelId: "",
  bdPipelineChannelId: "",
  notifyOnIssueCreated: true,
  notifyOnIssueDone: true,
  notifyOnApprovalCreated: true,
  notifyOnAgentError: true,
  enableIntelligence: false,
  intelligenceChannelIds: [] as string[],
  escalationChannelId: "",
  enableEscalations: true,
  escalationTimeoutMinutes: 30,
  mediaChannelIds: [] as string[],
  enableMediaPipeline: false,
  enableCustomCommands: false,
  enableProactiveSuggestions: false,
  proactiveScanIntervalMinutes: 15,
  enableCommands: true,
  enableInbound: true,
  topicRouting: false,
  digestMode: "off" as string,
  dailyDigestTime: "09:00",
  bidailySecondTime: "17:00",
  tridailyTimes: "07:00,13:00,19:00",
  companyChannels: {} as Record<string, string>,
  approvalsChannels: {} as Record<string, string>,
  // -------- devli13 fork additions --------
  // Route free-form @mentions of the bot in channels to an agent invoke.
  // (Upstream only handles replies to bot notifications.)
  enableFreeFormMentions: false,
  // Route bot DMs to an agent invoke. Requires DIRECT_MESSAGES gateway intent
  // (which this fork requests when enabled).
  enableDirectMessages: false,
  // The agent that receives free-form @mentions (singleAgent mode).
  mentionAgentId: "",
  // The agent that receives DMs. Defaults to mentionAgentId if unset.
  dmAgentId: "",
  // Company ID used when invoking the mention/DM agent. If blank, the plugin
  // tries to resolve from guild→company routing.
  mentionCompanyId: "",
  // Max queued inbound messages per (guild, channel) before new ones are dropped.
  messageQueueMaxDepth: 10,
  // Drop enqueued messages older than this before processing.
  messageQueueStaleSeconds: 600,
  // On Gateway ready (startup + reconnect), sweep channels for @mentions the
  // bot missed while offline. Strict detection: only counts as "addressed" if
  // the bot posted a reply-referenced message to the mention.
  enableMentionBackfill: false,
  // How far back the backfill will look. Older messages are ignored.
  backfillMaxHours: 24,
  // Safety cap on messages fetched per channel during backfill.
  backfillMaxMessagesPerChannel: 300,
  // Channels to scan. Empty = all text + announcement channels in defaultGuildId.
  backfillChannelIds: [] as string[],
  // Explicit guild→company mapping for mention/DM routing in multi-company
  // deployments. Keys are Discord guild IDs; values are Paperclip company
  // UUIDs. Consulted after config.mentionCompanyId. When neither is set,
  // mention routing refuses to invoke (safer than guessing).
  guildCompanies: {} as Record<string, string>,
} as const;

export const DISCORD_API_BASE = "https://discord.com/api/v10";

export const COLORS = {
  BLUE: 0x5865f2,
  GREEN: 0x57f287,
  YELLOW: 0xfee75c,
  RED: 0xed4245,
  ORANGE: 0xffaa00,
  GRAY: 0x95a5a6,
  PURPLE: 0x9b59b6,
} as const;

export const METRIC_NAMES = {
  sent: "discord_notifications_sent",
  failed: "discord_notification_failures",
  commandsHandled: "discord_commands_handled",
  signalsExtracted: "discord_signals_extracted",
  approvalsDecided: "discord_approvals_decided",
  gatewayReconnections: "discord_gateway_reconnections",
  escalationsCreated: "discord_escalations_created",
  escalationsResolved: "discord_escalations_resolved",
  escalationsTimedOut: "discord_escalations_timed_out",
  agentSessionsCreated: "discord_agent_sessions_created",
  agentMessagesRouted: "discord_agent_messages_routed",
  mediaProcessed: "discord_media_processed",
  customCommandsExecuted: "discord_custom_commands_executed",
  watchesTriggered: "discord_watches_triggered",
  inboundRouted: "discord_inbound_routed",
  digestSent: "discord_digest_sent",
  workflowsExecuted: "discord_workflows_executed",
  budgetWarningsSent: "discord_budget_warnings_sent",
} as const;

export const ROLE_WEIGHTS: Record<string, number> = {
  admin: 5,
  administrator: 5,
  mod: 5,
  moderator: 5,
  maintainer: 5,
  contributor: 3,
  cliptributor: 3,
};
export const DEFAULT_ROLE_WEIGHT = 1;

export const BACKFILL_MAX_MESSAGES_PER_CHANNEL = 5000;
export const BACKFILL_PAGE_DELAY_MS = 500;
export const BACKFILL_DEFAULT_DAYS = 90;
export const BACKFILL_SIGNAL_CAP = 200;

export const ESCALATION_TIMEOUT_MS = 30 * 60 * 1000;
export const ESCALATION_CHECK_INTERVAL_CRON = "*/5 * * * *";

export const BUDGET_ALERT_THRESHOLD = 0.8; // 80%
export const BUDGET_CHECK_INTERVAL_CRON = "*/5 * * * *";

export const MAX_AGENTS_PER_THREAD = 5;
export const MAX_CONVERSATION_TURNS = 50;
export const DISCUSSION_STALE_MS = 5 * 60 * 1000;

export const ACP_PLUGIN_EVENT_PREFIX = "plugin.paperclip-plugin-acp";
export const DISCORD_PLUGIN_EVENT_PREFIX = "plugin.paperclip-plugin-discord";
