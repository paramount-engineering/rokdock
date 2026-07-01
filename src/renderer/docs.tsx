import { bootBundledTheme } from '@shared/entryBootstrap'
import './appearanceModalTrigger'
import './docs.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { DocsView } from './components/docs/docsView'

void bootBundledTheme()
const container = document.getElementById('root')
if (container) createRoot(container).render(<React.StrictMode><DocsView /></React.StrictMode>)
