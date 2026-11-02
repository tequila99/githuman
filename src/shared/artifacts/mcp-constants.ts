// Stable server identity used by ACP configuration and permission checks.
export const ARTIFACT_MCP_SERVER_NAME = 'githuman_artifacts'
// Environment variable names that carry the bridge address and session key to the MCP process.
export const ARTIFACT_AGENT_URL_ENV = 'GITHUMAN_AGENT_URL'
export const ARTIFACT_AGENT_KEY_ENV = 'GITHUMAN_AGENT_KEY'
// Random bytes in one session key. The key is sent as lowercase hex.
export const ARTIFACT_AGENT_KEY_BYTES = 32
// Shape of a valid session key.
export const ARTIFACT_AGENT_KEY_PATTERN = new RegExp(
  `^[a-f0-9]{${ARTIFACT_AGENT_KEY_BYTES * 2}}$`
)
// Shape of a valid Authorization header for the bridge.
export const ARTIFACT_AGENT_BEARER_PATTERN = new RegExp(
  `^Bearer [a-f0-9]{${ARTIFACT_AGENT_KEY_BYTES * 2}}$`
)
// Bridge path without the operation name.
export const ARTIFACT_BRIDGE_PATH_PREFIX = '/api/agent/artifacts/'
// Only this matched route can authenticate an agent session key.
export const ARTIFACT_BRIDGE_ROUTE = `${ARTIFACT_BRIDGE_PATH_PREFIX}:operation`
// Allow worst-case JSON escaping of a body while domain byte limits stay smaller.
export const ARTIFACT_BRIDGE_BODY_LIMIT = 12 * 1024 * 1024
// Extra room in one MCP stdio message for the JSON-RPC envelope and escaped metadata.
const MCP_ENVELOPE_ALLOWANCE_BYTES = 1024 * 1024
// Largest MCP stdio message the CLI accepts. A body of 1.9 MiB of control
// characters escapes to about 11.95 MB and metadata adds up to 384 KiB.
// The limit stays above the HTTP body limit, so an oversize message reaches
// the server and gets a readable 413 instead of a closed stdio connection.
export const ARTIFACT_MCP_MAX_MESSAGE_BYTES =
  ARTIFACT_BRIDGE_BODY_LIMIT + MCP_ENVELOPE_ALLOWANCE_BYTES
