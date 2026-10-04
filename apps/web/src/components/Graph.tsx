import { useEffect, useRef, useState } from 'react';
import { OrderState, type Decoded, type Order, type Pair } from '@tessera/sdk';
import { TIER_DARK, tierName } from '../lib/format';
import type { FeedEvent, Profile } from '../lib/store';

/**
 * The network, drawn from chain state. Every node is an Agent account, every
 * edge a Pair account, every coin an Order account. A coin that sits in the
 * middle of an edge is money in escrow; the ring around it is its hold
 * running down. When the hold ends the coin travels on to the merchant.
 */
type Node = { x: number; y: number; vx: number; vy: number; r: number; p: Profile; pulse: number };
type Flight = { from: string; to: string; t0: number; ms: number; from_t: number; to_t: number; color: string; trail: boolean };

const COIN = { quoted: '#8b8a7c', escrow: '#fab219', paid: '#b9f8da', back: '#ec835a', dispute: '#d03b3b' };

export function Graph({
  profiles,
  pairs,
  orders,
  feed,
  height = 560,
  onPick,
  selected,
  labels = true,
}: {
  profiles: Profile[];
  pairs: Decoded<Pair>[];
  orders: Decoded<Order>[];
  feed: FeedEvent[];
  height?: number | string;
  onPick?: (wallet: string) => void;
  selected?: string | null;
  labels?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const nodes = useRef(new Map<string, Node>());
  const flights = useRef<Flight[]>([]);
  const seen = useRef(new Set<string>());
  const data = useRef({ profiles, pairs, orders, selected, labels });
  data.current = { profiles, pairs, orders, selected, labels };
  const [hover, setHover] = useState<{ x: number; y: number; p: Profile } | null>(null);
  const hoverRef = useRef<string | null>(null);

  // New feed events become flights. The first batch is history, not news.
  useEffect(() => {
    const first = seen.current.size === 0;
    for (const e of feed) {
      if (seen.current.has(e.id)) continue;
      seen.current.add(e.id);
      if (first) continue;
      const t0 = performance.now();
      const f = (from_t: number, to_t: number, color: string, ms: number, trail = false): Flight => ({ from: e.buyer, to: e.merchant, t0, ms, from_t, to_t, color, trail });
      if (e.kind === 'funded') flights.current.push(f(0.08, 0.5, COIN.escrow, 900));
      if (e.kind === 'released') flights.current.push(f(0.5, 1, COIN.paid, 1100));
      if (e.kind === 'instant') flights.current.push(f(0.05, 1, COIN.paid, 800, true));
      if (e.kind === 'refunded') flights.current.push(f(0.5, 0, COIN.back, 1100));
      if (e.kind === 'resolved') flights.current.push(f(0.5, 1, COIN.quoted, 1100));
      if (e.kind === 'released' || e.kind === 'instant') {
        const n = nodes.current.get(e.merchant);
        if (n) n.pulse = 1;
      }
    }
  }, [feed]);

  useEffect(() => {
    const cv = canvas.current!;
    const ctx = cv.getContext('2d')!;
    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      const r = cv.getBoundingClientRect();
      w = r.width;
      h = r.height;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    resize();

    const sync = () => {
      const { profiles: ps } = data.current;
      const live = ps.filter((p) => p.orders > 0 || p.agent.name);
      const merchants = live.filter((p) => p.role === 'merchant' || p.role === 'both');
      const keep = new Set(live.map((p) => p.wallet));
      for (const k of [...nodes.current.keys()]) if (!keep.has(k)) nodes.current.delete(k);
      live.forEach((p, i) => {
        const r = 7 + Math.min(17, Math.sqrt(Number(p.volume) / 1e6) * 3.2);
        const n = nodes.current.get(p.wallet);
        if (n) {
          n.p = p;
          n.r += (r - n.r) * 0.2;
          return;
        }
        const isM = merchants.includes(p);
        const a = (i / Math.max(1, live.length)) * Math.PI * 2 + (isM ? 0.4 : 0);
        const rad = (isM ? 0.16 : 0.36) * Math.min(w, h);
        nodes.current.set(p.wallet, { x: w / 2 + Math.cos(a) * rad, y: h / 2 + Math.sin(a) * rad, vx: 0, vy: 0, r, p, pulse: 0 });
      });
    };

    const step = () => {
      const ns = [...nodes.current.values()];
      const { pairs: prs } = data.current;
      const k = Math.min(w, h);
      for (let i = 0; i < ns.length; i += 1) {
        const a = ns[i]!;
        for (let j = i + 1; j < ns.length; j += 1) {
          const b = ns[j]!;
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          const d2 = Math.max(64, dx * dx + dy * dy);
          const f = (k * k * 0.018) / d2;
          const d = Math.sqrt(d2);
          dx /= d;
          dy /= d;
          a.vx += dx * f;
          a.vy += dy * f;
          b.vx -= dx * f;
          b.vy -= dy * f;
        }
        // gentle pull to the middle, a little stronger sideways so the cloud fills a wide canvas
        a.vx += (w / 2 - a.x) * 0.0012 * (h / Math.max(w, 1) + 0.35);
        a.vy += (h / 2 - a.y) * 0.0026;
      }
      for (const { data: pr } of prs) {
        const a = nodes.current.get(pr.buyer);
        const b = nodes.current.get(pr.merchant);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const rest = k * 0.3;
        const f = ((d - rest) / d) * 0.0035 * (1 + Math.min(3, pr.orders / 6));
        a.vx += dx * f;
        a.vy += dy * f;
        b.vx -= dx * f;
        b.vy -= dy * f;
      }
      for (const n of ns) {
        n.vx *= 0.86;
        n.vy *= 0.86;
        n.x = Math.max(n.r + 46, Math.min(w - n.r - 46, n.x + n.vx));
        n.y = Math.max(n.r + 26, Math.min(h - n.r - 34, n.y + n.vy));
        n.pulse *= 0.94;
      }
    };

    const along = (a: Node, b: Node, t: number) => {
      // a slight bow, so two-way pairs do not draw on top of each other
      const mx = (a.x + b.x) / 2 - (b.y - a.y) * 0.08;
      const my = (a.y + b.y) / 2 + (b.x - a.x) * 0.08;
      const u = 1 - t;
      return [u * u * a.x + 2 * u * t * mx + t * t * b.x, u * u * a.y + 2 * u * t * my + t * t * b.y] as const;
    };

    const coin = (x: number, y: number, color: string, size = 3.4) => {
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
    };

    const draw = (now: number) => {
      sync();
      if (!still) step();
      const { pairs: prs, orders: os, selected: sel, labels: showLabels } = data.current;
      ctx.clearRect(0, 0, w, h);
      const chain = Date.now() / 1000;
      const focus = hoverRef.current ?? sel ?? null;

      // edges
      for (const { data: pr } of prs) {
        const a = nodes.current.get(pr.buyer);
        const b = nodes.current.get(pr.merchant);
        if (!a || !b) continue;
        const hot = focus && (pr.buyer === focus || pr.merchant === focus);
        const alpha = focus ? (hot ? 0.75 : 0.07) : 0.14 + Math.min(0.4, pr.orders * 0.03);
        const [mx, my] = along(a, b, 0.5);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(2 * mx - (a.x + b.x) / 2, 2 * my - (a.y + b.y) / 2, b.x, b.y);
        ctx.strokeStyle = pr.disputes > 0 ? `rgba(208,59,59,${alpha})` : `rgba(201,198,182,${alpha})`;
        ctx.lineWidth = hot ? 1.4 : 1;
        ctx.stroke();
      }

      // money sitting in escrow
      for (const { data: o } of os) {
        if (o.state !== OrderState.Funded && o.state !== OrderState.Delivered && o.state !== OrderState.Disputed && o.state !== OrderState.AwaitingPayment) continue;
        const a = nodes.current.get(o.buyer);
        const b = nodes.current.get(o.merchant);
        if (!a || !b) continue;
        if (o.state === OrderState.AwaitingPayment) {
          if (chain - Number(o.createdAt) > 300) continue;
          const [x, y] = along(a, b, 0.1);
          coin(x, y, COIN.quoted, 2.4);
          continue;
        }
        const [x, y] = along(a, b, 0.5);
        const disputed = o.state === OrderState.Disputed;
        coin(x, y, disputed ? COIN.dispute : COIN.escrow, 3.6 + (disputed ? Math.sin(now / 160) * 1 : 0));
        if (o.state === OrderState.Delivered && o.releaseAt > o.deliveredAt) {
          const total = Number(o.releaseAt - o.deliveredAt);
          const left = Math.max(0, Math.min(1, (Number(o.releaseAt) - chain) / total));
          ctx.beginPath();
          ctx.arc(x, y, 8.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
          ctx.strokeStyle = 'rgba(250,178,25,0.75)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // money moving
      flights.current = flights.current.filter((f) => now - f.t0 < f.ms);
      for (const f of flights.current) {
        const a = nodes.current.get(f.from);
        const b = nodes.current.get(f.to);
        if (!a || !b) continue;
        const p = Math.min(1, (now - f.t0) / f.ms);
        const e = 1 - Math.pow(1 - p, 3);
        const t = f.from_t + (f.to_t - f.from_t) * e;
        if (f.trail) {
          for (let i = 1; i <= 7; i += 1) {
            const [tx, ty] = along(a, b, Math.max(0, t - i * 0.035));
            ctx.beginPath();
            ctx.arc(tx, ty, 2.6 - i * 0.28, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(185,248,218,${0.5 - i * 0.06})`;
            ctx.fill();
          }
        }
        const [x, y] = along(a, b, t);
        coin(x, y, f.color, 4);
      }

      // nodes
      for (const n of nodes.current.values()) {
        const tier = n.p.eval.tier;
        const color = TIER_DARK[tier];
        const dim = focus && focus !== n.p.wallet && !prs.some(({ data: pr }) => (pr.buyer === focus && pr.merchant === n.p.wallet) || (pr.merchant === focus && pr.buyer === n.p.wallet));
        ctx.globalAlpha = dim ? 0.25 : 1;
        if (n.pulse > 0.03) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + 18 * (1 - n.pulse) + 4, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(185,248,218,${n.pulse * 0.7})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        const isMerchant = n.p.role === 'merchant' || n.p.role === 'both';
        ctx.beginPath();
        if (isMerchant) {
          // merchants are squares, buyers circles: role never depends on colour
          const s = n.r * 1.7;
          ctx.roundRect(n.x - s / 2, n.y - s / 2, s, s, 4);
        } else ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = tier >= 2 ? 22 : 8;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#0a0b09';
        ctx.stroke();
        if (n.p.agent.penaltyBps > 0) {
          ctx.beginPath();
          ctx.arc(n.x + n.r * 0.9, n.y - n.r * 0.9, 3.2, 0, Math.PI * 2);
          ctx.fillStyle = '#d03b3b';
          ctx.fill();
        }
        if (showLabels) {
          ctx.font = '500 11.5px "Geist Mono", ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#e9e6d8';
          ctx.fillText(n.p.name, n.x, n.y + n.r + 16);
          ctx.fillStyle = '#8b8a7c';
          ctx.font = '10.5px "Geist Mono", ui-monospace, monospace';
          ctx.fillText(String(n.p.eval.score), n.x, n.y + n.r + 29);
        }
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const pick = (ev: MouseEvent): Node | null => {
      const r = cv.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      let best: Node | null = null;
      let bd = Infinity;
      for (const n of nodes.current.values()) {
        const d = Math.hypot(n.x - x, n.y - y);
        if (d < n.r + 12 && d < bd) {
          best = n;
          bd = d;
        }
      }
      return best;
    };
    const move = (ev: MouseEvent) => {
      const n = pick(ev);
      const id = n?.p.wallet ?? null;
      cv.style.cursor = n && onPick ? 'pointer' : 'default';
      if (id !== hoverRef.current) {
        hoverRef.current = id;
        setHover(n ? { x: n.x, y: n.y - n.r - 12, p: n.p } : null);
      }
    };
    const leave = () => {
      hoverRef.current = null;
      setHover(null);
    };
    const click = (ev: MouseEvent) => {
      const n = pick(ev);
      if (n && onPick) onPick(n.p.wallet);
    };
    cv.addEventListener('mousemove', move);
    cv.addEventListener('mouseleave', leave);
    cv.addEventListener('click', click);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener('mousemove', move);
      cv.removeEventListener('mouseleave', leave);
      cv.removeEventListener('click', click);
    };
  }, [onPick]);

  return (
    <div style={{ position: 'relative', height, width: '100%' }}>
      <canvas ref={canvas} style={{ width: '100%', height: '100%', display: 'block' }} aria-label="Live network of agents and escrowed payments on Solana devnet" role="img" />
      {hover && (
        <div
          className="mono"
          style={{
            position: 'absolute',
            left: hover.x,
            top: hover.y,
            transform: 'translate(-50%, -100%)',
            background: '#181b15',
            border: '1px solid #272b21',
            borderRadius: 10,
            padding: '8px 10px',
            fontSize: 11.5,
            lineHeight: 1.55,
            color: '#e9e6d8',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 5,
          }}
        >
          <div style={{ fontWeight: 500 }}>{hover.p.name}</div>
          <div style={{ color: '#8b8a7c' }}>
            score {hover.p.eval.score} · {tierName(hover.p.eval.tier)} · {hover.p.orders} orders
          </div>
        </div>
      )}
    </div>
  );
}

export function GraphLegend() {
  const item = (swatch: React.ReactNode, label: string) => (
    <span className="inline-flex items-center gap-2">
      {swatch}
      {label}
    </span>
  );
  const dot = (c: string, square = false) => <span style={{ width: 9, height: 9, borderRadius: square ? 2 : 9, background: c, display: 'inline-block' }} />;
  return (
    <div className="mono flex flex-wrap gap-x-5 gap-y-2 text-[0.7rem]" style={{ color: '#8b8a7c' }}>
      {item(dot('#c9c6b6', true), 'merchant')}
      {item(dot('#c9c6b6'), 'buyer')}
      {TIER_DARK.map((c, i) => (
        <span key={c} className="inline-flex items-center gap-2">
          {dot(c)}
          {tierName(i)}
        </span>
      ))}
      {item(dot(COIN.escrow), 'held in escrow')}
      {item(dot(COIN.paid), 'paid out')}
      {item(dot(COIN.dispute), 'disputed / penalised')}
    </div>
  );
}
