// ROYAL RED connector catalog.
//
// A connector is a pre-built integration with a third-party service. This
// file is DATA ONLY: it defines what the Settings cockpit offers in the
// Connectors section (categories, auth shape, docs links, key format hints).
// It never touches the database and never sees credentials: the encrypted
// credential lives in the RoyalRedConnector row and is decrypted upstream,
// before any tool or health check receives it (see tools.ts).
//
// Honesty rule: `built: false` means the entry is a planned definition only.
// Every health check and tool for a non-built connector returns a clear
// "connector not yet implemented" result instead of pretending. BUILT_COUNT
// is derived from the list so the number shown in the UI cannot drift from
// what this file actually ships.

export type ConnectorAuthType = 'api_key' | 'oauth2' | 'pat' | 'service_account' | 'none'

export interface ConnectorDef {
  id: string // 'github', 'google-drive', ...
  label: string
  category: 'file-storage' | 'code' | 'communication' | 'email' | 'calendar' | 'payments' | 'cms' | 'analytics' | 'search-knowledge' | 'social'
  authType: ConnectorAuthType
  baseUrl: string // real API base URL (placeholders like your-store.com stay until the connector is built)
  docsUrl: string // real documentation URL
  keyFormat?: string // hint shown in the connect dialog
  built: boolean
}

export const CONNECTOR_CATALOG: ConnectorDef[] = [
  // --- file storage -------------------------------------------------------
  { id: 'google-drive', label: 'Google Drive', category: 'file-storage', authType: 'oauth2', baseUrl: 'https://www.googleapis.com/drive/v3', docsUrl: 'https://developers.google.com/drive/api/v3/reference', keyFormat: 'OAuth access token (drive or drive.file scope), pasted as the credential', built: true },
  { id: 'dropbox', label: 'Dropbox', category: 'file-storage', authType: 'oauth2', baseUrl: 'https://api.dropboxapi.com/2', docsUrl: 'https://www.dropbox.com/developers/documentation/http/documentation', keyFormat: 'OAuth access token', built: false },
  { id: 'onedrive', label: 'OneDrive', category: 'file-storage', authType: 'oauth2', baseUrl: 'https://graph.microsoft.com/v1.0', docsUrl: 'https://learn.microsoft.com/en-us/onedrive/developer/rest-api/', keyFormat: 'Microsoft Graph access token with Files.ReadWrite', built: false },
  { id: 'box', label: 'Box', category: 'file-storage', authType: 'oauth2', baseUrl: 'https://api.box.com/2.0', docsUrl: 'https://developer.box.com/reference/', keyFormat: 'Developer token or OAuth access token', built: false },
  { id: 's3-compatible', label: 'S3 Compatible', category: 'file-storage', authType: 'service_account', baseUrl: 'https://s3.amazonaws.com', docsUrl: 'https://docs.aws.amazon.com/AmazonS3/latest/API/Welcome.html', keyFormat: 'Access key id plus secret; covers AWS S3, Cloudflare R2, MinIO and Backblaze B2 (endpoint and region go in config)', built: false },

  // --- code ----------------------------------------------------------------
  { id: 'github', label: 'GitHub', category: 'code', authType: 'pat', baseUrl: 'https://api.github.com', docsUrl: 'https://docs.github.com/rest', keyFormat: 'ghp_... or github_pat_... personal access token (repo and workflow scopes for writes)', built: true },
  { id: 'gitlab', label: 'GitLab', category: 'code', authType: 'pat', baseUrl: 'https://gitlab.com/api/v4', docsUrl: 'https://docs.gitlab.com/ee/api/', keyFormat: 'glpat-... personal access token (api scope)', built: true },
  { id: 'bitbucket', label: 'Bitbucket', category: 'code', authType: 'pat', baseUrl: 'https://api.bitbucket.org/2.0', docsUrl: 'https://developer.atlassian.com/cloud/bitbucket/rest/', keyFormat: 'Atlassian API token used as email:token basic auth', built: false },
  { id: 'linear', label: 'Linear', category: 'code', authType: 'api_key', baseUrl: 'https://api.linear.app/graphql', docsUrl: 'https://developers.linear.app/docs/graphql/working-with-the-graphql-api', keyFormat: 'API key from settings, security', built: false },
  { id: 'jira', label: 'Jira', category: 'code', authType: 'api_key', baseUrl: 'https://your-domain.atlassian.net', docsUrl: 'https://developer.atlassian.com/cloud/jira/platform/rest/v3/', keyFormat: 'email:API token, sent as HTTP basic auth; site URL goes in config', built: false },
  { id: 'clickup', label: 'ClickUp', category: 'code', authType: 'pat', baseUrl: 'https://api.clickup.com/api/v2', docsUrl: 'https://developer.clickup.com/reference', keyFormat: 'Personal API token (pk_... or cpm_...)', built: false },
  { id: 'trello', label: 'Trello', category: 'code', authType: 'api_key', baseUrl: 'https://api.trello.com/1', docsUrl: 'https://developer.atlassian.com/cloud/trello/rest/', keyFormat: 'Token as the credential, API key goes in config', built: false },
  { id: 'asana', label: 'Asana', category: 'code', authType: 'pat', baseUrl: 'https://app.asana.com/api/1.0', docsUrl: 'https://developers.asana.com/reference', keyFormat: 'Personal access token (1/... or 3/...)', built: false },
  { id: 'notion', label: 'Notion', category: 'code', authType: 'pat', baseUrl: 'https://api.notion.com/v1', docsUrl: 'https://developers.notion.com/reference', keyFormat: 'secret_... internal integration token (or OAuth access token); share the pages with the integration', built: true },

  // --- communication -------------------------------------------------------
  { id: 'slack', label: 'Slack', category: 'communication', authType: 'oauth2', baseUrl: 'https://slack.com/api', docsUrl: 'https://api.slack.com/web', keyFormat: 'xoxb-... bot user token from the app credentials page', built: true },
  { id: 'discord', label: 'Discord', category: 'communication', authType: 'pat', baseUrl: 'https://discord.com/api/v10', docsUrl: 'https://discord.com/developers/docs/reference', keyFormat: 'Bot token from the developer portal (Applications, Bot, Reset Token)', built: true },
  { id: 'telegram', label: 'Telegram', category: 'communication', authType: 'pat', baseUrl: 'https://api.telegram.org', docsUrl: 'https://core.telegram.org/bots/api', keyFormat: 'Bot token from @BotFather, e.g. 110201543:AAHdqTcv', built: true },
  { id: 'microsoft-teams', label: 'Microsoft Teams', category: 'communication', authType: 'oauth2', baseUrl: 'https://graph.microsoft.com/v1.0', docsUrl: 'https://learn.microsoft.com/en-us/graph/api/resources/chat?view=graph-rest-1.0', keyFormat: 'Microsoft Graph access token with ChannelMessage.Send', built: false },
  { id: 'google-chat', label: 'Google Chat', category: 'communication', authType: 'none', baseUrl: 'https://chat.googleapis.com/v1', docsUrl: 'https://developers.google.com/chat/api/reference/rest', keyFormat: 'Incoming webhook URL as the credential (no auth headers needed)', built: false },
  { id: 'whatsapp-business', label: 'WhatsApp Business', category: 'communication', authType: 'pat', baseUrl: 'https://graph.facebook.com/v18.0', docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api', keyFormat: 'Permanent system user access token with whatsapp_business_messaging; phone number id goes in config', built: false },

  // --- email ---------------------------------------------------------------
  { id: 'gmail', label: 'Gmail', category: 'email', authType: 'oauth2', baseUrl: 'https://gmail.googleapis.com', docsUrl: 'https://developers.google.com/gmail/api/reference/rest', keyFormat: 'OAuth access token (gmail.readonly plus gmail.send scopes)', built: true },
  { id: 'outlook', label: 'Outlook', category: 'email', authType: 'oauth2', baseUrl: 'https://graph.microsoft.com/v1.0', docsUrl: 'https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview', keyFormat: 'Microsoft Graph access token with Mail.ReadWrite and Mail.Send', built: false },
  { id: 'sendgrid', label: 'SendGrid', category: 'email', authType: 'api_key', baseUrl: 'https://api.sendgrid.com/v3', docsUrl: 'https://www.twilio.com/docs/sendgrid/api-reference', keyFormat: 'SG.... API key with mail.send', built: false },
  { id: 'mailgun', label: 'Mailgun', category: 'email', authType: 'api_key', baseUrl: 'https://api.mailgun.net/v3', docsUrl: 'https://documentation.mailgun.com/docs/mailgun/api-reference/', keyFormat: 'API key; sending domain goes in config', built: false },
  { id: 'postmark', label: 'Postmark', category: 'email', authType: 'api_key', baseUrl: 'https://api.postmarkapp.com', docsUrl: 'https://postmarkapp.com/developer/api/overview', keyFormat: 'Server API token (X-Postmark-Server-Token)', built: false },
  { id: 'resend', label: 'Resend', category: 'email', authType: 'api_key', baseUrl: 'https://api.resend.com', docsUrl: 'https://resend.com/docs/api-reference', keyFormat: 're_... API key', built: false },

  // --- calendar ------------------------------------------------------------
  { id: 'google-calendar', label: 'Google Calendar', category: 'calendar', authType: 'oauth2', baseUrl: 'https://www.googleapis.com/calendar/v3', docsUrl: 'https://developers.google.com/calendar/api/v3/reference', keyFormat: 'OAuth access token (calendar.events scope)', built: true },
  { id: 'outlook-calendar', label: 'Outlook Calendar', category: 'calendar', authType: 'oauth2', baseUrl: 'https://graph.microsoft.com/v1.0', docsUrl: 'https://learn.microsoft.com/en-us/graph/api/resources/calendar-api-overview', keyFormat: 'Microsoft Graph access token with Calendars.ReadWrite', built: false },
  { id: 'calendly', label: 'Calendly', category: 'calendar', authType: 'oauth2', baseUrl: 'https://api.calendly.com', docsUrl: 'https://developer.calendly.com/api-docs', keyFormat: 'Personal access token or OAuth access token', built: false },
  { id: 'cal-com', label: 'Cal.com', category: 'calendar', authType: 'api_key', baseUrl: 'https://app.cal.com/api', docsUrl: 'https://cal.com/docs/api-reference', keyFormat: 'API key from settings, security (cal_live_...)', built: false },

  // --- payments ------------------------------------------------------------
  { id: 'stripe', label: 'Stripe', category: 'payments', authType: 'api_key', baseUrl: 'https://api.stripe.com/v1', docsUrl: 'https://stripe.com/docs/api', keyFormat: 'sk_live_... or sk_test_... secret key', built: true },
  { id: 'paypal', label: 'PayPal', category: 'payments', authType: 'oauth2', baseUrl: 'https://api-m.paypal.com/v1', docsUrl: 'https://developer.paypal.com/api/rest/', keyFormat: 'OAuth access token (client id and secret go in config)', built: false },
  { id: 'lemon-squeezy', label: 'Lemon Squeezy', category: 'payments', authType: 'api_key', baseUrl: 'https://api.lemonsqueezy.com/v1', docsUrl: 'https://docs.lemonsqueezy.com/api', keyFormat: 'API key from settings', built: false },
  { id: 'shopify', label: 'Shopify', category: 'payments', authType: 'pat', baseUrl: 'https://your-store.myshopify.com/admin/api/2024-01', docsUrl: 'https://shopify.dev/docs/api/admin-rest', keyFormat: 'shpat_... Admin API access token; the store URL goes in config.storeUrl', built: true },
  { id: 'woocommerce', label: 'WooCommerce', category: 'payments', authType: 'api_key', baseUrl: 'https://your-store.com/wp-json/wc/v3', docsUrl: 'https://woocommerce.github.io/woocommerce-rest-api-docs/', keyFormat: 'consumer key:consumer secret (ck_.../cs_...) as the credential; store URL goes in config', built: false },
  { id: 'paddle', label: 'Paddle', category: 'payments', authType: 'api_key', baseUrl: 'https://api.paddle.com', docsUrl: 'https://developer.paddle.com/api-reference', keyFormat: 'API key from developer tools', built: false },

  // --- cms -----------------------------------------------------------------
  { id: 'wordpress', label: 'WordPress', category: 'cms', authType: 'pat', baseUrl: 'https://your-site.com/wp-json/wp/v2', docsUrl: 'https://developer.wordpress.org/rest-api/reference/', keyFormat: 'WORDPRESS_USER:APPLICATION_PASSWORD as the credential (users, profile, application passwords); the site URL goes in config.siteUrl. This connector drives an existing WordPress site, it is not a build target', built: true },
  { id: 'contentful', label: 'Contentful', category: 'cms', authType: 'pat', baseUrl: 'https://api.contentful.com', docsUrl: 'https://www.contentful.com/developers/docs/references/content-management-api/', keyFormat: 'CFPAT-... Content Management API token; the space id goes in config.spaceId', built: true },
  { id: 'sanity', label: 'Sanity', category: 'cms', authType: 'pat', baseUrl: 'https://api.sanity.io/v2021-10-04', docsUrl: 'https://www.sanity.io/docs/http-api', keyFormat: 'API token; the project id goes in config', built: false },
  { id: 'strapi', label: 'Strapi', category: 'cms', authType: 'api_key', baseUrl: 'https://your-strapi.com/api', docsUrl: 'https://docs.strapi.io/dev-docs/api/rest', keyFormat: 'API token from admin settings; instance URL goes in config', built: false },
  { id: 'ghost', label: 'Ghost', category: 'cms', authType: 'service_account', baseUrl: 'https://your-ghost.com/ghost/api/admin', docsUrl: 'https://ghost.org/docs/admin-api/', keyFormat: 'Admin API key as id:secret (staff, integrations); site URL goes in config', built: false },
  { id: 'webflow', label: 'Webflow', category: 'cms', authType: 'oauth2', baseUrl: 'https://api.webflow.com/v2', docsUrl: 'https://developers.webflow.com/data/reference', keyFormat: 'OAuth access token or API token', built: false },

  // --- analytics -----------------------------------------------------------
  { id: 'google-analytics', label: 'Google Analytics', category: 'analytics', authType: 'service_account', baseUrl: 'https://analyticsdata.googleapis.com/v1beta', docsUrl: 'https://developers.google.com/analytics/devguides/reporting/data/v1/rest', keyFormat: 'Access token for the service account (analytics.readonly); the GA4 property id goes in config.propertyId', built: true },
  { id: 'plausible', label: 'Plausible', category: 'analytics', authType: 'api_key', baseUrl: 'https://plausible.io/api/v1', docsUrl: 'https://plausible.io/docs/stats-api', keyFormat: 'API key from settings; site domain goes in config', built: false },
  { id: 'mixpanel', label: 'Mixpanel', category: 'analytics', authType: 'service_account', baseUrl: 'https://api.mixpanel.com', docsUrl: 'https://developer.mixpanel.com/reference/overview', keyFormat: 'Service account username and secret go in config', built: false },
  { id: 'posthog', label: 'PostHog', category: 'analytics', authType: 'api_key', baseUrl: 'https://app.posthog.com/api', docsUrl: 'https://posthog.com/docs/api', keyFormat: 'phx_... personal API key; the project id goes in config.projectId', built: true },
  { id: 'sentry', label: 'Sentry', category: 'analytics', authType: 'pat', baseUrl: 'https://sentry.io/api/0', docsUrl: 'https://docs.sentry.io/api/', keyFormat: 'User auth token (org:read, project:read, event:read); the org slug goes in config.org', built: true },
  { id: 'datadog', label: 'Datadog', category: 'analytics', authType: 'api_key', baseUrl: 'https://api.datadoghq.com/api/v1', docsUrl: 'https://docs.datadoghq.com/api/latest/', keyFormat: 'Application key (DD-APPLICATION-KEY) plus API key (DD-API-KEY), both go in config', built: false },

  // --- search and knowledge ------------------------------------------------
  { id: 'algolia', label: 'Algolia', category: 'search-knowledge', authType: 'api_key', baseUrl: 'https://ALGOLIA_APP_ID-dsn.algolia.net/1', docsUrl: 'https://www.algolia.com/doc/rest-api/search/', keyFormat: 'Admin API key as the credential; the application id goes in config.appId', built: true },
  { id: 'meilisearch', label: 'Meilisearch', category: 'search-knowledge', authType: 'api_key', baseUrl: 'https://your-meilisearch-instance', docsUrl: 'https://www.meilisearch.com/docs/reference/api/overview', keyFormat: 'Master or admin API key; instance URL goes in config', built: false },
  { id: 'typesense', label: 'Typesense', category: 'search-knowledge', authType: 'api_key', baseUrl: 'https://your-typesense-instance:8108', docsUrl: 'https://typesense.org/docs/', keyFormat: 'Admin API key (X-TYPESENSE-API-Key); instance URL goes in config', built: false },
  { id: 'pinecone', label: 'Pinecone', category: 'search-knowledge', authType: 'api_key', baseUrl: 'https://api.pinecone.io', docsUrl: 'https://docs.pinecone.io/reference/api', keyFormat: 'API key from the console; index host goes in config', built: false },
  { id: 'weaviate', label: 'Weaviate', category: 'search-knowledge', authType: 'api_key', baseUrl: 'https://your-weaviate-instance/v1', docsUrl: 'https://weaviate.io/developers/weaviate/api/rest', keyFormat: 'API key (clusters with auth enabled); instance URL goes in config', built: false },
  { id: 'qdrant', label: 'Qdrant', category: 'search-knowledge', authType: 'api_key', baseUrl: 'https://your-qdrant-instance:6333', docsUrl: 'https://api.qdrant.tech/', keyFormat: 'API key (managed cloud or auth-enabled instances); instance URL goes in config', built: false },

  // --- social --------------------------------------------------------------
  { id: 'x', label: 'X', category: 'social', authType: 'oauth2', baseUrl: 'https://api.twitter.com/2', docsUrl: 'https://developer.x.com/en/docs/twitter-api', keyFormat: 'OAuth 2.0 user access token (tweet.read, tweet.write, users.read, offline.access scopes)', built: true },
  { id: 'linkedin', label: 'LinkedIn', category: 'social', authType: 'oauth2', baseUrl: 'https://api.linkedin.com/v2', docsUrl: 'https://learn.microsoft.com/en-us/linkedin/', keyFormat: 'OAuth 2.0 access token (openid, profile, w_member_social scopes)', built: true },
  { id: 'facebook', label: 'Facebook', category: 'social', authType: 'oauth2', baseUrl: 'https://graph.facebook.com/v18.0', docsUrl: 'https://developers.facebook.com/docs/graph-api', keyFormat: 'Page or user access token with pages_manage_posts; page id goes in config', built: false },
  { id: 'instagram', label: 'Instagram', category: 'social', authType: 'oauth2', baseUrl: 'https://graph.facebook.com/v18.0', docsUrl: 'https://developers.facebook.com/docs/instagram-api', keyFormat: 'Instagram Graph user access token with instagram_content_publish; account id goes in config', built: false },
  { id: 'youtube', label: 'YouTube', category: 'social', authType: 'oauth2', baseUrl: 'https://www.googleapis.com/youtube/v3', docsUrl: 'https://developers.google.com/youtube/v3/docs', keyFormat: 'OAuth access token (youtube.readonly, plus youtube.force-ssl for writes)', built: true },
  { id: 'tiktok', label: 'TikTok', category: 'social', authType: 'oauth2', baseUrl: 'https://open.tiktokapis.com/v2', docsUrl: 'https://developers.tiktok.com/doc/overview', keyFormat: 'OAuth access token from the TikTok developer flow', built: false },
]

export const BUILT_COUNT: number = CONNECTOR_CATALOG.filter((c) => c.built).length
