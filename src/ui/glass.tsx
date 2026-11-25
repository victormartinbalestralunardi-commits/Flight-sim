/**
 * Composants d'interface « Liquid Glass » (Apple) : verre translucide, bordures spéculaires,
 * reflet qui suit le pointeur, micro-animations de ressort.
 */
import { useCallback, type CSSProperties, type ReactNode } from 'react';

function trackPointer(e: React.MouseEvent<HTMLElement>): void {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`);
  el.style.setProperty('--my', `${e.clientY - r.top}px`);
}

export function GlassPanel({ children, className = '', style, animate = true }: { children: ReactNode; className?: string; style?: CSSProperties; animate?: boolean }) {
  return (
    <div className={`glass rounded-3xl ${animate ? 'spring-in' : ''} ${className}`} style={style} onMouseMove={trackPointer}>
      {children}
    </div>
  );
}

export function GlassButton({
  children, onClick, variant = 'default', active = false, className = '', size = 'md', disabled = false, title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'success';
  active?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  title?: string;
}) {
  const sz = size === 'sm' ? 'px-3 py-1.5 text-xs rounded-xl' : size === 'lg' ? 'px-7 py-3.5 text-base rounded-2xl' : 'px-4 py-2 text-sm rounded-2xl';
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={(e) => { onClick?.(); e.currentTarget.blur(); /* rend Espace/Entrée aux commandes de vol */ }}
      onMouseMove={trackPointer}
      className={`glass-btn ${variant !== 'default' ? variant : ''} ${active ? 'active' : ''} ${sz} whitespace-nowrap font-medium text-white tracking-tight select-none disabled:opacity-40 disabled:pointer-events-none ${className}`}
    >
      {children}
    </button>
  );
}

export function GlassSlider({
  label, value, min, max, step = 1, onChange, format, unit, hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  unit?: string;
  hint?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const onInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => onChange(parseFloat(e.target.value)), [onChange]);
  return (
    <label className="block select-none">
      <div className="mb-1.5 flex items-baseline justify-between text-[12px]">
        <span className="text-white/70">{label}</span>
        <span className="tabular font-semibold text-white">
          {format ? format(value) : value}
          {unit && <span className="ml-0.5 font-normal text-white/50">{unit}</span>}
        </span>
      </div>
      <input type="range" className="glass-range w-full" min={min} max={max} step={step} value={value} onChange={onInput} style={{ ['--pct' as string]: `${pct}%` }} />
      {hint && <div className="mt-1 text-[10px] text-white/40">{hint}</div>}
    </label>
  );
}

export function GlassToggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-3 py-1 text-left select-none">
      <span>
        <span className="block text-[13px] text-white/85">{label}</span>
        {hint && <span className="block text-[10px] text-white/40">{hint}</span>}
      </span>
      <span
        className={`relative h-[26px] w-[46px] flex-none rounded-full border border-white/25 transition-colors duration-300 ${checked ? 'bg-[#34c759]/90' : 'bg-white/15'}`}
      >
        <span
          className="absolute top-[2px] h-[20px] w-[20px] rounded-full bg-white shadow-md"
          style={{ left: checked ? 22 : 2, transition: 'left 0.45s var(--spring)' }}
        />
      </span>
    </button>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange, className = '' }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className={`relative flex rounded-2xl border border-white/20 bg-white/10 p-1 ${className}`}>
      <div
        className="absolute bottom-1 top-1 rounded-xl bg-white/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
        style={{ left: `calc(${(idx / options.length) * 100}% + 4px)`, width: `calc(${100 / options.length}% - 8px)`, transition: 'left 0.5s var(--spring)' }}
      />
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={`relative z-10 flex-1 rounded-xl px-2 py-1.5 text-[12px] font-medium transition-colors ${o.value === value ? 'text-white' : 'text-white/60 hover:text-white/90'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, unit, tone = 'default', small = false }: { label: string; value: ReactNode; unit?: string; tone?: 'default' | 'good' | 'warn' | 'bad'; small?: boolean }) {
  const c = tone === 'good' ? 'text-[#5bf09a]' : tone === 'warn' ? 'text-[#ffd25a]' : tone === 'bad' ? 'text-[#ff6b6b]' : 'text-white';
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] uppercase tracking-[0.08em] text-white/45">{label}</div>
      <div className={`tabular ${small ? 'text-sm' : 'text-lg'} font-semibold leading-tight ${c}`}>
        {value}
        {unit && <span className="ml-1 text-[11px] font-normal text-white/50">{unit}</span>}
      </div>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="mb-2 mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50">{children}</div>;
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' | 'info' }) {
  const c = {
    default: 'bg-white/15 text-white/85 border-white/20',
    good: 'bg-[#34c759]/25 text-[#8ff5b5] border-[#34c759]/40',
    warn: 'bg-[#ffcc00]/20 text-[#ffe47a] border-[#ffcc00]/40',
    bad: 'bg-[#ff3b30]/25 text-[#ff9c95] border-[#ff3b30]/45',
    info: 'bg-[#0a84ff]/25 text-[#9fd0ff] border-[#0a84ff]/45',
  }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${c}`}>{children}</span>;
}

export function Modal({ children, onClose, className = '' }: { children: ReactNode; onClose?: () => void; className?: string }) {
  return (
    <div className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <GlassPanel className={`max-h-[90vh] overflow-hidden ${className}`}>{children}</GlassPanel>
    </div>
  );
}
