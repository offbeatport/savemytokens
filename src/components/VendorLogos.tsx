import { cn } from '@/lib/utils'

/**
 * Vendor marks served from /public. Monochrome (currentColor) marks are painted
 * via CSS mask so they recolor with the theme (foreground in light/dark); full
 * color marks render as <img>.
 */
type Vendor = 'openai' | 'anthropic' | 'gemini'

const MONO_SRC: Record<Vendor, string | null> = {
  openai: '/openai.svg',
  anthropic: '/anthropic.svg',
  gemini: null,
}
const COLOR_SRC: Record<Vendor, string> = {
  openai: '/openai.svg',
  anthropic: '/anthropic.svg',
  gemini: '/gemini-color.svg',
}
const LABEL: Record<Vendor, string> = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini' }

export function VendorLogo({ vendor, className }: { vendor: Vendor; className?: string }) {
  const mono = MONO_SRC[vendor]
  if (mono) {
    return (
      <span
        role="img"
        aria-label={LABEL[vendor]}
        className={cn('inline-block bg-current', className)}
        style={{
          maskImage: `url(${mono})`,
          WebkitMaskImage: `url(${mono})`,
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskPosition: 'center',
          WebkitMaskPosition: 'center',
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
        }}
      />
    )
  }
  return <img src={COLOR_SRC[vendor]} alt={LABEL[vendor]} className={cn('object-contain', className)} />
}
