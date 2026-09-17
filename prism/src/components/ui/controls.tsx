import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from '@/lib/format-utils'

/* ===========================================================================
   Button
   ======================================================================== */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet'
type Size = 'sm' | 'md' | 'lg'

const VARIANT: Record<Variant, string> = {
  // Mint on ink: the accent is light, so the label goes dark. This reads as a
  // single confident action rather than yet another blue SaaS button.
  primary:
    'bg-accent text-on-accent shadow-sm hover:bg-accent-hover active:translate-y-px ' +
    'disabled:bg-surface-3 disabled:text-faint disabled:shadow-none disabled:hover:bg-surface-3',
  secondary:
    'bg-surface-2 text-text border border-line hover:bg-surface-3 hover:border-line-strong ' +
    'active:translate-y-px disabled:text-faint disabled:hover:bg-surface-2',
  ghost:
    'text-dim hover:text-text hover:bg-surface-2 active:translate-y-px disabled:hover:bg-transparent',
  quiet: 'text-faint hover:text-text',
  danger:
    'bg-transparent text-danger border border-transparent hover:bg-danger/10 hover:border-danger/30',
}

const SIZE: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5 rounded-sm',
  md: 'h-9 px-3.5 text-[13px] gap-2 rounded-md',
  lg: 'h-11 px-5 text-[14px] gap-2 rounded-md font-medium',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  full?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, full, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx(
        'inline-flex items-center justify-center font-medium whitespace-nowrap select-none',
        'transition-[background-color,color,border-color,transform,box-shadow] duration-150',
        '[transition-timing-function:var(--ease-prism)]',
        'disabled:cursor-not-allowed disabled:opacity-70',
        VARIANT[variant],
        SIZE[size],
        full && 'w-full',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
})

/* ===========================================================================
   Icon button
   ======================================================================== */

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  tone?: 'default' | 'danger'
}

export function IconButton({ label, tone = 'default', className, children, ...rest }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        'inline-grid size-8 place-items-center rounded-sm transition-colors duration-150',
        '[transition-timing-function:var(--ease-prism)]',
        tone === 'danger'
          ? 'text-faint hover:bg-danger/12 hover:text-danger'
          : 'text-dim hover:bg-surface-3 hover:text-text',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ===========================================================================
   Segmented control
   ======================================================================== */

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  title?: string
  disabled?: boolean
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T
  options: SegmentedOption<T>[]
  onChange: (value: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div
      role="radiogroup"
      className={cx(
        'grid w-full gap-0.5 rounded-md bg-surface-sunk p-0.5',
        'border border-line-soft',
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cx(
              'relative truncate rounded-[7px] font-medium transition-all duration-200',
              '[transition-timing-function:var(--ease-prism)]',
              size === 'sm' ? 'h-6 px-2 text-[11px]' : 'h-7 px-2.5 text-[12px]',
              active
                ? 'bg-surface text-text shadow-sm'
                : 'text-dim hover:text-text disabled:text-faint disabled:hover:text-faint',
              option.disabled && 'cursor-not-allowed opacity-45',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/* ===========================================================================
   Field wrapper
   ======================================================================== */

export function Field({
  label,
  hint,
  value,
  children,
  className,
}: {
  label: string
  hint?: string
  /** Right-aligned current value, e.g. the number next to a slider. */
  value?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-[11px] font-medium tracking-wide text-dim uppercase">{label}</label>
        {value !== undefined && (
          <span className="tnum text-[12px] font-medium text-text">{value}</span>
        )}
      </div>
      {children}
      {hint && <p className="text-[11.5px] leading-snug text-faint">{hint}</p>}
    </div>
  )
}

/* ===========================================================================
   Slider
   ======================================================================== */

export function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
  marks,
}: {
  min: number
  max: number
  step?: number
  value: number
  onChange: (value: number) => void
  /** Optional captions under the two ends, e.g. "klein" / "groß". */
  marks?: [string, string]
}) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <div className="flex flex-col gap-1">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--range-fill' as string]: `${fill}%` }}
      />
      {marks && (
        <div className="flex justify-between text-[10.5px] text-faint">
          <span>{marks[0]}</span>
          <span>{marks[1]}</span>
        </div>
      )}
    </div>
  )
}

/* ===========================================================================
   Select
   ======================================================================== */

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  group?: string
}

export function Select({
  value,
  options,
  onChange,
  className,
}: {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  className?: string
}) {
  const groups = new Map<string, SelectOption[]>()
  for (const option of options) {
    const key = option.group ?? ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(option)
  }

  return (
    <select
      className={cx(
        'prism-select h-9 w-full rounded-md border border-line bg-surface-2 px-2.5 text-[13px]',
        'transition-colors duration-150 hover:border-line-strong focus:border-accent-line',
        className,
      )}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {[...groups.entries()].map(([group, items]) =>
        group ? (
          <optgroup key={group} label={group}>
            {items.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ) : (
          items.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))
        ),
      )}
    </select>
  )
}

/* ===========================================================================
   Number input
   ======================================================================== */

export function NumberInput({
  value,
  onChange,
  min,
  max,
  suffix,
  className,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  suffix?: string
  className?: string
}) {
  return (
    <div className={cx('relative', className)}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const next = Number(e.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
        className={cx(
          'h-9 w-full rounded-md border border-line bg-surface-2 px-2.5 text-[13px]',
          'transition-colors duration-150 hover:border-line-strong focus:border-accent-line',
          suffix && 'pr-9',
        )}
      />
      {suffix && (
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[11px] text-faint">
          {suffix}
        </span>
      )}
    </div>
  )
}

/* ===========================================================================
   Toggle
   ======================================================================== */

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex w-full items-start gap-3 rounded-sm py-1 text-left"
    >
      <span
        className={cx(
          'mt-0.5 flex h-[18px] w-[30px] shrink-0 items-center rounded-full p-[2px]',
          'transition-colors duration-200 [transition-timing-function:var(--ease-prism)]',
          checked ? 'bg-accent' : 'bg-surface-3',
        )}
      >
        <span
          className={cx(
            'size-[14px] rounded-full bg-surface shadow-sm',
            'transition-transform duration-200 [transition-timing-function:var(--ease-prism)]',
            checked ? 'translate-x-[12px]' : 'translate-x-0',
          )}
        />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[12.5px] leading-tight text-text">{label}</span>
        {hint && <span className="text-[11px] leading-snug text-faint">{hint}</span>}
      </span>
    </button>
  )
}

/* ===========================================================================
   Pill
   ======================================================================== */

export function Pill({
  children,
  tone = 'neutral',
  title,
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'warn' | 'danger' | 'ok'
  title?: string
  className?: string
}) {
  const tones = {
    neutral: 'bg-surface-2 text-dim border-line-soft',
    accent: 'bg-accent-sunk text-accent border-accent-line/40',
    warn: 'bg-warn/12 text-warn border-warn/25',
    danger: 'bg-danger/12 text-danger border-danger/25',
    ok: 'bg-ok/12 text-ok border-ok/25',
  }
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-[2px]',
        'text-[10.5px] font-medium tracking-wide whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/* ===========================================================================
   Section - a labelled block inside the inspector
   ======================================================================== */

export function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 px-4 py-4">
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">
          {title}
        </h3>
        {action}
      </header>
      {children}
    </section>
  )
}
