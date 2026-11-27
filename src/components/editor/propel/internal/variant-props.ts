import type { VariantProps } from 'class-variance-authority'

type NonNullableVariants<Variants> = { [Key in keyof Variants]-?: NonNullable<Variants[Key]> }

/**
 * Type-safe variant props for a `cva` helper.
 *
 * Every variant axis is required (and non-null) unless it has a configured default, in which case it is optional.
 */
export type StrictVariantProps<
  Component extends (...args: never[]) => unknown,
  Defaulted extends keyof VariantProps<Component> = never
> = Omit<NonNullableVariants<VariantProps<Component>>, Defaulted> &
  Partial<Pick<NonNullableVariants<VariantProps<Component>>, Defaulted>>
