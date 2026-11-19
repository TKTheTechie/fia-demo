import { Fragment, ReactNode } from 'react'

// Scenario copy is plain strings with tiny inline markup:
//   [[accent]]  gradient text      **bold**  bold      `code`  code
const TOKEN = /(\[\[.+?\]\]|\*\*.+?\*\*|`.+?`)/g

export function renderRich(text: string): ReactNode {
  return text.split(TOKEN).map((part, i) => {
    if (part.startsWith('[[')) return <span key={i} className="grad">{part.slice(2, -2)}</span>
    if (part.startsWith('**')) return <b key={i}>{part.slice(2, -2)}</b>
    if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
    return <Fragment key={i}>{part}</Fragment>
  })
}
