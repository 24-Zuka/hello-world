// §11.1 Deny list — operations that must NEVER be auto-executed.
// Shared by the dispatcher (to scrub/abort) and documented verbatim in AGENTS.md.
// Deny list > allow list: we explicitly enumerate the forbidden, irreversible ops.

export const DENY_PATTERNS = [
  // Force deletion of files/folders
  /\brm\s+-rf?\b/i,
  /\brm\s+-fr?\b/i,
  // Rewriting history / destructive git
  /\bgit\s+push\b.*--force/i,
  /\bgit\s+push\s+-f\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  // Overwriting critical config files
  /(^|\s)>\s*\.env(\.|\s|$)/i,
  /(^|\s)>\s*.*\.plist\b/i,
  /(^|\s)>\s*.*config\.toml\b/i,
  // Destructive DB changes
  /\bDROP\s+(TABLE|DATABASE)\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bDELETE\s+FROM\b(?!.*\bWHERE\b)/i,
  // Disk-level destruction
  /\b(dd|mkfs|fdisk)\b/i,
  // External send / production deploy
  /\bvercel\s+(deploy|--prod)\b/i,
  /\b(curl|wget)\b.*\b(slack|mailgun|sendgrid|smtp)\b/i,
];

/** Returns the first matching deny pattern, or null if the text is clean. */
export function matchDeny(text) {
  if (!text) return null;
  for (const re of DENY_PATTERNS) {
    if (re.test(text)) return re.source;
  }
  return null;
}
