// ROYAL RED MCP catalog.
//
// Real, published MCP servers offered as one-click adds in the Settings
// cockpit. The id doubles as the server name slug when the entry is added;
// command and args are the exact spawn line for stdio servers, url would be
// the endpoint for remote ones. Notes carry the operational caveats that
// would otherwise surface as a confusing ok:false on first connect (missing
// env vars, published variants, connection strings to edit). Nothing here
// runs until a user actually adds an entry, and every entry is editable
// after the fact from the same Settings panel.

export interface McpCatalogEntry {
  id: string // slug used as server name on one-click add
  label: string
  description: string
  type: 'stdio' | 'http'
  command?: string // e.g. 'npx'
  args?: string[] // e.g. ['-y', '@modelcontextprotocol/server-filesystem', '.']
  url?: string
  note?: string
}

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: 'filesystem',
    label: 'Filesystem',
    description: 'Read, write, move, and search files inside one allowed directory tree.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    note: 'serves the current working directory; edit args to point elsewhere',
  },
  {
    id: 'git',
    label: 'Git',
    description: 'Git operations in a repository: status, diff, log, commits, branches.',
    type: 'stdio',
    command: 'uvx',
    args: ['mcp-server-git', '--repository', '.'],
    note: 'git operations in a repository; uvx mcp-server-git is the published variant used here, the npx alternative is npx -y @modelcontextprotocol/server-git',
  },
  {
    id: 'github',
    label: 'GitHub',
    description: 'GitHub API tools: repositories, issues, pull requests, file reads and writes.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    note: 'needs a GITHUB_PERSONAL_ACCESS_TOKEN env var; set it in env after adding',
  },
  {
    id: 'postgres',
    label: 'Postgres',
    description: 'Read-only SQL access to a Postgres database: schema listing and SELECT queries.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'],
    note: 'read-only by default; edit the connection string',
  },
  {
    id: 'sqlite',
    label: 'SQLite',
    description: 'SQL access to a local SQLite database file: schema, queries, and writes.',
    type: 'stdio',
    command: 'uvx',
    args: ['mcp-server-sqlite', '--db-path', 'royal-red.db'],
  },
  {
    id: 'fetch',
    label: 'Fetch',
    description: 'Fetches a URL and converts the page content to markdown for the model to read.',
    type: 'stdio',
    command: 'uvx',
    args: ['mcp-server-fetch'],
  },
  {
    id: 'brave-search',
    label: 'Brave Search',
    description: 'Web search through the Brave Search API, returning ranked results.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    note: 'needs BRAVE_API_KEY env var',
  },
  {
    id: 'puppeteer',
    label: 'Puppeteer',
    description: 'Headless Chrome automation: navigate, click, type, fill forms, take screenshots.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
  },
  {
    id: 'slack',
    label: 'Slack',
    description: 'Slack workspace tools: list channels, read history, and post messages.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    note: 'needs SLACK_BOT_TOKEN and SLACK_TEAM_ID env vars',
  },
  {
    id: 'memory',
    label: 'Memory',
    description: 'Persistent knowledge graph memory: entities, relations, and observations kept between sessions.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
  },
  {
    id: 'sequential-thinking',
    label: 'Sequential Thinking',
    description: 'A structured step-by-step reasoning scratchpad with branching and revision support.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
  },
  {
    id: 'time',
    label: 'Time',
    description: 'Current time lookups and timezone conversions.',
    type: 'stdio',
    command: 'uvx',
    args: ['mcp-server-time', '--local-timezone', 'Asia/Karachi'],
  },
  {
    id: 'everything',
    label: 'Everything',
    description: 'Echo, add, and every other capability in one reference server.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
    note: 'reference server for testing the MCP plumbing',
  },
]
