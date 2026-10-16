// Types for validate.js (also used by the browser-only build).
export function isValidDate(s: unknown): boolean
export function reqDate(v: unknown, field?: string): string
export function title(v: unknown, field?: string, label?: string): string
export function text(v: unknown, field: string, max?: number): string
export function timeRange(start: unknown, end: unknown): [string | null, string | null]
export function notify(v: unknown): number | null
export function color(v: unknown): string
export function dateList(start: unknown, end: unknown, weekdays?: unknown): string[]
export function breakMinutes(v: unknown, start: string | null, end: string | null): number
export function yen(v: unknown, field: string, label: string): number
export function breakRules(v: unknown): { overMinutes: number; breakMinutes: number }[]
export function intIn(v: unknown, min: number, max: number, field: string, label: string): number
export function month(v: unknown): string
