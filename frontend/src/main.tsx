import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { installJcefHostRepaintCoordinator } from './utils/jcefHostRepaint.ts'
import { ACPBridge } from './utils/bridge.ts'
import { installLinkClickHandler } from './utils/linkClicks.ts'
import { UiOwnerGate } from './components/UiOwnerGate.tsx'

installJcefHostRepaintCoordinator()
installLinkClickHandler()
ACPBridge.initialize()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UiOwnerGate>
      <App />
    </UiOwnerGate>
  </React.StrictMode>,
)
