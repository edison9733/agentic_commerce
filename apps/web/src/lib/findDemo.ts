/**
 * The find_merchants demo, as recorded by `npm run demo:find`: real merchants,
 * purchases and reviews on a local validator running the real program. The
 * slides and the site show this recording; nothing here is made up.
 */
import demo from '../../../../deployments/find-demo.json';

export type FindRow = {
  rank: number;
  merchant: string;
  name: string | null;
  tier: string;
  score: number;
  stars: number;
  reviews: number;
  sales: number;
  missedDeliveries: number;
  decision: string;
  expectedSecs: number | null;
  service: { id: string; price: { usdc: string } | null } | null;
  topReviews: { stars: number; text: string }[];
};

type Result = { label: string; command: string; cli: string; reply: { ranked: FindRow[] } };
const results = demo.results as unknown as Result[];
const byLabel = (label: string) => results.find((r) => r.label === label)!;

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const wallets = [...Object.values(demo.merchants), ...Object.values(demo.buyers)] as string[];
const names: Record<string, string> = { [demo.buyers.newcomer]: '<new buyer>', [demo.buyers.scout]: '<scout>' };

/** A recorded CLI session, wallets shortened so it fits a slide. */
export function session(label: string): { command: string; output: string[] } {
  const r = byLabel(label);
  let command = `$ ${r.command}`;
  for (const [w, n] of Object.entries(names)) command = command.replace(w, n);
  const output = r.cli
    .split('\n')
    .filter((l) => !l.startsWith('Pick one'))
    .map((l) => wallets.reduce((s, w) => s.replace(w, short(w)), l))
    .map((l) => l.replace(/^(\d+ found · sorted \w+):.*$/, '$1'));
  return { command, output };
}

export const ranked = (label: string): FindRow[] => byLabel(label).reply.ranked;
export const recordedAt = demo.recordedAt.slice(0, 10);
export const reproduce = demo.reproduce;
