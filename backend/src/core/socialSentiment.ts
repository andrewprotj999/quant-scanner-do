/**
 * Social Sentiment Scoring — Standalone Version
 *
 * Analyzes DexScreener pair data to generate a social sentiment score.
 * Uses data within the pair object (social links, token age, boost status)
 * to quantify social presence and community engagement.
 * No external API calls needed.
 */

// ─── TYPES ────────────────────────────────────────────────

export interface SocialSignals {
  hasTwitter: boolean;
  hasTelegram: boolean;
  hasWebsite: boolean;
  hasLogo: boolean;
  pairAgeHours: number;
  isBoosted: boolean;
  socialCount: number;
  trendingOnDex: boolean;
}

// ─── CORE FUNCTIONS ───────────────────────────────────────

export function extractSocialSignals(pair: any): SocialSignals {
  const socials = pair?.info?.socials || [];
  const hasTwitter = socials.some((s: any) => s.type === "twitter");
  const hasTelegram = socials.some((s: any) => s.type === "telegram");
  const hasWebsite = socials.some((s: any) => s.type === "website");
  const hasLogo = !!pair?.info?.imageUrl;
  const pairCreatedAt = pair?.pairCreatedAt ? new Date(pair.pairCreatedAt).getTime() : Date.now();
  const pairAgeHours = (Date.now() - pairCreatedAt) / (1000 * 60 * 60);
  const isBoosted = pair?.boosted || false;
  const socialCount = socials.length;
  const trendingOnDex = false;

  return { hasTwitter, hasTelegram, hasWebsite, hasLogo, pairAgeHours, isBoosted, socialCount, trendingOnDex };
}

export function calculateSocialScore(signals: SocialSignals): { score: number; factors: string[] } {
  let score = 0;
  const factors: string[] = [];

  if (signals.hasTwitter) { score += 10; factors.push("+10 Twitter"); }
  if (signals.hasTelegram) { score += 10; factors.push("+10 Telegram"); }
  if (signals.hasWebsite) { score += 10; factors.push("+10 Website"); }
  if (signals.hasLogo) { score += 10; factors.push("+10 Logo"); }
  if (signals.pairAgeHours > 1) { score += 10; factors.push("+10 Age>1h"); }
  if (signals.pairAgeHours > 6) { score += 10; factors.push("+10 Age>6h"); }
  if (signals.pairAgeHours > 24) { score += 10; factors.push("+10 Age>24h"); }
  if (signals.isBoosted) { score += 15; factors.push("+15 Boosted"); }
  if (signals.socialCount > 2) { score += 15; factors.push("+15 Multi-social"); }

  return { score, factors };
}

export function getSocialRiskFlags(signals: SocialSignals): string[] {
  const flags: string[] = [];
  if (signals.socialCount === 0) flags.push("NO_SOCIALS");
  if (signals.pairAgeHours < 1) flags.push("BRAND_NEW_TOKEN");
  if (!signals.hasWebsite) flags.push("NO_WEBSITE");
  return flags;
}
