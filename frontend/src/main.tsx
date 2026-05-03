import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { installJcefHostRepaintCoordinator } from './utils/jcefHostRepaint.ts'
import { installJcefScrollFix } from './utils/jcefScrollFix.ts'
import { ACPBridge } from './utils/bridge.ts'

installJcefHostRepaintCoordinator()
installJcefScrollFix()
ACPBridge.initialize()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
