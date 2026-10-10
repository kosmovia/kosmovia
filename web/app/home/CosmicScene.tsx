"use client";

import { useEffect, useRef, useState } from "react";

/*
 * Escena cósmica del hero. Parte del trabajo visual de Victor (planeta, arcos,
 * paquetes de pago, estrellas), con los nodos renombrados a funciones reales.
 * - Respeta prefers-reduced-motion: dibuja un solo cuadro estático.
 * - Se pausa fuera de pantalla y con la pestaña oculta.
 */

type Node = {
  id: string;
  name: string;
  desc: string;
  color: string;
  ring: 0 | 1;
  angle: number;
  speed: number;
  x: number;
  y: number;
  r: number;
  phase: number;
};

const NODE_DEFS = [
  { id: "chat", name: "Chat y canales", desc: "Canales, mensajes directos y archivos", color: "#5EEAD4" },
  { id: "wallet", name: "Wallet USDC", desc: "Dólares digitales en tu cuenta", color: "#2DD4BF" },
  { id: "pagos", name: "Pagos con PIN", desc: "Envía a cualquier @usuario", color: "#38BDF8" },
  { id: "vaquita", name: "Vaquita", desc: "Junten dinero para algo en común", color: "#F59E6B" },
  { id: "retos", name: "Retos", desc: "Juega con tus amigos, sin apuestas", color: "#B79CFF" },
  { id: "aprende", name: "Aprende Stellar", desc: "Lecciones de 2 minutos e insignias", color: "#7DB2FF" },
];

type Packet = { n: Node; t: number; sp: number; lift: number };
type Ripple = { x: number; y: number; r: number; max: number; color: string };
type Star = { x: number; y: number; r: number; a: number; sp: number; ph: number; c: string };

export default function CosmicScene() {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<string | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const pointerRef = useRef({ x: 0, y: 0, active: false });
  const [tip, setTip] = useState<{ x: number; y: number; name: string; desc: string; color: string } | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let W = 0;
    let H = 0;
    let cx = 0;
    let cy = 0;
    let time = 0;
    let last = 0;
    let raf = 0;
    let visible = true;
    let nextBeat = 1.2;

    const nodes: Node[] = NODE_DEFS.map((d, i) => ({
      ...d,
      ring: (i % 2) as 0 | 1,
      angle: (i / NODE_DEFS.length) * Math.PI * 2 - 0.6,
      speed: i % 2 === 0 ? 0.045 : -0.035,
      x: 0,
      y: 0,
      r: 8,
      phase: i * 1.1,
    }));
    nodesRef.current = nodes;
    const stars: Star[] = [];
    const packets: Packet[] = [];
    const ripples: Ripple[] = [];

    const planetR = () => Math.max(40, Math.min(W, H) * 0.15);

    const place = (n: Node) => {
      const m = Math.min(W, H);
      const rad = m * (n.ring === 0 ? 0.31 : 0.4);
      n.x = cx + Math.cos(n.angle) * rad * (W > H ? 1.25 : 1);
      n.y = cy + Math.sin(n.angle) * rad * 0.85;
      // Evita que las etiquetas se salgan del recuadro.
      n.x = Math.min(W - 54, Math.max(54, n.x));
      n.y = Math.min(H - 34, Math.max(20, n.y));
    };

    const init = () => {
      const rect = box.getBoundingClientRect();
      W = Math.max(rect.width, 280);
      H = Math.max(rect.height, 300);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W / 2;
      cy = H / 2 - 6;
      nodes.forEach(place);
      const count = W < 500 ? 34 : 56;
      stars.length = 0;
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: Math.random() * 1.3 + 0.4,
          a: Math.random() * 0.5 + 0.25,
          sp: Math.random() * 1.6 + 0.8,
          ph: Math.random() * 6.28,
          c: Math.random() > 0.4 ? "#5EEAD4" : "#FFFFFF",
        });
      }
    };

    const beat = () => {
      const R = planetR();
      nodes.forEach((n, idx) => {
        packets.push({ n, t: 0, sp: 0.55 + Math.random() * 0.25, lift: (idx % 2 ? -1 : 1) * 30 });
      });
      ripples.push({ x: cx, y: cy, r: R * 0.6, max: Math.max(W, H) * 0.6, color: "94,234,212" });
    };

    const frame = (dt: number) => {
      ctx.clearRect(0, 0, W, H);
      time += dt;
      const R = planetR();
      const hovered = hoverRef.current;

      // Estrellas
      for (const s of stars) {
        const a = Math.min(1, Math.max(0.12, s.a + Math.sin(time * s.sp + s.ph) * 0.3));
        ctx.globalAlpha = a;
        ctx.fillStyle = s.c;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Latido
      if (!reduce.matches && time > nextBeat) {
        beat();
        nextBeat = time + 3.6;
      }

      // Ondas
      for (let i = ripples.length - 1; i >= 0; i--) {
        const w = ripples[i];
        w.r += dt * 170;
        const a = Math.max(0, 1 - w.r / w.max);
        ctx.strokeStyle = `rgba(${w.color},${a * 0.6})`;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.r, 0, 6.2832);
        ctx.stroke();
        if (w.r >= w.max) ripples.splice(i, 1);
      }

      // Posición de nodos
      for (const n of nodes) {
        if (!reduce.matches) n.angle += n.speed * dt;
        place(n);
        n.r = 8 + Math.sin(time * 1.8 + n.phase) * 1.4;
      }

      // Arcos planeta - nodo
      nodes.forEach((n, idx) => {
        const ang = Math.atan2(n.y - cy, n.x - cx);
        const sx = cx + Math.cos(ang) * R * 0.98;
        const sy = cy + Math.sin(ang) * R * 0.98;
        const perp = ang + Math.PI / 2;
        const lift = (idx % 2 ? -1 : 1) * 30;
        const qx = (sx + n.x) / 2 + Math.cos(perp) * lift;
        const qy = (sy + n.y) / 2 + Math.sin(perp) * lift;
        const pulse = 0.4 + Math.sin(time * 2.4 + idx * 1.2) * 0.15 + (hovered === n.id ? 0.35 : 0);
        ctx.strokeStyle = `rgba(45,212,191,${pulse * 0.3})`;
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(qx, qy, n.x, n.y);
        ctx.stroke();
        ctx.strokeStyle = `rgba(94,234,212,${Math.min(1, pulse)})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      });

      // Paquetes (decorativos): puntos de luz que viajan del planeta a cada nodo
      for (let i = packets.length - 1; i >= 0; i--) {
        const p = packets[i];
        p.t += dt * p.sp;
        const n = p.n;
        const ang = Math.atan2(n.y - cy, n.x - cx);
        const sx = cx + Math.cos(ang) * R;
        const sy = cy + Math.sin(ang) * R;
        const perp = ang + Math.PI / 2;
        const qx = (sx + n.x) / 2 + Math.cos(perp) * p.lift;
        const qy = (sy + n.y) / 2 + Math.sin(perp) * p.lift;
        const t = Math.min(1, p.t);
        const u = 1 - t;
        const x = u * u * sx + 2 * u * t * qx + t * t * n.x;
        const y = u * u * sy + 2 * u * t * qy + t * t * n.y;
        ctx.fillStyle = "#FFFFFF";
        ctx.shadowColor = n.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, 6.2832);
        ctx.fill();
        ctx.shadowBlur = 0;
        if (p.t >= 1) {
          ripples.push({ x: n.x, y: n.y, r: 3, max: 24, color: "94,234,212" });
          packets.splice(i, 1);
        }
      }

      // Puntero: hilo hacia el planeta
      const ptr = pointerRef.current;
      if (ptr.active) {
        const d = Math.hypot(ptr.x - cx, ptr.y - cy);
        if (d < 240) {
          ctx.strokeStyle = `rgba(94,234,212,${(1 - d / 240) * 0.7})`;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(ptr.x, ptr.y);
          ctx.lineTo(cx, cy);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Planeta
      const pr = R + Math.sin(time * 2) * 1.2;
      const corona = ctx.createRadialGradient(cx, cy, pr * 0.8, cx, cy, pr * 1.7);
      corona.addColorStop(0, "rgba(94,234,212,0.4)");
      corona.addColorStop(0.4, "rgba(45,212,191,0.18)");
      corona.addColorStop(1, "rgba(6,19,20,0)");
      ctx.fillStyle = corona;
      ctx.beginPath();
      ctx.arc(cx, cy, pr * 1.7, 0, 6.2832);
      ctx.fill();

      // Anillo inclinado + satélite
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.38);
      ctx.scale(1, 0.38);
      ctx.strokeStyle = "rgba(94,234,212,0.6)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.arc(0, 0, pr * 1.45, 0, 6.2832);
      ctx.stroke();
      ctx.setLineDash([]);
      const sa = time * 0.8;
      ctx.fillStyle = "#FFFFFF";
      ctx.shadowColor = "#5EEAD4";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(Math.cos(sa) * pr * 1.45, Math.sin(sa) * pr * 1.45, 4, 0, 6.2832);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();

      const g = ctx.createRadialGradient(cx - pr * 0.35, cy - pr * 0.35, pr * 0.05, cx, cy, pr);
      g.addColorStop(0, "#5EEAD4");
      g.addColorStop(0.25, "#14B8A6");
      g.addColorStop(0.65, "#0B292C");
      g.addColorStop(0.9, "#071A1C");
      g.addColorStop(1, "#061314");
      ctx.fillStyle = g;
      ctx.shadowColor = "#2DD4BF";
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.arc(cx, cy, pr, 0, 6.2832);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Malla geodésica
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, pr, 0, 6.2832);
      ctx.clip();
      for (const lat of [-0.65, -0.35, 0, 0.35, 0.65]) {
        const yo = lat * pr;
        const rx = Math.sqrt(Math.max(0, pr * pr - yo * yo));
        ctx.strokeStyle = "rgba(94,234,212,0.22)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy + yo, rx, rx * 0.35, 0, 0, 6.2832);
        ctx.stroke();
      }
      const rot = time * 0.45;
      for (let m = 0; m < 8; m++) {
        const c = Math.cos((m / 8) * 6.2832 + rot);
        if (c > -0.1) {
          ctx.strokeStyle = `rgba(94,234,212,${0.18 + c * 0.18})`;
          ctx.beginPath();
          ctx.ellipse(cx, cy, pr * Math.abs(c), pr, 0, 0, 6.2832);
          ctx.stroke();
        }
      }
      ctx.restore();

      ctx.strokeStyle = "rgba(94,234,212,0.85)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(cx, cy, pr, Math.PI * 0.8, Math.PI * 1.85);
      ctx.stroke();

      // Monograma K
      ctx.strokeStyle = "#F2FBFA";
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowColor = "#5EEAD4";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(cx - 7, cy - 10);
      ctx.lineTo(cx - 7, cy + 10);
      ctx.moveTo(cx - 7, cy);
      ctx.lineTo(cx + 7, cy - 10);
      ctx.moveTo(cx - 2, cy - 2);
      ctx.lineTo(cx + 7, cy + 10);
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.textAlign = "center";
      ctx.fillStyle = "#5EEAD4";
      ctx.font = "800 11px system-ui, sans-serif";
      ctx.fillText("KOSMOVIA", cx, cy + pr + 18);

      // Nodos
      for (const n of nodes) {
        const hot = hovered === n.id;
        const r = n.r + (hot ? 2 : 0);
        ctx.fillStyle = "rgba(45,212,191,0.14)";
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 10, 0, 6.2832);
        ctx.fill();
        ctx.strokeStyle = hot ? "rgba(255,255,255,0.9)" : "rgba(94,234,212,0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 4, 0, 6.2832);
        ctx.stroke();
        const ng = ctx.createRadialGradient(n.x - 2, n.y - 2, 1, n.x, n.y, r);
        ng.addColorStop(0, "#FFFFFF");
        ng.addColorStop(0.4, n.color);
        ng.addColorStop(1, "#0B1F21");
        ctx.fillStyle = ng;
        ctx.shadowColor = n.color;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, 6.2832);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#F2FBFA";
        ctx.font = "600 11.5px system-ui, sans-serif";
        ctx.fillText(n.name, n.x, n.y + r + 17);
      }
    };

    const loop = (ts: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0.016);
      last = ts;
      frame(dt);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (reduce.matches || raf) return;
      last = 0;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    init();
    frame(0.016);

    const ro = new ResizeObserver(() => {
      init();
      frame(0.016);
    });
    ro.observe(box);

    const io = new IntersectionObserver(
      ([e]) => {
        visible = e.isIntersecting;
        if (visible) start();
        else stop();
      },
      { threshold: 0.05 },
    );
    io.observe(box);

    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVis);
    const onMotion = () => {
      if (reduce.matches) {
        stop();
        frame(0.016);
      } else start();
    };
    reduce.addEventListener("change", onMotion);
    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      reduce.removeEventListener("change", onMotion);
    };
  }, []);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    pointerRef.current = { x, y, active: true };
    let found: Node | null = null;
    for (const n of nodesRef.current) {
      if (Math.hypot(x - n.x, y - n.y) < 30) found = n;
    }
    if (found) {
      hoverRef.current = found.id;
      setTip({
        x: Math.min(rect.width - 110, Math.max(110, found.x)),
        y: Math.max(54, found.y - 22),
        name: found.name,
        desc: found.desc,
        color: found.color,
      });
    } else if (hoverRef.current) {
      hoverRef.current = null;
      setTip(null);
    }
  };

  return (
    <div
      ref={boxRef}
      className="kv-scene"
      role="img"
      aria-label="Ilustración: el planeta Kosmovia conectado con Chat y canales, Wallet USDC, Pagos con PIN, Vaquita, Retos y Aprende Stellar."
      onPointerMove={onMove}
      onPointerDown={onMove}
      onPointerLeave={() => {
        pointerRef.current.active = false;
        hoverRef.current = null;
        setTip(null);
      }}
    >
      <div className="kv-scene-bg" aria-hidden="true" />
      <canvas ref={canvasRef} aria-hidden="true" />
      {tip ? (
        <div className="kv-tip" style={{ left: tip.x, top: tip.y }} aria-hidden="true">
          <b style={{ color: tip.color }}>{tip.name}</b>
          <span>{tip.desc}</span>
        </div>
      ) : null}
      <div className="kv-scene-badge" aria-hidden="true">
        <span className="kv-dot" /> Red Stellar · testnet
      </div>
    </div>
  );
}
