import { Component, type ErrorInfo, type ReactNode } from 'react';

type State = { error?: Error };

/** Keeps a renderer exception diagnosable instead of leaving a blank Electron window. */
export class RendererErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {};
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('VFXart renderer error', error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="renderer-error"><h1>VFXart needs to reload</h1><p>The editor hit an unexpected interface error. Your project files have not been changed by this screen.</p><code>{this.state.error.message || 'Unknown renderer error'}</code><button className="primary" onClick={() => window.location.reload()}>Reload editor</button></main>;
  }
}
