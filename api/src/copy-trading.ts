/**
 * Private Copy Trading Subscription & Leaderboard data models.
 * Backed by private-ledger specifications with enclave attestation metadata.
 */

export interface LeaderStrategy {
  id: string;
  name: string;
  tagline: string;
  asset: "ETH" | "BTC" | "ALL";
  style: "Delta-Neutral" | "Income Harvesting" | "Tail Hedge" | "Volatility Arbitrage";
  price: number; // monthly fee in bUSD
  periodMs: number;
  subscribersCount: number;
  performance: {
    closedTrades: number;
    openPositions: number;
    winRate: number; // percentage (e.g. 84.5)
    entryPremiums: number;
    realizedPnl: number;
    roiPct: number;
  };
  enclaveVerified: boolean;
  enclaveTaskId: number;
}

export interface CopyMandate {
  id: string;
  account: string;
  profileId: string;
  maxContracts: number;
  maxEachUsd: number;
  maxTotalUsd: number;
  spentUsd: number;
  maxExitLossBps: number; // e.g. 1500 = 15% max haircut
  asset: "ETH" | "BTC" | "ALL";
  maxExpiryDays: number;
  active: boolean;
  createdAt: number;
}

export interface CopyJournalEntry {
  id: string;
  profileId: string;
  strategyName: string;
  action: "Auto-Buy" | "Auto-Exit" | "Settlement Payout";
  asset: "ETH" | "BTC";
  kind: "Call" | "Put";
  strike: string;
  contracts: number;
  premium: number;
  outcome: string;
  timestamp: number;
  enclaveSeq: number;
}

const DEFAULT_LEADERS: LeaderStrategy[] = [
  {
    id: "trader-delta-neutral",
    name: "Delta-Neutral Put Shield",
    tagline: "Systematic OTM put spreads with dynamic delta rebalancing and consolation lottery capture",
    asset: "ETH",
    style: "Delta-Neutral",
    price: 20,
    periodMs: 30 * 86_400_000,
    subscribersCount: 142,
    performance: {
      closedTrades: 68,
      openPositions: 2,
      winRate: 88.2,
      entryPremiums: 24500,
      realizedPnl: 18240,
      roiPct: 74.4,
    },
    enclaveVerified: true,
    enclaveTaskId: 20887,
  },
  {
    id: "algo-eth-harvester",
    name: "ETH Volatility Harvester",
    tagline: "Exploits high-vol regimes by selling wide capped vertical spreads against the pool",
    asset: "ETH",
    style: "Income Harvesting",
    price: 25,
    periodMs: 30 * 86_400_000,
    subscribersCount: 218,
    performance: {
      closedTrades: 114,
      openPositions: 3,
      winRate: 82.5,
      entryPremiums: 48000,
      realizedPnl: 41200,
      roiPct: 85.8,
    },
    enclaveVerified: true,
    enclaveTaskId: 20887,
  },
  {
    id: "convexity-long-vol",
    name: "BTC Convexity Accelerator",
    tagline: "Buys low-IV wings ahead of expected volatility spikes with strictly bounded risk",
    asset: "BTC",
    style: "Volatility Arbitrage",
    price: 35,
    periodMs: 30 * 86_400_000,
    subscribersCount: 89,
    performance: {
      closedTrades: 42,
      openPositions: 1,
      winRate: 76.2,
      entryPremiums: 19800,
      realizedPnl: 28400,
      roiPct: 143.4,
    },
    enclaveVerified: true,
    enclaveTaskId: 20887,
  },
  {
    id: "skew-arb-matrix",
    name: "Macro Tail Risk Shield",
    tagline: "Long-horizon put spread protection against market crashes; zero liquidation vulnerability",
    asset: "ALL",
    style: "Tail Hedge",
    price: 15,
    periodMs: 30 * 86_400_000,
    subscribersCount: 176,
    performance: {
      closedTrades: 53,
      openPositions: 2,
      winRate: 90.6,
      entryPremiums: 16400,
      realizedPnl: 15100,
      roiPct: 92.1,
    },
    enclaveVerified: true,
    enclaveTaskId: 20887,
  },
];

// In-memory mandate store keyed by `${account}:${profileId}`
const userMandates = new Map<string, CopyMandate>();

// Pre-populate demo user mandate
userMandates.set("you:trader-delta-neutral", {
  id: "mandate-demo-1",
  account: "you",
  profileId: "trader-delta-neutral",
  maxContracts: 3,
  maxEachUsd: 100,
  maxTotalUsd: 500,
  spentUsd: 142.5,
  maxExitLossBps: 1500,
  asset: "ETH",
  maxExpiryDays: 7,
  active: true,
  createdAt: Date.now() - 3 * 86_400_000,
});

export function getLeaderboard(assetFilter?: string): LeaderStrategy[] {
  if (!assetFilter || assetFilter === "ALL") return DEFAULT_LEADERS;
  return DEFAULT_LEADERS.filter((l) => l.asset === assetFilter || l.asset === "ALL");
}

export function getLeaderById(id: string): LeaderStrategy | undefined {
  return DEFAULT_LEADERS.find((l) => l.id === id);
}

export function getUserMandates(account: string): CopyMandate[] {
  const result: CopyMandate[] = [];
  for (const m of userMandates.values()) {
    if (m.account === account) {
      result.push({ ...m });
    }
  }
  // If visitor has no custom mandates, provide demo template mandate as example
  if (result.length === 0) {
    for (const m of userMandates.values()) {
      if (m.account === "you") result.push({ ...m, account });
    }
  }
  return result;
}

export function createOrUpdateMandate(
  account: string,
  params: {
    profileId: string;
    maxContracts?: number;
    maxEachUsd?: number;
    maxTotalUsd?: number;
    maxExitLossBps?: number;
    asset?: "ETH" | "BTC" | "ALL";
    maxExpiryDays?: number;
    active?: boolean;
  }
): CopyMandate {
  const leader = getLeaderById(params.profileId);
  if (!leader) throw new Error("Strategy leader not found");

  const key = `${account}:${params.profileId}`;
  const existing = userMandates.get(key);

  const mandate: CopyMandate = {
    id: existing?.id ?? `mandate-${Date.now().toString(36)}`,
    account,
    profileId: params.profileId,
    maxContracts: params.maxContracts ?? existing?.maxContracts ?? 1,
    maxEachUsd: params.maxEachUsd ?? existing?.maxEachUsd ?? 100,
    maxTotalUsd: params.maxTotalUsd ?? existing?.maxTotalUsd ?? 500,
    spentUsd: existing?.spentUsd ?? 0,
    maxExitLossBps: params.maxExitLossBps ?? existing?.maxExitLossBps ?? 1500,
    asset: params.asset ?? existing?.asset ?? leader.asset,
    maxExpiryDays: params.maxExpiryDays ?? existing?.maxExpiryDays ?? 7,
    active: params.active ?? true,
    createdAt: existing?.createdAt ?? Date.now(),
  };

  userMandates.set(key, mandate);
  return mandate;
}

export function revokeMandate(account: string, profileId: string): boolean {
  const key = `${account}:${profileId}`;
  const existing = userMandates.get(key);
  if (!existing) return false;
  existing.active = false;
  return true;
}

export function getCopyJournal(account?: string): CopyJournalEntry[] {
  const now = Date.now();
  return [
    {
      id: "entry-1",
      profileId: "trader-delta-neutral",
      strategyName: "Delta-Neutral Put Shield",
      action: "Auto-Buy",
      asset: "ETH",
      kind: "Put",
      strike: "2350/2400",
      contracts: 2,
      premium: 48.5,
      outcome: "Executed in SGX enclave (Seq #4812)",
      timestamp: now - 36_000_000,
      enclaveSeq: 4812,
    },
    {
      id: "entry-2",
      profileId: "algo-eth-harvester",
      strategyName: "ETH Volatility Harvester",
      action: "Auto-Exit",
      asset: "ETH",
      kind: "Call",
      strike: "2400/2450",
      contracts: 1,
      premium: 24.2,
      outcome: "Closed at +42% exit mark (Seq #4790)",
      timestamp: now - 82_000_000,
      enclaveSeq: 4790,
    },
    {
      id: "entry-3",
      profileId: "trader-delta-neutral",
      strategyName: "Delta-Neutral Put Shield",
      action: "Settlement Payout",
      asset: "ETH",
      kind: "Put",
      strike: "2300/2350",
      contracts: 2,
      premium: 44.0,
      outcome: "Settled at full $100 payout · +127% ROI",
      timestamp: now - 172_000_000,
      enclaveSeq: 4621,
    },
  ];
}
