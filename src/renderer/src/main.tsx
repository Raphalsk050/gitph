import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { DiffWindow } from './components/DiffWindow'
import './styles.css'

const root = document.getElementById('root')
if (root === null) throw new Error('Renderer root element was not found.')

const diffTarget = /^#diff=([0-9a-f]{4,40})$/iu.exec(window.location.hash)

createRoot(root).render(
  <StrictMode>
    {diffTarget ? <DiffWindow oid={diffTarget[1]} /> : <App />}
  </StrictMode>
)
