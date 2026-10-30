/**
 * Chain client: the Node side of the NEAR integration. It signs with the
 * sandbox accounts `tools/chain-host` created and talks to that sandbox over
 * its JSON-RPC, so every order the screen places is a real transaction with a
 * real hash against the real contract.
 *
 * It is transport and nothing else. No product rule lives here: pricing,
 * capacity and custody are the contract's, and the gateway reads them from it.
 * Nothing in this file needs one of your keys and nothing reaches testnet — the
 * RPC is 127.0.0.1 and the secrets are the dev keys the chain host printed.
 */
import { readFileSync } from "node:fs";
// @ts-ignore -- near-api-js ships no types in this install; the surface used
// here is narrow and declared below.
import * as nearAPI from "near-api-js";

export const TGAS = 30_000_000_000_000n; // 30 Tgas per call

export interface Role {
  account: string;
  secret: string;
}

export interface Session {
  rpc: string;
  admin: Role;
  roles: Record<string, Role>;
  contracts: { options: string; token: string; oracle: string };
}

/** NEAR amounts are u128 and the SDK reads them as strings; a BigInt would make
 * JSON.stringify throw, so every argument crosses the boundary as a string. */
function encode(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value]),
  );
}

export interface CallResult {
  hash: string;
  gas: bigint;
  value: unknown;
}

/** NEAR nests a panic several envelopes deep, and near-api-js throws before the
 * status can be read: the sentence the contract chose — "pool full: this worst
 * case does not fit the equity left" — is in there somewhere, and a trader
 * reading `{"index":0,"kind":{...}}` learns nothing. */
export function failureText(value: unknown): string {
  const panic = findExecutionError(value) ?? findExecutionError(jsonOf(value));
  if (panic === null) return (value instanceof Error ? value.message : String(value ?? "")).slice(0, 240);
  return panic.replace(/^Smart contract panicked:\s*/, "");
}

function jsonOf(value: unknown): unknown {
  const text = value instanceof Error ? value.message : String(value ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function findExecutionError(node: unknown): string | null {
  if (node === null || typeof node !== "object") return null;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "ExecutionError" && typeof value === "string") return value;
    const nested = findExecutionError(value);
    if (nested !== null) return nested;
  }
  return null;
}

export class Chain {
  readonly session: Session;
  private readonly near: any;
  readonly options: string;
  readonly token: string;
  readonly oracle: string;
  transactions = 0;
  gasBurnt = 0n;
  private readonly cache = new Map<string, any>();

  private constructor(session: Session, near: any) {
    this.session = session;
    this.near = near;
    this.options = session.contracts.options;
    this.token = session.contracts.token;
    this.oracle = session.contracts.oracle;
  }

  static async connect(sessionPath = "data/chain-session.json"): Promise<Chain> {
    const session = JSON.parse(readFileSync(sessionPath, "utf8")) as Session;
    const keyStore = new nearAPI.keyStores.InMemoryKeyStore();
    for (const entry of [session.admin, ...Object.values(session.roles)]) {
      await keyStore.setKey("sandbox", entry.account, nearAPI.utils.key_pair.KeyPair.fromString(entry.secret));
    }
    const near = await nearAPI.connect({
      networkId: "sandbox",
      nodeUrl: session.rpc,
      keyStore,
      masterAccount: session.roles.you.account,
    });
    return new Chain(session, near);
  }

  id(role: string): string {
    const entry = role === "admin" ? this.session.admin : this.session.roles[role];
    if (!entry) throw new Error(`no sandbox account for ${role}`);
    return entry.account;
  }

  private async account(role: string): Promise<any> {
    const accountId = this.id(role);
    if (!this.cache.has(role)) this.cache.set(role, this.near.account(accountId));
    return this.cache.get(role);
  }

  async view(method: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const account = await this.account("you");
    return account.viewFunction({ contractId: this.options, methodName: method, args });
  }

  /** One transaction, one hash. Returns the contract's own return value.
   * `contract` overrides the destination for calls that belong to the token. */
  async call(
    role: string,
    method: string,
    args: Record<string, unknown>,
    { gas = TGAS, deposit = "0", contract = this.options }: { gas?: bigint; deposit?: string; contract?: string } = {},
  ): Promise<CallResult> {
    const account = await this.account(role);
    let outcome: any;
    try {
      outcome = await account.functionCall({
        contractId: contract,
        methodName: method,
        args: encode(args),
        gas,
        attachedDeposit: BigInt(deposit),
      });
    } catch (error) {
      // The SDK throws on a failed transaction before the status below can be
      // read, so the contract's sentence has to be unwrapped here as well.
      throw new Error(`${method} reverted: ${failureText(error)}`);
    }
    this.transactions += 1;
    const burnt = outcome.receipts_outcome.reduce((total: bigint, r: any) => total + BigInt(r.outcome.gas_burnt), 0n);
    this.gasBurnt += burnt;
    if (outcome.status?.Failure) {
      throw new Error(`${method} reverted: ${failureText(outcome.status.Failure)}`);
    }
    return {
      hash: outcome.transaction.hash,
      gas: burnt,
      value: outcome.status?.SuccessValue
        ? JSON.parse(Buffer.from(outcome.status.SuccessValue, "base64").toString())
        : null,
    };
  }

  /** Move tokens into the market and let its receiver hook act on them. `msg`
   * chooses the destination inside the contract: "deposit" credits a tradable
   * balance, "pool-deposit" mints vault shares against the pool's net assets. */
  depositTo(role: string, amountUnits: string | number | bigint, msg = "deposit"): Promise<CallResult> {
    return this.call(
      role,
      "ft_transfer_call",
      { receiver_id: this.options, amount: BigInt(amountUnits).toString(), msg },
      { contract: this.token, gas: TGAS * 2n, deposit: "1" },
    );
  }

  /** The settlement print. The oracle's reporter is the admin account. */
  async report(price: number, { feed = "ETH-USD", confidenceBps = 9000 }: { feed?: string; confidenceBps?: number } = {}) {
    const account = await this.account("admin");
    const outcome = await account.functionCall({
      contractId: this.oracle,
      methodName: "report",
      args: {
        feed_id: feed,
        // The oracle stores a raw u128, which the SDK reads as a JSON number;
        // the market's own amounts are U128 wrappers and read as strings.
        price: Number(price),
        publish_time_ns: Number(BigInt(Date.now()) * 1_000_000n),
        confidence_bps: confidenceBps,
      },
      gas: TGAS,
      attachedDeposit: 0n,
    });
    return { hash: outcome.transaction.hash };
  }

  /** The contract returns U128, which serialises as a bare JSON string. */
  async balance(role: string): Promise<number> {
    return Number(await this.view("get_balance", { account_id: this.id(role) }));
  }

  /** What any account holds in the collateral token itself. */
  async ftBalance(accountId: string): Promise<number> {
    const account = await this.account("you");
    const value = (await account.viewFunction({
      contractId: this.token,
      methodName: "ft_balance_of",
      args: { account_id: accountId },
    })) as { amount?: string } | string;
    // NEP-141 says Balance is an object; this token returns the U128 bare.
    return Number(typeof value === "object" ? value.amount : value);
  }

  /** What a role holds outside the market, used to watch an asynchronous
   * withdrawal land before spending it again. */
  tokenBalance(role: string): Promise<number> {
    return this.ftBalance(this.id(role));
  }

  /** What the contract believes it holds versus what the token says it holds. */
  async custody(): Promise<{ expected: number; held: number; conserved: boolean }> {
    const expected = Number(await this.view("expected_custody"));
    const held = await this.ftBalance(this.options);
    return { expected, held, conserved: expected === held };
  }
}
