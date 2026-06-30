import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 32, color: '#f87171', fontFamily: 'monospace', fontSize: 13,
          background: '#0d0d0f', height: '100vh', whiteSpace: 'pre-wrap', overflowY: 'auto',
        }}>
          <div style={{ color: '#7c6af7', marginBottom: 16, fontSize: 15, fontWeight: 600 }}>
            Harness — startup error
          </div>
          {String(this.state.error)}
          {'\n\n'}
          {this.state.error?.stack}
        </div>
      )
    }
    return this.props.children
  }
}

const render = () => {
  const root = document.getElementById('root')
  createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  )
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', render)
} else {
  render()
}
