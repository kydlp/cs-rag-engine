// Mail integration config (inbox, sender label, etc.) read from env.
// Swap test → production by changing env vars only.

export interface MailConfig {
  /** CS inbox address (test → production). */
  inboxAddress: string;
  /** Gmail label that filters unanswered inquiries. */
  csLabel: string;
  /** Display name in the From: header. */
  fromName: string;
  /** Production mode? (false = test / shadow.) */
  isProduction: boolean;
}

export function loadMailConfig(): MailConfig {
  return {
    inboxAddress: process.env.CS_INBOX_ADDRESS ?? "test-inbox@example.com",
    csLabel: process.env.CS_LABEL ?? "CS",
    fromName: process.env.CS_FROM_NAME ?? "Customer Support",
    isProduction: process.env.CS_PRODUCTION === "1",
  };
}
