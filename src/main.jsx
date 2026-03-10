import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { TierProvider } from './TierContext.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TierProvider>
      <App />
    </TierProvider>
  </React.StrictMode>,
)