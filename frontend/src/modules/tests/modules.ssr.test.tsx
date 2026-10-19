import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '../../i18n'
import { SessionProvider } from '../../state/session'
import { ImportModule } from '../ImportModule'
import { LibraryModule } from '../LibraryModule'

function render(node: React.ReactNode) {
  return renderToStaticMarkup(
    <I18nProvider>
      <SessionProvider>{node}</SessionProvider>
    </I18nProvider>,
  )
}

describe('module shells render through the catalogue', () => {
  it('renders the Library header and empty state', () => {
    const html = render(<LibraryModule />)
    expect(html).toContain('Local songs, per-song notes')
    expect(html).toContain('No songs yet')
    expect(html).toContain('Add current file')
    expect(html).toContain('Resume last')
  })

  it('renders the Import dropzone and URL fetch', () => {
    const html = render(<ImportModule />)
    expect(html).toContain('Drop audio here')
    expect(html).toContain('Fetch URL')
    expect(html).toContain('Open local files')
  })
})
