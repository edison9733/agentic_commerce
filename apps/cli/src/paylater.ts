/**
 * Pay-later commands. Unlike the escrow commands these do not go through the
 * API: they read the chain themselves and build the one pay-later instruction
 * locally, so there is no reply to check before signing.
 *
 *   tessera credit <wallet>
 *   tessera buy-later <merchant> <amount> --keypair PATH [--send]
 *   tessera repay <loan> --keypair PATH [--send]
 *   tessera mark-default <loan> --keypair PATH [--send]
 */
import {
  address,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createTransactionMessage,
  fetchEncodedAccount,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from '@solana/kit';
import {
  agentPdaOf,
  configPda,
  fetchMaybeAgent,
  fetchMaybeConfig,
  findAta,
  fromUnits,
  hashJson,
  newOrderId,
  paylater,
  score,
  toUnits,
} from '@tessera/sdk';

export const PAYLATER_COMMANDS = new Set(['credit', 'buy-later', 'repay', 'mark-default']);

export const PAYLATER_HELP = `Pay later (reads the chain itself; no API)
  credit <wallet>                                a wallet's pay-later limit and record
  buy-later <merchant> <amount> --keypair PATH [--send] [--request JSON]
                                                 the pool pays the merchant now; you repay by the due date
  repay <loan> --keypair PATH [--send]           pay a loan back in full (anyone may repay for the buyer)
  mark-default <loan> --keypair PATH [--send]    anyone, once a loan is past its due date and grace period`;

const TIERS = ['New', 'Building', 'Established', 'Trusted'] as const;
const CLOCK = address('SysvarC1ock11111111111111111111111111111111');
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const usdc = (u: bigint) => `${fromUnits(u)} USDC`;
const STATE = ['open', 'repaid on time', 'repaid late', 'in default'] as const;

type Opts = { rpcUrl: string; kp?: KeyPairSigner; send: boolean; json: boolean; request?: unknown; die: (m: string) => never };

export async function payLater(cmd: string, a1: string | undefined, a2: string | undefined, o: Opts): Promise<void> {
  const rpc = createSolanaRpc(o.rpcUrl);
  const addr = (v: string | undefined, what: string): Address => {
    if (!v) o.die(`${what} is required (see: tessera help)`);
    try {
      return address(v);
    } catch {
      return o.die(`${what} is not a Solana address: ${v}`);
    }
  };

  const chainNow = async () => {
    const c = await fetchEncodedAccount(rpc, CLOCK);
    if (!c.exists) o.die('the RPC has no clock');
    return new DataView(c.data.buffer, c.data.byteOffset).getBigInt64(32, true);
  };
  const pool = await paylater.fetchMaybePool(rpc, await paylater.poolPda());
  if (!pool.exists) o.die(`no pay-later pool on ${o.rpcUrl}`);
  const cfg = await fetchMaybeConfig(rpc, await configPda());
  if (!cfg.exists) o.die(`no Tessera config on ${o.rpcUrl}`);
  const p = pool.data.params;
  const scoreParams = cfg.data.params;

  /** Live tier, score and pay-later numbers for a wallet, as the program computes them. */
  async function standing(wallet: Address, now: bigint) {
    const agent = await fetchMaybeAgent(rpc, await agentPdaOf(wallet));
    const e = agent.exists ? score.evaluate(agent.data, scoreParams, now) : undefined;
    const line = await paylater.fetchMaybeCreditLine(rpc, await paylater.linePdaOf(wallet));
    const l = line.exists ? line.data : paylater.NO_LINE;
    const tier = e?.tier ?? 0;
    const sc = e?.score ?? 0;
    return {
      known: agent.exists,
      tier,
      score: sc,
      line: line.exists ? line.data : undefined,
      limit: paylater.limit(l, p, tier, sc),
      available: paylater.available(l, p, tier, sc),
    };
  }

  async function sendOrPrint(kp: KeyPairSigner, ix: Instruction): Promise<void> {
    const { value: latest } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
    const signed = await signTransactionMessageWithSigners(
      pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(kp, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
        (m) => appendTransactionMessageInstructions([ix], m),
      ),
    );
    const wire = getBase64EncodedWireTransaction(signed);
    if (!o.send) return void console.log(`signed transaction (send with --send or any RPC):\n${wire}`);
    const sig = getSignatureFromTransaction(signed);
    try {
      await rpc.sendTransaction(wire, { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
    } catch (e) {
      const logs = (e as { context?: { logs?: string[] } }).context?.logs ?? [];
      const why = logs.map((l) => /Error Message: (.*?)\.?$/.exec(l)?.[1]).find(Boolean);
      o.die(`refused by the program: ${why ?? (e as Error).message}`);
    }
    for (let i = 0; i < 120; i += 1) {
      const { value } = await rpc.getSignatureStatuses([sig]).send();
      if (value[0]?.err) o.die(`transaction ${sig} failed`);
      if (value[0]?.confirmationStatus === 'confirmed' || value[0]?.confirmationStatus === 'finalized') {
        return void console.log(`confirmed: ${sig}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    o.die(`transaction ${sig} was not confirmed within 60 s`);
  }

  if (cmd === 'credit') {
    const wallet = addr(a1, '<wallet>');
    const s = await standing(wallet, await chainNow());
    if (o.json) return void console.log(JSON.stringify(s, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
    console.log(`credit   ${short(wallet)}  ${TIERS[s.tier]} ${s.score}${s.known ? '' : '  (no credit file)'}`);
    console.log(`limit ${usdc(s.limit)} · owes ${usdc(s.line?.outstanding ?? 0n)} · available ${usdc(s.available)}`);
    const l = s.line;
    console.log(l ? `record: ${l.loans} loan${l.loans === 1 ? '' : 's'}, ${l.repaidOnTime} on time, ${l.repaidLate} late, ${l.defaults} default${l.defaults === 1 ? '' : 's'}` : 'record: never borrowed');
    if (l?.defaults) console.log('frozen: a loan went unpaid past its grace period');
    else if (s.tier === 0) console.log('no credit yet: settle orders through Tessera escrow to earn a tier');
    console.log(`terms: repay within ${p.termSecs} s, merchant paid at once, pool keeps ${p.feeBps / 100}%, no interest`);
    return;
  }

  const kp = o.kp ?? o.die(`${cmd} needs --keypair`);

  if (cmd === 'buy-later') {
    const merchant = addr(a1, '<merchant>');
    if (!a2) o.die('<amount> is required (see: tessera help)');
    const amount = toUnits(a2);
    const now = await chainNow();
    const [b, m] = await Promise.all([standing(kp.address, now), standing(merchant, now)]);
    console.log(`buyer    ${short(kp.address)}  ${TIERS[b.tier]} ${b.score}  available ${usdc(b.available)}`);
    console.log(`merchant ${short(merchant)}  ${TIERS[m.tier]} ${m.score}`);
    if (amount > b.available) o.die(`${usdc(amount)} is above your available credit (${usdc(b.available)})`);
    if (m.tier < p.minMerchantTier) o.die(`the pool only pays merchants at ${TIERS[p.minMerchantTier]} or above`);
    const fee = paylater.feeOf(amount, p);
    const loanId = newOrderId();
    const ix = await paylater.getBuyNowInstructionAsync({
      mint: pool.data.mint,
      buyer: kp,
      merchant,
      loanId,
      amount,
      requestHash: await hashJson(o.request ?? { merchant, amount: amount.toString() }),
    });
    console.log(`BUY NOW  ${usdc(amount)}: merchant gets ${usdc(amount - fee)} now, pool keeps ${usdc(fee)}`);
    console.log(`you repay ${usdc(amount)} within ${p.termSecs} s, no interest`);
    console.log(`loan ${await paylater.loanPdaOf(kp.address, loanId)}`);
    return sendOrPrint(kp, ix);
  }

  const loanAddr = addr(a1, '<loan>');
  const loan = await paylater.fetchMaybeLoan(rpc, loanAddr);
  if (!loan.exists) o.die(`no loan at ${loanAddr}`);
  const d = loan.data;
  if (d.state !== paylater.LoanState.Open && d.state !== paylater.LoanState.Defaulted) o.die(`this loan is already ${STATE[d.state]}`);
  const now = await chainNow();
  const left = d.dueAt - now;
  if (cmd === 'mark-default') {
    if (d.state !== paylater.LoanState.Open) o.die(`this loan is already ${STATE[d.state]}`);
    const wait = d.dueAt + BigInt(p.graceSecs) - now;
    console.log(`loan ${short(loanAddr)}  buyer ${short(d.buyer)}  owes ${usdc(d.amount)}  ${wait < 0n ? `${-left} s past due, grace over` : `grace ends in ${wait + 1n} s`}`);
    return sendOrPrint(kp, await paylater.getMarkDefaultInstructionAsync({ loan: loanAddr, line: await paylater.linePdaOf(d.buyer) }));
  }
  console.log(`loan ${short(loanAddr)}  ${STATE[d.state]}  owes ${usdc(d.amount)}  ${left >= 0n ? `due in ${left} s: on time` : `${-left} s late`}`);
  const ix = await paylater.getRepayInstructionAsync({
    mint: pool.data.mint,
    loan: loanAddr,
    line: await paylater.linePdaOf(d.buyer),
    payer: kp,
    payerToken: await findAta(kp.address, pool.data.mint),
  });
  return sendOrPrint(kp, ix);
}
