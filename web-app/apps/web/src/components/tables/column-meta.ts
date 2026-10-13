import type { RowData } from '@tanstack/react-table'

declare module '@tanstack/react-table' {
  // Generic parameters must match the library's declaration exactly.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: 'left' | 'right' | 'center'
    /** Column is hidden below this breakpoint (keeps phone tables readable). */
    hideBelow?: 'sm' | 'md' | 'lg' | 'xl'
    /** Label used in the "Columns" menu when `header` isn't a plain string. */
    label?: string
    headerClassName?: string
    cellClassName?: string
  }
}

export {}
