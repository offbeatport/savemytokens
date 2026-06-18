import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { cn } from '@/lib/utils'

/** Renders trusted/sanitized markdown (founder memo, report copy). */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('prose-smt', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
