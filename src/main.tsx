import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/atkinson-hyperlegible-next'
import './index.css'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'

// A clickable demo of the clinician dashboard on invented patients. Not linked from the app.
const ClinicianDemo = lazy(() => import('./components/ClinicianDemo'))
const isDemo = window.location.hash === '#clinician-demo'
// Only reload when moving into or out of the demo, so normal links are not affected.
window.addEventListener('hashchange', () => {
  if ((window.location.hash === '#clinician-demo') !== isDemo) window.location.reload()
})

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element #root not found in index.html')

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      {isDemo ? (
        <Suspense fallback={null}>
          <ClinicianDemo />
        </Suspense>
      ) : (
        <App />
      )}
    </ErrorBoundary>
  </StrictMode>,
)
