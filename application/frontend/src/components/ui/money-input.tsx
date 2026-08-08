import * as React from "react"

import { Input } from "@/components/ui/input"

type MoneyInputProps = Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  // Raw numeric string, no commas (e.g. "1000000" or "1000000.5") -- same shape
  // callers already used for a plain `<Input type="number">`, so submit-time
  // `Number(value)` logic at call sites needs no changes.
  value: string
  onChange: (raw: string) => void
}

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

function formatDisplay(raw: string, focused: boolean): string {
  if (raw === "") return ""
  const [intPart, decPart] = raw.split(".")
  const grouped = groupThousands(intPart || "0")
  if (focused) {
    return decPart !== undefined ? `${grouped}.${decPart}` : grouped
  }
  // On blur, always show exactly 2 decimal places.
  return `${grouped}.${(decPart ?? "").padEnd(2, "0").slice(0, 2)}`
}

// Commas are the only characters formatting ever inserts or removes -- digits
// and the single decimal point never change order or count between the raw
// string and its formatted display. So the cursor can be re-anchored precisely
// by counting non-comma characters before it (pre-reformat), then walking the
// newly-formatted string to the position right after that same count.
function countNonCommaChars(s: string, uptoIndex: number): number {
  let count = 0
  for (let i = 0; i < uptoIndex && i < s.length; i++) {
    if (s[i] !== ",") count++
  }
  return count
}

function positionAfterNonCommaCount(s: string, n: number): number {
  if (n <= 0) return 0
  let count = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== ",") {
      count++
      if (count === n) return i + 1
    }
  }
  return s.length
}

// Comma-formats a plain numeric string as the user types (1000000 -> 1,000,000),
// padding to 2 decimals once the field loses focus, while keeping the cursor
// anchored to the digit the user just typed/deleted rather than snapping to
// the end of the field on every keystroke.
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, onFocus, onBlur, ...props },
  forwardedRef,
) {
  const [focused, setFocused] = React.useState(false)
  const innerRef = React.useRef<HTMLInputElement | null>(null)
  const pendingCursorCount = React.useRef<number | null>(null)

  React.useLayoutEffect(() => {
    const el = innerRef.current
    if (el && document.activeElement === el && pendingCursorCount.current !== null) {
      const pos = positionAfterNonCommaCount(el.value, pendingCursorCount.current)
      el.setSelectionRange(pos, pos)
      pendingCursorCount.current = null
    }
  })

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const domValue = e.target.value
    const cursorPos = e.target.selectionStart ?? domValue.length
    const raw = domValue.replace(/,/g, "")
    if (raw !== "" && !/^\d*\.?\d{0,2}$/.test(raw)) return
    pendingCursorCount.current = countNonCommaChars(domValue, cursorPos)
    onChange(raw)
  }

  return (
    <Input
      {...props}
      ref={(node) => {
        innerRef.current = node
        if (typeof forwardedRef === "function") forwardedRef(node)
        else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLInputElement | null>).current = node
      }}
      type="text"
      inputMode="decimal"
      value={formatDisplay(value, focused)}
      onChange={handleChange}
      onFocus={(e) => {
        setFocused(true)
        onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(false)
        onBlur?.(e)
      }}
    />
  )
})
